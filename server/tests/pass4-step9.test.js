import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request } from './helpers.js';
import { runOutbox } from '../src/services/outbox.js';
import { runBookingMaintenance } from '../src/notifications/scheduler.js';
import { reconcileLinkConflicts } from '../src/services/bookingLinks.js';
import { todayView } from '../src/services/ops.js';
import { saveSettings } from '../src/services/settings.js';
import { testHooks } from '../src/lib/testHooks.js';
import { addDays, todayIn, isoDay } from '../src/lib/dates.js';
import { applyPaymentResult } from '../src/payments/index.js';
let X, acc, apt, owner, users, settings, offset=140; const sent=[]; let fail=null;
const transport={ async send(chat,text) { if(fail?.(chat,text)) throw new Error('test transport unavailable'); sent.push({chat,text}); } };
before(async()=>{
 X=makeApp({transport}); acc=await prisma.account.findUnique({where:{slug:'astana-stay'}}); settings=await prisma.accountSettings.findUnique({where:{accountId:acc.id}});
 users=await prisma.membership.findMany({where:{accountId:acc.id,role:{in:['owner','admin']}},include:{user:true}});
 for(const m of users)await prisma.user.update({where:{id:m.userId},data:{telegramId:'step9-'+m.role}});
 owner=await login(X.app,'azamat@astanastay.example');apt=await prisma.apartment.create({data:{accountId:acc.id,title:'Шаг 9',address:'Тест',district:'Есиль',rooms:'1',basePriceKzt:20000,maxGuests:4}});
});
afterEach(async()=>{fail=null;for(const k of Object.keys(testHooks))delete testHooks[k];await saveSettings(acc.id,{managerNotify:'BOTH'});});
after(async()=>{for(const m of users)await prisma.user.update({where:{id:m.userId},data:{telegramId:m.user.telegramId}});await saveSettings(acc.id,{managerNotify:settings?.managerNotify||'BOTH'});await prisma.apartment.delete({where:{id:apt.id}}).catch(()=>{});await prisma.$disconnect();});
const post=(p,d={})=>request(X.app).post('/api/admin'+p).set(owner.auth).send(d);
async function create(extra={}){const n=offset;offset+=5;const day=todayIn(acc.timezone);const r=await post('/booking-links',{apartmentId:apt.id,checkIn:isoDay(addDays(day,n)),checkOut:isoDay(addDays(day,n+2)),guestsCount:1,terms:'cash_on_arrival',...extra});assert.equal(r.status,201,JSON.stringify(r.body));return {...r.body,token:r.body.url.split('/link/')[1]};}
const save=c=>request(X.app).post(`/api/special-link/${c.token}/guest`).send({name:'Тест Гость',phone:'+77015556677',acceptTerms:true});
const submit=c=>request(X.app).post(`/api/special-link/${c.token}/submit`).send({});
const logs=(event,c)=>prisma.notificationLog.findMany({where:{dedupeKey:{startsWith:`${event}:${c.link.id}:`}}});
const retry=async key=>{await prisma.outboxEvent.update({where:{dedupeKey:key},data:{nextAttemptAt:new Date(0)}});return runOutbox({events:X.events,keys:[key]});};

test('шаг 9: started один раз при повторных POST; completed менеджерам, booking.confirmed гостю; нет секретов',async()=>{
 const c=await create();const from=sent.length;assert.equal((await save(c)).status,200);assert.equal((await save(c)).status,200);assert.equal((await logs('link.started',c)).length,2);assert.equal(sent.length-from,2);
 assert.equal((await submit(c)).status,200);assert.equal((await submit(c)).status,200);assert.equal((await logs('link.completed',c)).length,2);
 const b=await prisma.booking.findUnique({where:{id:c.link.bookingId},include:{link:true}});const guest=await prisma.notificationLog.findMany({where:{event:'booking.confirmed',recipientId:b.guestId}});assert.equal(guest.length,1);assert.equal(guest[0].recipientType,'guest');
 for(const l of [...await logs('link.started',c),...await logs('link.completed',c)]){assert.ok(['owner','admin'].includes(l.recipientType));for(const secret of [c.token,b.link.tokenHash,b.id,b.token,b.link.id])assert.ok(!l.text.includes(secret));assert.ok(!l.text.includes('tokenHash'));}
});
test('шаг 9: expired и повтор scheduler — одно уведомление на получателя',async()=>{
 const c=await create();await prisma.booking.update({where:{id:c.link.bookingId},data:{holdUntil:new Date(Date.now()-1000)}});await runBookingMaintenance({events:X.events});await runBookingMaintenance({events:X.events});assert.equal((await logs('link.expired',c)).length,2);assert.ok((await logs('link.expired',c)).every(l=>l.text.includes('даты освобождены')));
});
test('шаг 9: conflict и повтор submit — один dedupeKey; поздний ремонт сообщает без отказа гостю',async()=>{
 for(const late of [false,true]){const c=await create();await save(c);const b=await prisma.booking.findUnique({where:{id:c.link.bookingId}});const rep=await prisma.repairTask.create({data:{accountId:acc.id,apartmentId:apt.id,title:'Конфликт',date:b.checkIn,blockDays:1,createdAt:new Date(+b.createdAt+(late?1:-1000))}});
 try{assert.equal((await submit(c)).status,late?200:409);assert.equal((await submit(c)).status,late?200:409);await reconcileLinkConflicts();await reconcileLinkConflicts();await runOutbox({events:X.events,keys:[`event:link.conflict:${c.link.id}`]});assert.equal((await logs('link.conflict',c)).length,2);assert.ok((await logs('link.conflict',c)).every(l=>l.text.includes('Сегодня')));}finally{await prisma.repairTask.delete({where:{id:rep.id}});}}
});
test('шаг 9: managerNotify OWNER/ADMIN соблюдается, не-менеджеры не получают',async()=>{
 for(const role of ['OWNER','ADMIN']){await saveSettings(acc.id,{managerNotify:role});const c=await create();await save(c);const ls=await logs('link.started',c);assert.equal(ls.length,1);assert.equal(ls[0].recipientType,role.toLowerCase());}
});
test('шаг 9: частичная ошибка не откатывает данные; retry только failed-получателя',async()=>{
 const c=await create();const from=sent.length;fail=chat=>chat==='step9-admin';assert.equal((await save(c)).status,200);const key=`event:link.started:${c.link.id}`;assert.equal((await prisma.outboxEvent.findUnique({where:{dedupeKey:key}})).attempts,1);assert.ok((await prisma.bookingLink.findUnique({where:{id:c.link.id}})).guestStartedAt);fail=null;assert.equal((await retry(key)).done,1);assert.equal(sent.length-from,2);assert.ok((await logs('link.started',c)).every(l=>l.status==='sent'));await runOutbox({events:X.events,keys:[key]});assert.equal(sent.length-from,2);
});
test('шаг 9: падение после записи доставки до done — повтор не отправляет второй раз',async()=>{
 const c=await create();const key=`event:link.started:${c.link.id}`;const from=sent.length;testHooks.outboxBeforeDone=row=>{if(row.dedupeKey===key)throw new Error('process crash');};await save(c);delete testHooks.outboxBeforeDone;assert.equal(sent.length-from,2);assert.equal((await prisma.outboxEvent.findUnique({where:{dedupeKey:key}})).status,'pending');await retry(key);assert.equal(sent.length-from,2);assert.equal((await prisma.outboxEvent.findUnique({where:{dedupeKey:key}})).status,'done');
});
test('шаг 9: пять ошибок — failed и прежний outbox_failed в Сегодня, бронь сохранена',async()=>{
 const c=await create();fail=()=>true;assert.equal((await save(c)).status,200);const key=`event:link.started:${c.link.id}`;for(let i=1;i<5;i++)await retry(key);const row=await prisma.outboxEvent.findUnique({where:{dedupeKey:key}});assert.equal(row.status,'failed');assert.equal(row.attempts,5);assert.equal((await prisma.booking.findUnique({where:{id:c.link.bookingId}})).status,'request');assert.ok((await todayView(acc.id,{role:'owner'})).items.some(i=>i.kind==='outbox_failed'));fail=null;
});
test('шаг 9: поздняя оплата после занятия дат другим гостем → orphaned, сумма из базы, повтор без дубля', async () => {
 const n=offset;offset+=5;const day=todayIn(acc.timezone);
 const body={apartmentId:apt.id,checkIn:isoDay(addDays(day,n)),checkOut:isoDay(addDays(day,n+2)),guests:1,name:'Гость оплаты',phone:'+77015550099'};
 const first=await request(X.app).post('/api/public/astana-stay/bookings').send(body);assert.equal(first.status,201,JSON.stringify(first.body));
 const b=await prisma.booking.findUnique({where:{token:first.body.token}});
 const pay=await prisma.payment.create({data:{accountId:acc.id,bookingId:b.id,provider:'test',amountKzt:40000,amount:40000,status:'pending'}});
 await prisma.booking.update({where:{id:b.id},data:{holdUntil:new Date(Date.now()-1000)}});
 const second=await request(X.app).post('/api/public/astana-stay/bookings').send({...body,name:'Другой гость',phone:'+77015550100'});assert.equal(second.status,201,JSON.stringify(second.body));
 const result={paymentId:pay.id,status:'succeeded',providerPaymentId:'step9-'+pay.id};
 assert.equal((await applyPaymentResult({prisma,events:X.events,result})).outcome,'orphaned');
 await applyPaymentResult({prisma,events:X.events,result});
 const ls=await prisma.notificationLog.findMany({where:{dedupeKey:{startsWith:`payment.orphaned:${pay.id}:`}}});
 assert.equal(ls.length,2);assert.ok(ls.every(l=>l.text.includes('возврат')&&l.text.includes('40 000')&&l.text.includes('Сегодня')));
 assert.equal((await prisma.booking.findUnique({where:{id:b.id}})).status,'cancelled');
 assert.equal((await prisma.booking.findUnique({where:{token:second.body.token}})).status,'request');
});
test('шаг 9: поздний ремонт в день выезда не теряется из-за полуночи UTC', async () => {
 const c=await create();await save(c);await submit(c);const b=await prisma.booking.findUnique({where:{id:c.link.bookingId}});
 const rep=await prisma.repairTask.create({data:{accountId:acc.id,apartmentId:apt.id,title:'Поздний ремонт',date:b.checkIn,blockDays:1}});
 try {
  await reconcileLinkConflicts({now:new Date(+b.checkOut+4*3600000)});
  await Promise.all([runOutbox({events:X.events,keys:[`event:link.conflict:${c.link.id}`]}),runOutbox({events:X.events,keys:[`event:link.conflict:${c.link.id}`]})]);
  assert.equal((await logs('link.conflict',c)).length,2);
  assert.equal((await prisma.booking.findUnique({where:{id:b.id}})).status,'confirmed');
 } finally {await prisma.repairTask.delete({where:{id:rep.id}});}
});
