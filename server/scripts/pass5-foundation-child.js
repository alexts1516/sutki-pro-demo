// Independent PostgreSQL test process; secrets arrive over stdin, not command arguments/logs.
import '../tests/_env.js';
import fs from 'node:fs';
import { makeApp, request, prisma } from '../tests/helpers.js';
import { createCloudPayments } from '../src/payments/cloudpayments.js';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const payments=input.kind==='callback' ? createCloudPayments({publicId:'fixture',apiSecret:'foundation-child-hmac'}) : {
 name:'test',async createPayment({payment}){fs.appendFileSync(input.callsFile,payment.id+'\n');return {type:'redirect',url:'https://pay.example/'+payment.id};}
};
const {app}=makeApp({payments});
let r;
if(input.kind==='checkout') r=await request(app).post('/api/public/astana-stay/bookings').set('Idempotency-Key',input.key).send(input.body);
if(input.kind==='pay') r=await request(app).post(`/api/public/astana-stay/bookings/${input.token}/pay`).set('Idempotency-Key',input.key);
if(input.kind==='callback') r=await request(app).post('/api/payments/cloudpayments/pay').set('Content-Type','application/json').set('Content-HMAC',input.signature).send(input.body);
process.stdout.write(JSON.stringify({status:r.status,number:r.body.number,paymentRef:r.body.paymentRef,code:r.body.code}));
await prisma.$disconnect();
process.exit(0);
