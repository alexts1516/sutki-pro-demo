import './_env.js';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {makeApp,prisma,request,guestBooking,guestPayment,config} from './helpers.js';
import {createTestPayments} from '../src/payments/test.js';
import {issueOperationKey} from '../src/services/publicCheckout.js';
const secret='step5-signed-test',stub=createTestPayments({callbackSecret:secret});let calls=0;
const X=makeApp({payments:{...stub,async createPayment(args){calls++;return stub.createPayment(args);}}});
const api=()=>request(X.app),base='/api/public/astana-stay',key=()=>issueOperationKey(config,'astana-stay');let apt,account,token,b;
const fields={direction:'in',place:'airport',date:'2038-02-01',time:'12:00',pax:2,childSeats:0};
const order=(k,body=fields)=>api().post(`${base}/bookings/${token}/transfers`).set('Idempotency-Key',k).send(body);
const pay=(ref,k)=>api().post(`${base}/bookings/${token}/transfers/${ref}/pay`).set('Idempotency-Key',k).send({});
const callback=async(p,status='succeeded',amount=p.amount)=>{const raw=JSON.stringify({paymentRef:p.publicRef,operationId:'provider-'+p.publicRef,amount,currency:'KZT',status});return api().post('/api/payments/test/callback').set('Content-Type','application/json').set('X-Test-Signature',crypto.createHmac('sha256',secret).update(raw).digest('hex')).send(raw);};
before(async()=>{account=await prisma.account.findUnique({where:{slug:'astana-stay'}});apt=await prisma.apartment.create({data:{accountId:account.id,title:'Step 5 test',address:'Test',district:'Test',rooms:'1-комн.',maxGuests:4,basePriceKzt:20000}});const r=await api().post(base+'/bookings').send({apartmentId:apt.id,checkIn:fields.date,checkOut:'2038-02-04',guests:2,name:'Transfer guest',phone:'+77001234567'});assert.equal(r.status,201);token=r.body.token;b=await guestBooking(token);await prisma.booking.update({where:{id:b.id},data:{status:'confirmed',paymentStatus:'paid',holdUntil:null}});});
after(()=>prisma.$disconnect());
test('server price, idempotent order/payment, signed success dispatches once without altering stay',async()=>{
 const k=key(),orders=await Promise.all([order(k,{...fields,priceKzt:1}),order(k,{...fields,priceKzt:1})]);assert.deepEqual(orders.map(r=>r.status),[201,201]);const ref=orders[0].body.ref;assert.equal(orders[1].body.ref,ref);assert.equal(orders[0].body.priceKzt,8000);assert.equal(await prisma.transfer.count({where:{bookingId:b.id}}),1);
 const t=await prisma.transfer.findFirst({where:{bookingId:b.id}});assert.equal(await prisma.transferJob.count({where:{transferId:t.id}}),0);
 const pk=key(),n=calls,attempts=await Promise.all([pay(ref,pk),pay(ref,pk)]);assert.ok(attempts.every(r=>[201,202].includes(r.status)));assert.equal(calls,n+1);const p=await guestPayment(attempts[0].body.paymentRef);assert.equal(p.amountKzt,8000);assert.equal(p.transferId,t.id);assert.equal((await pay(ref,key())).status,409);
 await callback(p,'succeeded',1);assert.equal((await prisma.transfer.findUnique({where:{id:t.id}})).paid,false);
 await callback(p);await callback(p);await X.events.idle();assert.equal(await prisma.transferJob.count({where:{transferId:t.id}}),1);const stored=await prisma.transfer.findUnique({where:{id:t.id}});assert.equal(stored.guestPaymentStatus,'PAID');assert.equal(stored.guestPaymentMethod,'online');assert.equal((await guestBooking(token)).status,'confirmed');assert.equal((await guestBooking(token)).totalKzt,b.totalKzt);
 const page=await api().get(`${base}/bookings/${token}/page`);assert.equal(page.body.transfers[0].paymentStatus,'paid');assert.equal(page.body.transfers[0].priceKzt,8000);assert.ok(!JSON.stringify(page.body).includes((await guestPayment(p.publicRef)).providerPaymentId));
});
test('failed transfer payment leaves stay confirmed and permits one explicit new attempt',async()=>{
 const o=await order(key(),{...fields,direction:'out',date:'2038-02-04'});const pk=key(),r=await pay(o.body.ref,pk),p=await guestPayment(r.body.paymentRef);await callback(p,'failed');assert.equal((await guestBooking(token)).status,'confirmed');assert.equal((await pay(o.body.ref,pk)).body.paymentRef,p.publicRef);const next=await pay(o.body.ref,key());assert.notEqual(next.body.paymentRef,p.publicRef);const t=await prisma.transfer.findUnique({where:{id:p.transferId}});assert.equal(t.paid,false);assert.equal(await prisma.transferJob.count({where:{transferId:t.id}}),0);
});
test('order key payload mismatch and foreign booking access are rejected',async()=>{
 const k=key(),o=await order(k,{...fields,time:'15:00'});assert.equal(o.status,201);assert.equal((await order(k,{...fields,time:'16:00'})).status,409);const fake=crypto.randomBytes(32).toString('base64url');assert.equal((await api().post(`${base}/bookings/${fake}/transfers/${o.body.ref}/pay`).set('Idempotency-Key',key())).status,404);
});
