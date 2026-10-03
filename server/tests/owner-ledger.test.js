// Деньги через бизнес: гость платит бизнесу, бизнес должен водителю (DriverPayout, только если выплата > 0);
// везёт сам владелец или человек «от бизнеса» — выплаты нет, вся цена — маржа бизнеса.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, freeDates } from './helpers.js';
import { computePayout } from '../src/services/payouts.js';

const sent = [];
const transport = { name: 'mock', async send(chatId, text, opts) { sent.push({ chatId, text, opts }); return { ok: true }; } };
const { app, events } = makeApp({ transport });
let acc, apt, owner, admin, ruslan, users = {};
let start = 600;

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false }, orderBy: { sortOrder: 'desc' } });
  [owner, admin, ruslan] = await Promise.all(['azamat@astanastay.example', 'alina@astanastay.example', 'ruslan@astanastay.example'].map(e => login(app, e)));
  for (const e of ['azamat', 'alina', 'ruslan']) users[e] = await prisma.user.findUnique({ where: { email: `${e}@astanastay.example` } });
  // комиссия 20%: наёмный водитель получает 80%
  assert.equal((await request(app).put('/api/admin/settings').set(owner.auth).send({ transferPayoutMode: 'PERCENT', ownerCommissionPercent: 20 })).status, 200);
});
after(async () => {
  await events.idle();
  await prisma.accountSettings.deleteMany({ where: { accountId: acc.id } });
  await prisma.membership.updateMany({ where: { accountId: acc.id }, data: { payoutPercent: null, payoutFixedKzt: null, paidAsDriver: true } });
  await prisma.user.updateMany({ where: { id: { in: Object.values(users).map(u => u.id) } }, data: { telegramId: null } });
  await prisma.$disconnect();
});

async function confirmedJob(priceKzt = 10000) {
  const dates = await freeDates(acc.id, apt.id, 2, start); start += 5;
  const b = await request(app).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 2, name: 'Олжас Ким', phone: '+7 701 222 33 44', paymentMethod: 'cash' });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const t = await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '12:00', flight: 'KC 901', pax: 1, bags: 1 });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  await prisma.transfer.update({ where: { id: t.body.id }, data: { priceKzt } });
  const booking = await prisma.booking.findUnique({ where: { token: b.body.token } });
  assert.equal((await request(app).post(`/api/admin/bookings/${booking.id}/confirm`).set(owner.auth)).status, 200);
  await events.idle();
  const job = await prisma.transferJob.findUnique({ where: { transferId: t.body.id } });
  // цену поменяли после создания заказа — пересчитать по правилам
  await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ payoutAuto: true });
  return { job, month: dates.checkIn.slice(0, 7) };
}
const finish = async (id) => { for (const action of ['picked-up', 'done']) assert.equal((await request(app).post(`/api/admin/transfer-jobs/${id}/status`).set(owner.auth).send({ action })).status, 200); };
const card = async (id) => (await request(app).get(`/api/admin/transfer-jobs/${id}`).set(owner.auth)).body;
const finance = async (month) => (await request(app).get(`/api/admin/finance?month=${month}`).set(owner.auth)).body;

test('правило «везёт владелец»: выплата 0, вся цена бизнесу; можно выключить; «свой человек» (paidAsDriver=false) — тоже без выплаты', () => {
  const settings = { ownerCommissionPercent: 20, ownerDrivesKeepsAll: true };
  assert.deepEqual(computePayout({ priceKzt: 10000, settings, driver: { role: 'owner' } }), { payoutKzt: 0, commissionKzt: 10000, rule: 'owner', percent: 100 });
  assert.equal(computePayout({ priceKzt: 10000, settings, driver: { role: 'owner' }, manualKzt: 5000 }).rule, 'owner');   // и ручная сумма не создаёт выплату
  assert.equal(computePayout({ priceKzt: 10000, settings: { ...settings, ownerDrivesKeepsAll: false }, driver: { role: 'owner' } }).payoutKzt, 8000);
  assert.equal(computePayout({ priceKzt: 10000, settings, driver: { role: 'admin', paidAsDriver: false } }).rule, 'business');
  assert.equal(computePayout({ priceKzt: 10000, settings, driver: { role: 'admin', paidAsDriver: true } }).payoutKzt, 8000);
  assert.equal(computePayout({ priceKzt: 10000, settings, driver: { payoutPercent: null } }).payoutKzt, 8000);   // подрядчик — всегда по ставке
});

test('везёт сам владелец: выплаты нет, долга водителю нет, в финансах — 100% маржа; ручную выплату задать нельзя', async () => {
  const { job, month } = await confirmedJob(10000);
  const before = await finance(month);
  const a = await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(owner.auth).send({});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.noPayout, true); assert.equal(a.body.payoutKzt, 0);
  let c = await card(job.id);
  assert.equal(c.payoutKzt, 0); assert.equal(c.commissionKzt, 10000); assert.equal(c.payoutRule, 'owner'); assert.equal(c.noPayout, true);
  assert.equal((await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ payoutKzt: 3000 })).status, 409);
  await finish(job.id);
  c = await card(job.id);
  assert.equal(c.payoutRecord, null);
  assert.equal(await prisma.driverPayout.count({ where: { jobId: job.id } }), 0);
  assert.equal((await request(app).post(`/api/admin/transfer-jobs/${job.id}/paid`).set(owner.auth).send({ paid: true })).status, 409);
  const f = await finance(month);
  assert.equal(f.transfersRevenueKzt - before.transfersRevenueKzt, 10000);
  assert.equal(f.transfersPayoutKzt - before.transfersPayoutKzt, 0);
  assert.equal(f.transfersMarginKzt - before.transfersMarginKzt, 10000);
  assert.equal(f.transfersOwnTrips - before.transfersOwnTrips, 1);
});

test('наёмный водитель: выплата по комиссии 20%, после поездки — долг PENDING, «выплачено» — PAID с кем и когда', async () => {
  const { job, month } = await confirmedJob(10000);
  const before = await finance(month);
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth).send({})).status, 200);
  let c = await card(job.id);
  assert.equal(c.payoutKzt, 8000); assert.equal(c.commissionKzt, 2000); assert.equal(c.payoutRule, 'account'); assert.equal(c.payoutRecord, null);   // долг — только после поездки
  await finish(job.id);
  c = await card(job.id);
  assert.equal(c.payoutRecord.status, 'PENDING'); assert.equal(c.payoutRecord.amountKzt, 8000);
  let f = await finance(month);
  assert.equal(f.transfersUnpaidKzt - before.transfersUnpaidKzt, 8000);
  assert.equal(f.transfersMarginKzt - before.transfersMarginKzt, 2000);
  const p = await request(app).post(`/api/admin/transfer-jobs/${job.id}/paid`).set(admin.auth).send({ paid: true });
  assert.equal(p.status, 200);
  assert.equal(p.body.payoutRecord.status, 'PAID'); assert.equal(p.body.payoutRecord.byName, users.alina.name); assert.ok(p.body.payoutRecord.paidAt);
  f = await finance(month);
  assert.equal(f.transfersUnpaidKzt - before.transfersUnpaidKzt, 0);
  assert.equal(f.transfersPaidOutKzt - before.transfersPaidOutKzt, 8000);
  // водитель видит свою выплату и «выплачено», но не цену и не комиссию
  const d = await request(app).get(`/api/staff/transfers/${job.id}`).set(ruslan.auth);
  assert.equal(d.body.payoutKzt, 8000); assert.equal(d.body.paid, true);
  assert.ok(!('priceKzt' in d.body) && !('commissionKzt' in d.body));
});

test('оплата гостя записывается бизнесу (наличные/карта/онлайн) и попадает в финансы; водитель её не видит', async () => {
  const { job, month } = await confirmedJob(9000);
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth).send({})).status, 200);
  const url = `/api/admin/transfer-jobs/${job.id}/guest-payment`;
  assert.equal((await request(app).post(url).set(owner.auth).send({ status: 'PAID' })).status, 400);   // способ обязателен
  assert.equal((await request(app).post(url).set(ruslan.auth).send({ status: 'PAID', method: 'cash' })).status, 403);   // водитель — не может
  const g = await request(app).post(url).set(admin.auth).send({ status: 'PAID', method: 'cash' });
  assert.equal(g.status, 200);
  assert.deepEqual({ status: g.body.guestPayment.status, method: g.body.guestPayment.method, byName: g.body.guestPayment.byName }, { status: 'PAID', method: 'cash', byName: users.alina.name });
  const t = await prisma.transfer.findUnique({ where: { id: job.transferId } });
  assert.equal(t.guestPaymentStatus, 'PAID'); assert.equal(t.paid, true);
  // водитель: ни в приложении, ни в списке нет оплаты гостя
  const d = await request(app).get(`/api/staff/transfers/${job.id}`).set(ruslan.auth);
  const list = await request(app).get('/api/staff/transfers').set(ruslan.auth);
  for (const body of [d.body, list.body]) assert.ok(!/guestPay|guestPaid/.test(JSON.stringify(body)), 'водителю ушла оплата гостя');
  const before = await finance(month);
  await finish(job.id);
  const f = await finance(month);
  assert.equal(f.transfersRevenueKzt - before.transfersRevenueKzt, 9000);
  assert.equal(f.transfersGuestPaidKzt - before.transfersGuestPaidKzt, 9000);
  assert.equal(f.transfersPayoutKzt - before.transfersPayoutKzt, 7200);
  // снять отметку
  const u = await request(app).post(url).set(owner.auth).send({ status: 'UNPAID' });
  assert.equal(u.body.guestPayment.status, 'UNPAID');
});

test('человек «от бизнеса»: владелец выключает «платим как водителю» у админа — его поездки без выплаты; админ сам себе это не включит', async () => {
  assert.equal((await request(app).patch(`/api/admin/team/${users.alina.id}`).set(admin.auth).send({ paidAsDriver: false })).status, 403);
  assert.equal((await request(app).patch(`/api/admin/team/${users.azamat.id}`).set(owner.auth).send({ paidAsDriver: false })).status, 400);   // для владельца — настройка аккаунта
  assert.equal((await request(app).patch(`/api/admin/team/${users.alina.id}`).set(owner.auth).send({ paidAsDriver: false })).status, 200);
  const { job } = await confirmedJob(10000);
  const offer = (await request(app).get(`/api/staff/transfers/${job.id}`).set(admin.auth)).body;
  assert.equal(offer.noPayout, true);   // в предложении — «без выплаты»
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(admin.auth).send({})).status, 200);
  const c = await card(job.id);
  assert.equal(c.payoutRule, 'business'); assert.equal(c.payoutKzt, 0); assert.equal(c.commissionKzt, 10000);
  await finish(job.id);
  assert.equal(await prisma.driverPayout.count({ where: { jobId: job.id } }), 0);
  await request(app).patch(`/api/admin/team/${users.alina.id}`).set(owner.auth).send({ paidAsDriver: true });
});

test('«Везёт сам владелец» выключено — владелец получает выплату по ставке; Telegram-предложение владельцу — «без выплаты», водителю — его сумма', async () => {
  await prisma.user.update({ where: { id: users.azamat.id }, data: { telegramId: '700000901' } });
  await prisma.user.update({ where: { id: users.ruslan.id }, data: { telegramId: '700000902' } });
  sent.length = 0;
  const { job: j1 } = await confirmedJob(10000);
  await events.idle();
  const toOwner = sent.find(m => m.chatId === '700000901' && m.text.includes('KC 901') && m.opts?.buttons);
  const toDriver = sent.find(m => m.chatId === '700000902' && m.text.includes('KC 901') && m.opts?.buttons);
  assert.ok(toOwner && /Без выплаты/.test(toOwner.text), toOwner?.text);
  assert.ok(toDriver && /8\s000/.test(toDriver.text) && !/Без выплаты/.test(toDriver.text), toDriver?.text);
  await request(app).post(`/api/admin/transfer-jobs/${j1.id}/cancel`).set(owner.auth).send({});
  assert.equal((await request(app).put('/api/admin/settings').set(owner.auth).send({ ownerDrivesKeepsAll: false })).status, 200);
  const { job } = await confirmedJob(10000);
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(owner.auth).send({})).status, 200);
  const c = await card(job.id);
  assert.equal(c.payoutKzt, 8000); assert.equal(c.payoutRule, 'account');
  await finish(job.id);
  assert.equal((await card(job.id)).payoutRecord.amountKzt, 8000);
  await request(app).put('/api/admin/settings').set(owner.auth).send({ ownerDrivesKeepsAll: true });
});
