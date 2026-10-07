import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { makeApp, prisma, request, freeDates, guestBooking } from './helpers.js';

const X=makeApp(),api=()=>request(X.app),slug='astana-stay';
let account,apartment,offset=3300;const outboxKeys=[];
const book=async()=>{const dates=await freeDates(account.id,apartment.id,2,offset);offset+=4;const response=await api().post(`/api/public/${slug}/bookings`).send({apartmentId:apartment.id,...dates,guests:2,name:'Protected guest',phone:'+77004443322',comment:'internal guest note'});assert.equal(response.status,201);return {response,token:response.body.token,booking:await guestBooking(response.body.token)};};
const page=token=>api().get(`/api/public/${slug}/bookings/${token}/page`);
const payment=booking=>prisma.payment.create({data:{accountId:account.id,bookingId:booking.id,provider:'test',providerPaymentId:'internal-provider-operation',publicRef:crypto.randomBytes(32).toString('base64url'),amountKzt:booking.totalKzt,currency:'KZT',amount:booking.totalKzt,status:'succeeded'}});

before(async()=>{account=await prisma.account.findUnique({where:{slug}});apartment=await prisma.apartment.create({data:{accountId:account.id,title:'Protected private apartment',address:'Астана, ул. Защищённая, 44',district:'Есиль',complex:'ЖК Secure',rooms:'2-комн.',maxGuests:4,basePriceKzt:42000,entrance:'3',floor:12,intercom:'44В',lockCode:'9081',keyboxCode:'7712',wifiName:'Guest Secure',wifiPassword:'private-wifi',accessNote:'Вход со стороны двора',sortOrder:-104}});});
after(async()=>{if(outboxKeys.length)await prisma.outboxEvent.deleteMany({where:{dedupeKey:{in:outboxKeys}}});await prisma.apartment.delete({where:{id:apartment.id}}).catch(()=>{});await prisma.$disconnect();});

test('confirmed capability returns only guest-safe booking data and private instructions',async()=>{
  const x=await book(),p=await payment(x.booking);await prisma.booking.update({where:{id:x.booking.id},data:{status:'confirmed',paymentStatus:'paid',confirmedAt:new Date(),holdUntil:null}});
  await prisma.transfer.create({data:{accountId:account.id,bookingId:x.booking.id,guestId:x.booking.guestId,apartmentId:apartment.id,direction:'in',place:'airport',date:x.booking.checkIn,time:'09:30',flight:'KC-101',pax:2,priceKzt:7000,status:'planned',guestName:'Protected guest',guestPhone:'+77004443322'}});
  const response=await page(x.token);assert.equal(response.status,200);assert.equal(response.body.state,'confirmed');assert.equal(response.body.number,x.booking.number);
  assert.equal(response.body.apartment.address,apartment.address);assert.equal(response.body.instructions.lockCode,'9081');assert.equal(response.body.instructions.wifiPassword,'private-wifi');assert.equal(response.body.payment.paidKzt,x.booking.totalKzt);assert.equal(response.body.transfers[0].status,'planned');
  assert.deepEqual(Object.keys(response.body).sort(),['apartment','checkIn','checkInTime','checkOut','checkOutTime','contact','guestsCount','instructions','nextAction','number','payment','state','status','totalKzt','transfers'].sort());
  const visible=JSON.stringify(response.body);for(const hidden of [x.booking.id,apartment.id,p.id,p.providerPaymentId,x.booking.checkoutKeyHash,'internal guest note'])assert.ok(!visible.includes(String(hidden)),hidden);
  const shell=await api().get(`/booking/${x.token}`);assert.equal(shell.status,200);assert.ok(!shell.text.includes(x.token));assert.equal(shell.headers['referrer-policy'],'no-referrer');assert.equal(shell.headers['cache-control'],'no-store');
});

test('invalid capability reveals nothing and one booking capability cannot select another booking',async()=>{
  const a=await book(),b=await book();
  for(const invalid of [crypto.randomBytes(32).toString('base64url'),a.booking.id,String(a.booking.number),'+77004443322']){const response=await page(invalid);assert.equal(response.status,200);assert.deepEqual(response.body,{state:'invalid'});}
  const own=await page(a.token);assert.equal(own.status,200);assert.equal(own.body.number,a.booking.number);assert.notEqual(own.body.number,b.booking.number);assert.ok(!JSON.stringify(own.body).includes(b.booking.id));
});

test('pending, failed and cancelled states never expose confirmed instructions',async()=>{
  const x=await book();let response=await page(x.token);assert.equal(response.body.state,'payment_pending');assert.ok(!('instructions' in response.body));assert.ok(!('address' in response.body.apartment));
  await prisma.payment.create({data:{accountId:account.id,bookingId:x.booking.id,provider:'test',publicRef:crypto.randomBytes(32).toString('base64url'),amountKzt:x.booking.totalKzt,currency:'KZT',amount:x.booking.totalKzt,status:'failed'}});
  response=await page(x.token);assert.equal(response.body.state,'payment_failed');assert.equal(response.body.nextAction,'retry_payment');assert.ok(!('instructions' in response.body));
  await prisma.booking.update({where:{id:x.booking.id},data:{status:'cancelled'}});response=await page(x.token);assert.equal(response.body.state,'cancelled');assert.equal(response.body.nextAction,'contact_support');assert.ok(!('instructions' in response.body));
});

test('payment_orphaned exposes only neutral manual follow-up',async()=>{
  const x=await book(),p=await payment(x.booking);await prisma.booking.update({where:{id:x.booking.id},data:{status:'cancelled',paymentStatus:'paid'}});
  const dedupeKey=`event:payment.orphaned:${p.id}`;outboxKeys.push(dedupeKey);await prisma.outboxEvent.create({data:{accountId:account.id,kind:'event',dedupeKey,payload:{name:'payment.orphaned',data:{reason:'dates_taken',bookingId:x.booking.id}}}});
  const response=await page(x.token);assert.equal(response.body.state,'payment_orphaned');assert.equal(response.body.nextAction,'contact_support');assert.ok(!('instructions' in response.body));assert.ok(!JSON.stringify(response.body).includes('dates_taken'));assert.ok(!JSON.stringify(response.body).includes(x.booking.id));
});

test('reload reads current server state; completed stay removes address and secrets without client authority',async()=>{
  const x=await book();let response=await page(x.token);assert.equal(response.body.state,'payment_pending');
  await payment(x.booking);await prisma.booking.update({where:{id:x.booking.id},data:{status:'confirmed',paymentStatus:'paid',confirmedAt:new Date(),holdUntil:null}});
  response=await page(x.token);assert.equal(response.body.state,'confirmed');assert.equal(response.body.instructions.keyboxCode,'7712');
  await prisma.booking.update({where:{id:x.booking.id},data:{status:'completed'}});response=await page(x.token);assert.equal(response.body.state,'completed');assert.ok(!('instructions' in response.body));assert.ok(!('address' in response.body.apartment));
  const source=await fs.readFile(new URL('../public/guest/booking.js',import.meta.url),'utf8');assert.ok(!source.includes('localStorage'));assert.ok(!source.includes('Store'));
});
