// Local-only Step 5 preview, isolated test.db and signed test provider; no real payments.
import {makeApp,config,prisma,guestBooking} from '../tests/helpers.js';
import {createTestPayments} from '../src/payments/test.js';
import crypto from 'node:crypto';
import {issueOperationKey} from '../src/services/publicCheckout.js';
const port=8936,base=`http://127.0.0.1:${port}`,secret=crypto.randomBytes(32).toString('hex'),intents=new Map();
const stub=createTestPayments({callbackSecret:secret,publicUrl:base});
const payments={...stub,async createPayment({payment,returnUrl}){intents.set(payment.id,{returnUrl,amount:payment.amount});return {type:'redirect',url:`${base}/__test-payment/${payment.id}`};}};
const {app}=makeApp({config:{...config,publicUrl:base},payments});
app.get('/__test-payment/:ref',(req,res)=>{const intent=intents.get(req.params.ref);if(!intent)return res.status(404).send('Тестовый платёж не найден');res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).type('html').send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Тестовая оплата</title><style>body{font:18px system-ui;background:#f7f5f2;padding:24px}main{max-width:520px;margin:50px auto;background:white;border-radius:18px;padding:28px}button{font:inherit;padding:14px;margin:8px;border-radius:9px;border:0;background:#c9824f;color:white}</style><main><h1>Тестовая оплата картой</h1><p>Списаний нет. Это локальный signed stub.</p><h2>${intent.amount.toLocaleString('ru-RU')} ₸</h2><form method="post"><button name="outcome" value="succeeded">Тест: оплатить успешно</button><button name="outcome" value="failed">Тест: отказ</button></form></main></html>`);});
// App's ordinary final /api error handlers do not intercept this local preview route.
const {default:express}=await import('express');
app.post('/__test-payment/:ref',express.urlencoded({extended:false}),async(req,res)=>{const intent=intents.get(req.params.ref);if(!intent)return res.status(404).send('Тестовый платёж не найден');if(!['succeeded','failed'].includes(req.body.outcome))return res.sendStatus(400);await notify(req.params.ref,req.body.outcome);res.redirect(303,intent.returnUrl);});
async function notify(ref,status){const intent=intents.get(ref),raw=JSON.stringify({paymentRef:ref,operationId:'local-'+ref,amount:intent.amount,currency:'KZT',status});const result=await fetch(base+'/api/payments/test/callback',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Signature':crypto.createHmac('sha256',secret).update(raw).digest('hex')},body:raw});if(!result.ok)throw new Error('Local callback failed');}
const server=app.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const account=await prisma.account.findUnique({where:{slug:'astana-stay'}});
const apartment=await prisma.apartment.create({data:{accountId:account.id,title:'Step 5 local preview',address:'Тестовый адрес, Астана',district:'Есиль',complex:'Тестовая поездка',rooms:'1-комн.',maxGuests:4,basePriceKzt:20000}});
const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const post=async(path,body)=>{const result=await fetch(base+'/api/public/astana-stay'+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':issueOperationKey(config,'astana-stay')},body:JSON.stringify(body)});if(!result.ok)throw new Error('Preview fixture failed: '+result.status);return result.json();};
const b=await post('/bookings',{apartmentId:apartment.id,checkIn:day(10),checkOut:day(13),guests:2,name:'Тестовый гость',phone:'+77001234567'});
const p=await post(`/bookings/${b.token}/pay`,{});await notify(p.paymentRef,'succeeded');
console.log(`LOCAL_STEP5_URL=${base}/booking/${b.token}`);
