// Платежи: CloudPayments (подпись HMAC, Check/Pay/Fail) и PayLink (Basic + RSA-подпись). Никаких реальных запросов.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeApp, prisma, request, freeDates } from './helpers.js';
import { createCloudPayments, verifyCloudPaymentsSignature } from '../src/payments/cloudpayments.js';
import { createPaylink, verifyPaylinkNotification } from '../src/payments/paylink.js';
import { createPaymentProvider } from '../src/payments/index.js';

const SECRET = 'cp_test_api_secret';
const cp = createCloudPayments({ publicId: 'test_api_00000000000000000000002', apiSecret: SECRET });
const { app, events } = makeApp({ payments: cp });
const off = makeApp();
const sign = (body, secret = SECRET) => crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
let booking, pay;

before(async () => {
  const acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  const apt = await prisma.apartment.findFirst({ where: { accountId: acc.id }, orderBy: { sortOrder: 'desc' } });
  const r = await request(app).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...(await freeDates(acc.id, apt.id, 3, 60)), guests: 1, name: 'Карта Тестова', phone: '+77001112233', paymentMethod: 'card' });
  assert.equal(r.status, 201); assert.equal(r.body.payOnline, true);
  booking = r.body;
});
after(() => prisma.$disconnect());

test('провайдер выключен без ключей', async () => {
  assert.equal(createPaymentProvider({ provider: '', cloudpayments: {}, paylink: {} }), null);
  assert.equal(createPaymentProvider({ provider: 'cloudpayments', cloudpayments: { publicId: 'x' }, paylink: {} }), null);
  assert.equal((await request(off.app).post(`/api/public/astana-stay/bookings/${booking.token}/pay`)).status, 409);
  assert.equal((await request(off.app).post('/api/payments/cloudpayments/check').send('a=1')).status, 404);
  assert.equal((await request(off.app).get('/api/public/astana-stay/site')).body.payments.online, false);
});

test('CloudPayments: параметры виджета', async () => {
  const r = await request(app).post(`/api/public/astana-stay/bookings/${booking.token}/pay`);
  assert.equal(r.status, 201);
  assert.equal(r.body.type, 'widget'); assert.match(r.body.script, /widget\.cloudpayments\.ru/);
  assert.equal(r.body.params.publicTerminalId, 'test_api_00000000000000000000002');
  assert.equal(r.body.params.currency, 'KZT'); assert.equal(r.body.params.amount, booking.totalKzt);
  assert.equal(r.body.params.externalId, r.body.paymentId);
  pay = r.body;
});

test('CloudPayments: проверка подписи Content-HMAC и X-Content-HMAC', () => {
  const body = 'InvoiceId=abc&Amount=100.00&Name=%D0%90%D0%BD%D0%BD%D0%B0+%D0%9B%D0%B8';
  assert.ok(verifyCloudPaymentsSignature(body, { 'Content-HMAC': sign(body) }, SECRET));
  assert.ok(verifyCloudPaymentsSignature(body, { 'X-Content-HMAC': sign(decodeURIComponent(body.replace(/\+/g, ' '))) }, SECRET));
  assert.equal(verifyCloudPaymentsSignature(body, { 'Content-HMAC': sign(body, 'other') }, SECRET), false);
  assert.equal(verifyCloudPaymentsSignature(body + '&x=1', { 'Content-HMAC': sign(body) }, SECRET), false);
  assert.equal(verifyCloudPaymentsSignature(body, {}, SECRET), false);
});

const post = (kind, body, hmac = sign(body)) => request(app).post(`/api/payments/cloudpayments/${kind}`).set('Content-Type', 'application/x-www-form-urlencoded').set('Content-HMAC', hmac).send(body);
const form = (o) => new URLSearchParams(o).toString();

test('CloudPayments Check: 13 при плохой подписи, 10 — чужой заказ, 12 — не та сумма, 0 — ок', async () => {
  const ok = form({ TransactionId: '1001', Amount: booking.totalKzt.toFixed(2), Currency: 'KZT', InvoiceId: pay.paymentId, Status: 'Completed' });
  assert.deepEqual((await post('check', ok, sign(ok, 'wrong'))).body, { code: 13 });
  assert.deepEqual((await post('check', form({ TransactionId: '1', Amount: '1.00', Currency: 'KZT', InvoiceId: 'nope' }))).body, { code: 10 });
  const wrong = form({ TransactionId: '1', Amount: '1.00', Currency: 'KZT', InvoiceId: pay.paymentId });
  assert.deepEqual((await post('check', wrong)).body, { code: 12 });
  assert.deepEqual((await post('check', ok)).body, { code: 0 });
  assert.equal((await prisma.payment.findUnique({ where: { id: pay.paymentId } })).status, 'pending');
});

test('CloudPayments Pay (JSON): платёж и бронь оплачены, владелец уведомлён; повтор безопасен', async () => {
  const body = JSON.stringify({ TransactionId: 1001, Amount: booking.totalKzt, Currency: 'KZT', InvoiceId: pay.paymentId, Status: 'Completed' });
  const r = await request(app).post('/api/payments/cloudpayments/pay').set('Content-Type', 'application/json').set('Content-HMAC', sign(body)).send(body);
  assert.deepEqual(r.body, { code: 0 });
  await events.idle();
  const p = await prisma.payment.findUnique({ where: { id: pay.paymentId }, include: { booking: true } });
  assert.equal(p.status, 'succeeded'); assert.equal(p.providerPaymentId, '1001'); assert.equal(p.booking.paymentStatus, 'paid');
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'payment.succeeded', recipientType: 'owner', text: { contains: `№${p.booking.number}` } } }));
  const again = await request(app).post('/api/payments/cloudpayments/pay').set('Content-Type', 'application/json').set('Content-HMAC', sign(body)).send(body);
  assert.deepEqual(again.body, { code: 0 });
  assert.equal(await prisma.notificationLog.count({ where: { event: 'payment.succeeded', text: { contains: `№${p.booking.number}` } } }), 1);
  assert.equal((await request(app).post(`/api/public/astana-stay/bookings/${booking.token}/pay`)).status, 409, 'уже оплачено');
});

test('CloudPayments Fail: платёж помечается failed', async () => {
  const p2 = await prisma.payment.create({ data: { accountId: (await prisma.account.findUnique({ where: { slug: 'astana-stay' } })).id, provider: 'cloudpayments', amountKzt: 5000, amount: 5000, currency: 'KZT' } });
  const body = form({ TransactionId: '2002', Amount: '5000.00', Currency: 'KZT', InvoiceId: p2.id, Reason: 'InsufficientFunds' });
  assert.deepEqual((await post('fail', body)).body, { code: 0 });
  assert.equal((await prisma.payment.findUnique({ where: { id: p2.id } })).status, 'failed');
});

test('PayLink: Basic-авторизация + RSA-подпись уведомления, создание платежа через подменный fetch', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const cfg = { shopId: '361', secretKey: 'pl_secret', publicKey: pubB64 };
  const auth = 'Basic ' + Buffer.from('361:pl_secret').toString('base64');
  const body = JSON.stringify({ transaction: { uid: 'u-1', status: 'successful', amount: 1250000, currency: 'KZT', tracking_id: 'x' } });
  const sig = crypto.sign('sha256', Buffer.from(body), privateKey).toString('base64');
  assert.ok(verifyPaylinkNotification({ rawBody: body, headers: { Authorization: auth, 'Content-Signature': sig }, ...cfg }));
  assert.equal(verifyPaylinkNotification({ rawBody: body + ' ', headers: { Authorization: auth, 'Content-Signature': sig }, ...cfg }), false);
  assert.equal(verifyPaylinkNotification({ rawBody: body, headers: { Authorization: 'Basic eDp5', 'Content-Signature': sig }, ...cfg }), false);

  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ checkout: { token: 'tok', redirect_url: 'https://checkout.paylink.kz/v2/checkout?token=tok' } }) }; };
  const pl = createPaylink({ ...cfg, testMode: true, publicUrl: 'https://api.example.kz', fetchImpl });
  const intent = await pl.createPayment({ payment: { id: 'pay_1', amount: 12500, currency: 'KZT' }, description: 'Бронь №1', returnUrl: 'https://site/ok' });
  assert.equal(intent.type, 'redirect'); assert.match(intent.url, /checkout\.paylink\.kz/);
  assert.equal(calls[0].url, 'https://checkout.paylink.kz/ctp/api/checkouts');
  assert.equal(calls[0].opts.headers.Authorization, auth); assert.equal(calls[0].opts.headers['X-API-Version'], '2');
  const sentBody = JSON.parse(calls[0].opts.body);
  assert.equal(sentBody.checkout.order.amount, 1250000); assert.equal(sentBody.checkout.order.tracking_id, 'pay_1');
  assert.equal(sentBody.checkout.settings.notification_url, 'https://api.example.kz/api/payments/paylink/notify');

  // полный путь через сервер
  const plApp = makeApp({ payments: pl });
  const acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  const p = await prisma.payment.create({ data: { accountId: acc.id, provider: 'paylink', amountKzt: 12500, amount: 12500, currency: 'KZT' } });
  const nb = JSON.stringify({ transaction: { uid: 'u-2', status: 'successful', amount: 1250000, currency: 'KZT', tracking_id: p.id } });
  const ns = crypto.sign('sha256', Buffer.from(nb), privateKey).toString('base64');
  assert.equal((await request(plApp.app).post('/api/payments/paylink/notify').set('Content-Type', 'application/json').set('Authorization', auth).set('Content-Signature', 'AAAA').send(nb)).status, 401);
  const ok = await request(plApp.app).post('/api/payments/paylink/notify').set('Content-Type', 'application/json').set('Authorization', auth).set('Content-Signature', ns).send(nb);
  assert.equal(ok.status, 200);
  assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'succeeded');
});
