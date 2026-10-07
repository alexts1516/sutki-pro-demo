import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma,config,makeApp,request,freeDates,guestBooking,guestPayment } from './helpers.js';
import { createCloudPayments } from '../src/payments/cloudpayments.js';
import { issueOperationKey } from '../src/services/publicCheckout.js';
const pg=/^postgres(ql)?:/.test(process.env.TEST_DATABASE_URL||'');
const X=makeApp();let acc,apt,body,proof,token,payment;
const callsFile=path.join(os.tmpdir(),`sutki-pass5-provider-${process.pid}.log`);
const child=input=>new Promise((resolve,reject)=>{
 const p=spawn(process.execPath,['scripts/pass5-foundation-child.js'],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>{if(code)reject(new Error('child failed: '+err));else try{resolve(JSON.parse(out));}catch(e){reject(e);}});p.stdin.end(JSON.stringify(input));
});
before(async()=>{if(!pg)return;acc=await prisma.account.findUnique({where:{slug:'astana-stay'}});apt=await prisma.apartment.create({data:{accountId:acc.id,title:'PG foundation',address:'Test',district:'Test',rooms:'Студия',maxGuests:2,basePriceKzt:10000}});body={apartmentId:apt.id,...await freeDates(acc.id,apt.id,2,1600),guests:1,name:'PG guest',phone:'+77000000002'};proof=issueOperationKey(config,'astana-stay');});
after(async()=>{fs.rmSync(callsFile,{force:true});await prisma.$disconnect();});
test('PG: independent checkout processes share one logical Booking/Guest via database guarantees',{skip:!pg},async()=>{
 const before=await prisma.guest.count({where:{accountId:acc.id}});const r=await Promise.all([child({kind:'checkout',key:proof,body}),child({kind:'checkout',key:proof,body})]);assert.deepEqual(r.map(x=>x.status),[201,201]);assert.equal(r[0].number,r[1].number);assert.equal(await prisma.guest.count({where:{accountId:acc.id}}),before+1);
 const replay=await request(X.app).post('/api/public/astana-stay/bookings').set('Idempotency-Key',proof).send(body);token=replay.body.token;
});
test('PG: different operations competing for dates preserve existing overlap protection',{skip:!pg},async()=>{
 const before=await prisma.guest.count({where:{accountId:acc.id}});const d={...body,...await freeDates(acc.id,apt.id,2,1650)};
 const r=await Promise.all([child({kind:'checkout',key:issueOperationKey(config,'astana-stay'),body:d}),child({kind:'checkout',key:issueOperationKey(config,'astana-stay'),body:d})]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(await prisma.guest.count({where:{accountId:acc.id}}),before+1);
});
test('PG: same payment start from independent processes makes one external provider operation',{skip:!pg},async()=>{
 const key=issueOperationKey(config,'astana-stay');const r=await Promise.all([child({kind:'pay',key,token,callsFile}),child({kind:'pay',key,token,callsFile})]);assert.ok(r.every(x=>[201,202].includes(x.status)));assert.equal(r[0].paymentRef,r[1].paymentRef);assert.equal(fs.readFileSync(callsFile,'utf8').trim().split('\n').length,1);payment=await guestPayment(r[0].paymentRef);assert.equal(await prisma.payment.count({where:{bookingId:payment.bookingId}}),1);
});
test('PG: signed duplicate callbacks from independent processes confirm and create downstream once',{skip:!pg},async()=>{
 const C=makeApp({payments:createCloudPayments({publicId:'fixture',apiSecret:'foundation-child-hmac'})});
 const c=await request(C.app).post('/api/public/astana-stay/bookings').send({...body,...await freeDates(acc.id,apt.id,2,1750)});
 token=c.body.token;
 const attempt=await request(C.app).post(`/api/public/astana-stay/bookings/${token}/pay`);
 payment=await guestPayment(attempt.body.paymentRef);
 const payload=JSON.stringify({InvoiceId:payment.publicRef,TransactionId:'pg-one',Amount:payment.amount,Currency:'KZT',Status:'Completed'});const signature=crypto.createHmac('sha256','foundation-child-hmac').update(payload).digest('base64');
 const r=await Promise.all([child({kind:'callback',body:payload,signature}),child({kind:'callback',body:payload,signature})]);assert.ok(r.every(x=>x.status===200&&x.code===0));const b=await guestBooking(token);assert.equal(b.status,'confirmed');assert.equal(await prisma.cleaningTask.count({where:{bookingId:b.id}}),1);assert.equal(await prisma.outboxEvent.count({where:{dedupeKey:`event:booking.confirmed:${b.id}`}}),1);
});
