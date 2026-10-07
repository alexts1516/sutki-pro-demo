import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeApp, prisma, request, config, freeDates, guestBooking, guestPayment } from './helpers.js';
import { issueOperationKey } from '../src/services/publicCheckout.js';
import { digest } from '../src/lib/publicDtos.js';
import { createCloudPayments } from '../src/payments/cloudpayments.js';
const calls=[];
const provider={name:'test',async createPayment({payment}){calls.push(payment.id);await new Promise(r=>setTimeout(r,20));return {type:'redirect',url:'https://pay.example/'+payment.id};}};
const X=makeApp({payments:provider}), api=()=>request(X.app), slug='astana-stay';
let account,apt,offset=1200;
const key=()=>issueOperationKey(config,slug);
const book=async(k=key(),extra={})=>{const dates=await freeDates(account.id,apt.id,2,offset);offset+=4;const body={apartmentId:apt.id,...dates,guests:1,name:'Foundation guest',phone:'+77000000001',...extra};return {body,k,response:await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',k).send(body)};};
const start=(token,k)=>api().post(`/api/public/${slug}/bookings/${token}/pay`).set('Idempotency-Key',k).send({});
before(async()=>{account=await prisma.account.findUnique({where:{slug}});apt=await prisma.apartment.create({data:{accountId:account.id,title:'Foundation private apartment',address:'Private address, кв. 800',district:'Test',rooms:'Студия',maxGuests:2,basePriceKzt:10000}});});
after(()=>prisma.$disconnect());

test('public DTO allow-list, media refs and non-authorizing internal ids',async()=>{
 const list=await api().get(`/api/public/${slug}/apartments`);assert.equal(list.status,200);assert.ok(list.body.length);
 for(const a of list.body){assert.ok(a.ref);assert.ok(!('id' in a));assert.ok(!('code' in a));for(const p of a.photos)assert.ok(!('id' in p));}
 const a=list.body.find(a=>a.district==='Test');const detail=await api().get(`/api/public/${slug}/apartments/${a.ref}`);assert.equal(detail.status,200);assert.ok(!JSON.stringify(detail.body).includes(apt.id));assert.ok(!JSON.stringify(detail.body).includes(account.id));
 const b=await book();const dto=(await api().get(`/api/public/${slug}/bookings/${b.response.body.token}`)).body;
 assert.deepEqual(Object.keys(dto).sort(),['number','status','checkIn','checkOut','checkInTime','checkOutTime','guestsCount','nights','nightlyKzt','totalKzt','currency','amountShown','paymentMethod','paymentStatus','holdUntil','pets','petFeeKzt','apartment'].sort());
 assert.ok(!JSON.stringify(dto).includes(b.response.body.token));assert.ok(!JSON.stringify(dto).includes('Private address'));assert.ok(!JSON.stringify(dto).includes(account.id));
});
test('server-issued checkout proof cannot be fabricated or moved to another account',async()=>{
 const issued=await api().post(`/api/public/${slug}/operation-key`);assert.equal(issued.status,201);assert.match(issued.body.operationKey,/^[\w-]{43}\.[\w-]{43}$/);
 const bad=await book('a'.repeat(43));assert.equal(bad.response.status,400);
 const scoped=await api().post('/api/public/demo-b/bookings').set('Idempotency-Key',issued.body.operationKey).send({});assert.equal(scoped.status,400);
});
test('access entropy/hash-at-rest, no number/phone/id enumeration and tenant isolation',async()=>{
 const a=await book(),b=await book();const secret=a.response.body.token;assert.match(secret,/^[\w-]{43}$/);assert.notEqual(secret,b.response.body.token);
 const stored=await prisma.booking.findUnique({where:{guestAccessHash:digest(secret)}});assert.ok(stored);assert.notEqual(stored.token,secret);assert.equal(stored.guestAccessHash,digest(secret));
 for(const token of ['short',String(stored.number),stored.id,'+77000000001',crypto.randomBytes(32).toString('base64url')])assert.equal((await api().get(`/api/public/${slug}/bookings/${token}`)).status,404);
 assert.equal((await api().get(`/api/public/demo-b/bookings/${secret}`)).status,404);
 assert.equal((await api().get(`/api/public/${slug}/bookings/${b.response.body.token}`)).body.number,b.response.body.number);
 const got=await api().get(`/api/public/${slug}/bookings/${secret}`);assert.equal(got.status,200);assert.equal(got.headers['referrer-policy'],'no-referrer');assert.equal(got.headers['cache-control'],'no-store');
});
test('same checkout sequential/concurrent/lost response produces one Booking and Guest; payload mismatch rejects',async()=>{
 const b=await book(),before=await prisma.guest.count({where:{accountId:account.id}});
 const replies=await Promise.all([1,2,3].map(()=>api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',b.k).send(b.body)));
 for(const r of replies){assert.equal(r.status,201);assert.equal(r.body.number,b.response.body.number);assert.equal(r.body.token,b.response.body.token);}
 assert.equal(await prisma.guest.count({where:{accountId:account.id}}),before);
 assert.equal(await prisma.booking.count({where:{guestAccessHash:digest(b.response.body.token)}}),1);
 assert.equal((await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',b.k).send({...b.body,name:'different'})).status,409);
 const other=await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',key()).send(b.body);assert.equal(other.status,409);
 assert.equal(await prisma.guest.count({where:{accountId:account.id}}),before);
});
test('simultaneous first checkout, not only replay, creates one guest and hold',async()=>{
 const k=key(),dates=await freeDates(account.id,apt.id,2,offset);offset+=4;const body={apartmentId:apt.id,...dates,guests:1,name:'First race',phone:'+77000000001'};
 const before=await prisma.guest.count({where:{accountId:account.id}});const rs=await Promise.all([1,2].map(()=>api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',k).send(body)));
 assert.deepEqual(rs.map(r=>r.status),[201,201]);assert.equal(rs[0].body.number,rs[1].body.number);assert.equal(await prisma.guest.count({where:{accountId:account.id}}),before+1);
});
test('attempt same key sequential/concurrent calls provider once; another key while pending is blocked',async()=>{
 const b=await book(),k=key(),n=calls.length;const rs=await Promise.all([start(b.response.body.token,k),start(b.response.body.token,k)]);
 assert.ok(rs.every(r=>[201,202].includes(r.status)));assert.equal(calls.length,n+1);assert.equal(rs[0].body.paymentRef,rs[1].body.paymentRef);
 const replay=await start(b.response.body.token,k);assert.equal(replay.status,201);assert.equal(calls.length,n+1);assert.ok(!('paymentId' in replay.body));
 assert.equal((await start(b.response.body.token,key())).status,409);const bk=await guestBooking(b.response.body.token);assert.equal(await prisma.payment.count({where:{bookingId:bk.id}}),1);
});
test('uncertain external result is durable and not silently retried across app instances',async()=>{
 let count=0;const uncertain={...createCloudPayments({publicId:'fixture',apiSecret:'uncertain-hmac'}),async createPayment(){count++;throw new Error('upstream timeout');}};
 const U=makeApp({payments:uncertain}),b=await book(),k=key();let r=await request(U.app).post(`/api/public/${slug}/bookings/${b.response.body.token}/pay`).set('Idempotency-Key',k);assert.equal(r.status,202);
 const V=makeApp({payments:uncertain});r=await request(V.app).post(`/api/public/${slug}/bookings/${b.response.body.token}/pay`).set('Idempotency-Key',k);assert.equal(r.status,202);assert.equal(count,1);
 assert.equal((await request(V.app).post(`/api/public/${slug}/bookings/${b.response.body.token}/pay`).set('Idempotency-Key',key())).status,409);
 const payload=JSON.stringify({InvoiceId:r.body.paymentRef,TransactionId:'uncertain-one',Amount:b.response.body.totalKzt,Currency:'KZT'});
 await request(V.app).post('/api/payments/cloudpayments/fail').set('Content-Type','application/json').set('Content-HMAC',crypto.createHmac('sha256','uncertain-hmac').update(payload).digest('base64')).send(payload);
 assert.equal((await guestPayment(r.body.paymentRef)).status,'failed');
 assert.equal((await request(V.app).post(`/api/public/${slug}/bookings/${b.response.body.token}/pay`).set('Idempotency-Key',key())).status,202);assert.equal(count,2);
});
test('signed failure permits a fresh attempt; operation/amount mismatch and concurrent callback cannot repeat downstream',async()=>{
 const secret='fixture-hmac-secret',cp=createCloudPayments({publicId:'fixture',apiSecret:secret}),C=makeApp({payments:cp});const b=await book();const begin=async k=>request(C.app).post(`/api/public/${slug}/bookings/${b.response.body.token}/pay`).set('Idempotency-Key',k);
 const post=async(kind,fields)=>{const body=JSON.stringify(fields);return request(C.app).post('/api/payments/cloudpayments/'+kind).set('Content-Type','application/json').set('Content-HMAC',crypto.createHmac('sha256',secret).update(body).digest('base64')).send(body);};
 const k=key(),p=(await begin(k)).body,base={InvoiceId:p.paymentRef,TransactionId:'one',Amount:b.response.body.totalKzt,Currency:'KZT'};
 assert.equal((await post('check',{...base,Amount:1})).body.code,12);assert.equal((await guestPayment(p.paymentRef)).status,'created');
 assert.equal((await post('check',base)).body.code,0);assert.equal((await post('pay',{...base,TransactionId:'foreign',Status:'Completed'})).body.code,13);
 await post('fail',base);assert.equal((await guestPayment(p.paymentRef)).status,'failed');assert.equal((await begin(k)).body.status,'failed');
 const second=(await begin(key())).body;assert.notEqual(second.paymentRef,p.paymentRef);const next={...base,InvoiceId:second.paymentRef,TransactionId:'two',Status:'Completed'};
 const dup=await Promise.all([post('pay',next),post('pay',next)]);assert.ok(dup.every(r=>r.body.code===0));const bk=await guestBooking(b.response.body.token);assert.equal(bk.status,'confirmed');assert.equal(await prisma.cleaningTask.count({where:{bookingId:bk.id}}),1);
 const replay=await begin(k);assert.equal(replay.body.status,'failed'); // old failed identity is not rewritten to the newer attempt
});
test('public write/access limits and ordinary flow are independently testable',async()=>{
 const limited=makeApp({config:{...config,rateLimit:{publicWriteMax:2,publicMax:100,publicBadMax:2}},payments:provider});
 let fakeIp=0;const q=()=>request(limited.app).post(`/api/public/${slug}/operation-key`).set('X-Forwarded-For','198.51.100.'+(++fakeIp));assert.equal((await q()).status,201);assert.equal((await q()).status,201);assert.equal((await q()).status,429);
 const bad=makeApp({config:{...config,rateLimit:{publicWriteMax:100,publicMax:100,publicBadMax:2}}});
 const get=()=>request(bad.app).get(`/api/public/${slug}/bookings/invalid`);assert.equal((await get()).status,404);assert.equal((await get()).status,404);assert.equal((await get()).status,429);
});
test('public errors/logs do not echo booking capability, checkout proof or stored hash',async()=>{
 const b=await book();const logs=[];const logger={error(...a){logs.push(a);},warn(){},log(){}};
 const {createApp}=await import('../src/app.js');const base=makeApp();const app=createApp({config,logger,events:base.events,storage:base.storage});
 const find=prisma.booking.findFirst;prisma.booking.findFirst=async()=>{throw new Error(b.response.body.token+' '+digest(b.response.body.token));};
 try{const r=await request(app).get(`/api/public/${slug}/bookings/${b.response.body.token}`);assert.equal(r.status,500);assert.ok(!JSON.stringify([r.body,logs]).includes(b.response.body.token));assert.ok(!JSON.stringify([r.body,logs]).includes(digest(b.response.body.token)));}finally{prisma.booking.findFirst=find;}
});
test('migration supports an existing legacy row without reusing its plaintext Telegram binder as public access',async()=>{
 const raw=crypto.randomBytes(12).toString('base64url');const b=await prisma.booking.create({data:{accountId:account.id,apartmentId:apt.id,number:99999300,token:raw,source:'site',status:'cancelled',checkIn:new Date('2039-01-01'),checkOut:new Date('2039-01-02'),guestsCount:1,nightlyKzt:10000,totalKzt:10000}});
 assert.equal(b.guestAccessHash,null);assert.equal((await api().get(`/api/public/${slug}/bookings/${raw}`)).status,404);
});
test('demo crypto shim implements the same HMAC security primitive (not a signature stub)',async()=>{
 const shim=await import('../demo/shims/node-crypto.js');for(const k of ['key','x'.repeat(90)])assert.equal(shim.createHmac('sha256',k).update('foundation').digest('hex'),crypto.createHmac('sha256',k).update('foundation').digest('hex'));
});
