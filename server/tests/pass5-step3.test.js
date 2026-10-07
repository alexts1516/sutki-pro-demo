import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeApp, prisma, request, config, freeDates, guestBooking, guestPayment } from './helpers.js';
import { issueOperationKey } from '../src/services/publicCheckout.js';
import { createTestPayments } from '../src/payments/test.js';
import { orphanKey } from '../src/payments/index.js';

const slug='astana-stay',secret='pass5-step3-signed-stub';
const payments=createTestPayments({callbackSecret:secret,publicUrl:config.publicUrl});
const X=makeApp({payments}),api=()=>request(X.app);
const seen=[];X.events.onAny((data,name)=>seen.push({name,...data}));
let account,apartment,offset=2700;
const key=()=>issueOperationKey(config,slug);
const sign=raw=>crypto.createHmac('sha256',secret).update(raw).digest('hex');
const callback=async(fields,{valid=true}={})=>{const raw=JSON.stringify(fields);return api().post('/api/payments/test/callback').set('Content-Type','application/json').set('X-Test-Signature',valid?sign(raw):'bad').send(raw);};
const book=async(dates=null)=>{dates ||= await freeDates(account.id,apartment.id,2,offset);offset+=4;const response=await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',key()).send({apartmentId:apartment.id,...dates,guests:1,name:'Step 3 guest',phone:'+77005553322'});assert.equal(response.status,201,JSON.stringify(response.body));return {dates,response,token:response.body.token,booking:await guestBooking(response.body.token)};};
const start=async(token,k=key())=>{const response=await api().post(`/api/public/${slug}/bookings/${token}/pay`).set('Idempotency-Key',k).send({});assert.ok([201,202].includes(response.status),JSON.stringify(response.body));return {key:k,response,payment:await guestPayment(response.body.paymentRef)};};
const result=(payment,status='succeeded',operationId='stub-operation')=>({paymentRef:payment.publicRef,operationId,amount:payment.amount,currency:payment.currency,status});

before(async()=>{account=await prisma.account.findUnique({where:{slug}});apartment=await prisma.apartment.create({data:{accountId:account.id,title:'Step 3 private apartment',address:'Step 3 address, кв. 903',district:'Test',rooms:'1-комн.',maxGuests:2,basePriceKzt:31000,sortOrder:-103}});});
after(async()=>{await prisma.apartment.delete({where:{id:apartment.id}}).catch(()=>{});await prisma.$disconnect();});

test('verified success confirms once; duplicate callback and browser return are non-authoritative',async()=>{
  const b=await book(),p=await start(b.token);
  const returned=await api().get(`/api/public/${slug}/payment-return?paymentRef=${p.payment.publicRef}`);
  assert.equal(returned.status,303);assert.match(returned.headers.location,/^\/?\?payment=processing/);
  assert.equal((await guestBooking(b.token)).status,'request');
  const payload=result(p.payment);
  assert.equal((await callback(payload)).status,200);await X.events.idle();
  let stored=await guestBooking(b.token);assert.equal(stored.status,'confirmed');assert.equal(stored.paymentStatus,'paid');
  assert.equal(await prisma.cleaningTask.count({where:{bookingId:stored.id}}),1);
  for(let i=0;i<3;i++)assert.equal((await callback(payload)).status,200);
  await X.events.idle();stored=await guestBooking(b.token);
  assert.equal(stored.status,'confirmed');assert.equal(await prisma.cleaningTask.count({where:{bookingId:stored.id}}),1);
  assert.equal(seen.filter(e=>e.name==='booking.confirmed'&&e.bookingId===stored.id).length,1);
});

test('invalid signature, wrong amount and missing provider operation never confirm',async()=>{
  const b=await book(),p=await start(b.token),base=result(p.payment);
  assert.equal((await callback(base,{valid:false})).status,401);
  assert.equal((await callback({...base,amount:base.amount+1})).status,200);
  assert.equal((await callback({...base,operationId:''})).status,200);
  assert.equal((await guestBooking(b.token)).status,'request');assert.equal((await guestPayment(p.payment.publicRef)).status,'created');
});

test('FAIL and CANCEL keep the hold unconfirmed; HTTP replay reuses attempt and explicit retry creates a new one',async()=>{
  const b=await book(),first=await start(b.token);
  await callback(result(first.payment,'failed','failed-operation'));
  const replay=await start(b.token,first.key);assert.equal(replay.payment.publicRef,first.payment.publicRef);
  const second=await start(b.token,key());assert.notEqual(second.payment.publicRef,first.payment.publicRef);
  await callback(result(second.payment,'cancelled','cancelled-operation'));
  assert.equal((await guestBooking(b.token)).status,'request');assert.equal((await guestPayment(second.payment.publicRef)).status,'cancelled');
  const third=await start(b.token,key());assert.notEqual(third.payment.publicRef,second.payment.publicRef);
  assert.equal(await prisma.payment.count({where:{bookingId:b.booking.id}}),3);
});

test('late verified success with free dates restores the same Booking',async()=>{
  const b=await book(),p=await start(b.token);await prisma.booking.update({where:{id:b.booking.id},data:{holdUntil:new Date(Date.now()-1000)}});
  await callback(result(p.payment,'succeeded','late-free'));await X.events.idle();
  const stored=await guestBooking(b.token);assert.equal(stored.id,b.booking.id);assert.equal(stored.status,'confirmed');assert.equal(stored.paymentStatus,'paid');
  assert.equal(await prisma.booking.count({where:{id:b.booking.id}}),1);assert.equal(await prisma.cleaningTask.count({where:{bookingId:b.booking.id}}),1);
});

test('late verified success with occupied dates creates payment_orphaned without a second Booking',async()=>{
  const b=await book(),p=await start(b.token);await prisma.booking.update({where:{id:b.booking.id},data:{holdUntil:new Date(Date.now()-1000)}});
  const other=await book(b.dates);assert.notEqual(other.booking.id,b.booking.id);
  await callback(result(p.payment,'succeeded','late-occupied'));await X.events.idle();
  const old=await guestBooking(b.token);assert.equal(old.status,'cancelled');assert.equal(old.paymentStatus,'paid');
  assert.equal((await guestBooking(other.token)).status,'request');assert.equal(await prisma.cleaningTask.count({where:{bookingId:old.id}}),0);
  assert.equal(await prisma.outboxEvent.count({where:{dedupeKey:orphanKey(p.payment.id)}}),1);
  assert.equal(await prisma.booking.count({where:{apartmentId:apartment.id,checkIn:old.checkIn,checkOut:old.checkOut}}),2);
});
