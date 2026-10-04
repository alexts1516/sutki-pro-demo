// Комиссия с трансферов, скрытие номера квартиры до «Беру», настройки уведомлений и одобрения смет.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, freeDates, extConfig, extDriver } from './helpers.js';
import { computePayout } from '../src/services/payouts.js';

const { app, events } = makeApp({ config: extConfig });   // внешние водители включены только для этих сценариев
let acc, apt, owner, admin, ruslan, kanat, master;
let start = 400;

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false }, orderBy: { sortOrder: 'asc' } });
  [owner, admin, ruslan, kanat, master] = await Promise.all(['azamat@astanastay.example', 'alina@astanastay.example', 'ruslan@astanastay.example', 'kanat@astanastay.example', 'marat@astanastay.example'].map(e => login(app, e)));
});
after(async () => {
  await events.idle();   // дождаться фоновых уведомлений, иначе после падения теста процесс может не завершиться
  // вернуть как было — другие тесты ждут «комиссия не настроена»
  await prisma.accountSettings.deleteMany({ where: { accountId: acc.id } });
  await prisma.membership.updateMany({ where: { accountId: acc.id }, data: { payoutPercent: null, payoutFixedKzt: null } });
  await prisma.$disconnect();
});

async function confirmedJob(tr = {}) {
  const dates = await freeDates(acc.id, apt.id, 2, start); start += 5;
  const b = await request(app).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 2, name: 'Анна Смит', phone: '+7 701 555 66 77', paymentMethod: 'cash' });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const t = await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '11:00', flight: 'KC 852', pax: 1, bags: 1, ...tr });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const booking = await prisma.booking.findUnique({ where: { token: b.body.token } });
  assert.equal((await request(app).post(`/api/admin/bookings/${booking.id}/confirm`).set(owner.auth)).status, 200);
  await events.idle();
  return { booking, job: await prisma.transferJob.findUnique({ where: { transferId: t.body.id }, include: { transfer: true } }) };
}

test('расчёт выплаты: ручная > ставка водителя (фикс > %) > настройка аккаунта; без настройки водителю 100%', () => {
  const none = { transferPayoutMode: 'PERCENT', ownerCommissionPercent: null };
  assert.deepEqual(computePayout({ priceKzt: 10000, settings: none }), { payoutKzt: 10000, commissionKzt: 0, rule: 'account', percent: 0 });
  assert.equal(computePayout({ priceKzt: 10000, settings: { ...none, ownerCommissionPercent: 20 } }).payoutKzt, 8000);
  assert.equal(computePayout({ priceKzt: 10000, settings: { transferPayoutMode: 'FIXED', driverFixedKzt: 6500 } }).commissionKzt, 3500);
  assert.equal(computePayout({ priceKzt: 10000, settings: { ...none, ownerCommissionPercent: 20 }, driver: { payoutPercent: 10 } }).payoutKzt, 9000);
  assert.equal(computePayout({ priceKzt: 10000, settings: none, driver: { payoutPercent: 10, payoutFixedKzt: 7000 } }).payoutKzt, 7000);
  assert.deepEqual(computePayout({ priceKzt: 10000, settings: none, driver: { payoutFixedKzt: 7000 }, manualKzt: 9500 }).rule, 'manual');
});

test('настройки: по умолчанию комиссия не настроена; менять может только владелец', async () => {
  const s = await request(app).get('/api/admin/settings').set(admin.auth);
  assert.equal(s.status, 200);
  assert.equal(s.body.commissionConfigured, false); assert.match(s.body.commissionLabel, /не настроено/);
  assert.equal(s.body.approvalBy, 'OWNER_AND_ADMIN'); assert.equal(s.body.managerNotify, 'BOTH'); assert.equal(s.body.canEdit, false);
  assert.equal(s.body.server.flightProvider, null, 'без ключа AeroDataBox слежение выключено');
  // новый заказ без настройки — водителю вся цена
  const { job } = await confirmedJob();
  assert.equal(job.payoutKzt, job.transfer.priceKzt); assert.equal(job.commissionKzt, 0); assert.equal(job.payoutRule, 'account');
  assert.equal((await request(app).put('/api/admin/settings').set(admin.auth).send({ ownerCommissionPercent: 20 })).status, 403, 'админ не меняет комиссию');
  assert.equal((await request(app).get('/api/admin/settings').set(master.auth)).status, 403);
  assert.equal((await request(app).put('/api/admin/settings').set(owner.auth).send({ ownerCommissionPercent: 120 })).status, 400);
  assert.equal((await request(app).put('/api/admin/settings').set(owner.auth).send({ transferPayoutMode: 'FIXED' })).status, 400, 'фикс без суммы');
  const put = await request(app).put('/api/admin/settings').set(owner.auth).send({ ownerCommissionPercent: 20 });
  assert.equal(put.status, 200); assert.equal(put.body.commissionConfigured, true); assert.match(put.body.commissionLabel, /20%/);
});

test('комиссия 20%: выплата = цена − комиссия; ставка водителя перекрывает; ручная выплата держится; водитель не видит денег бизнеса', async () => {
  await request(app).put('/api/admin/settings').set(owner.auth).send({ transferPayoutMode: 'PERCENT', ownerCommissionPercent: 20 });
  // своя ставка Каната: бизнес берёт 10%; ставку меняет только владелец
  assert.equal((await request(app).patch(`/api/admin/team/${kanat.me.user.id}`).set(admin.auth).send({ payoutPercent: 10 })).status, 403);
  assert.equal((await request(app).patch(`/api/admin/team/${kanat.me.user.id}`).set(owner.auth).send({ payoutPercent: 10 })).status, 200);
  const { job } = await confirmedJob();
  const price = job.transfer.priceKzt;
  assert.equal(job.payoutKzt, Math.round(price * 0.8 / 100) * 100); assert.equal(job.commissionKzt, price - job.payoutKzt);
  // предложение: каждый водитель видит свою выплату; цены для гостя и комиссии — нет
  const rView = (await request(app).get(`/api/staff/transfers/${job.id}`).set(ruslan.auth)).body;
  const kView = (await request(app).get(`/api/staff/transfers/${job.id}`).set(kanat.auth)).body;
  assert.equal(rView.payoutKzt, Math.round(price * 0.8 / 100) * 100); assert.equal(kView.payoutKzt, Math.round(price * 0.9 / 100) * 100);
  for (const v of [rView, kView]) { assert.equal(v.priceKzt, undefined); assert.equal(v.commissionKzt, undefined); }
  // и в Telegram-предложении у каждого своя сумма
  const offers = await prisma.notificationLog.findMany({ where: { event: 'transfer.offered', dedupeKey: { startsWith: `transfer.offered:${job.id}:1:` } } });
  const kText = offers.find(o => o.recipientId === kanat.me.user.id).text;
  assert.ok(kText.includes(String(Math.round(price * 0.9 / 100) * 100).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')), kText);
  // Канат взял — выплата пересчитана по его ставке
  const a = await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(kanat.auth);
  assert.equal(a.status, 200); assert.equal(a.body.payoutKzt, Math.round(price * 0.9 / 100) * 100);
  let card = (await request(app).get(`/api/admin/transfer-jobs/${job.id}`).set(admin.auth)).body;
  assert.equal(card.priceKzt, price); assert.equal(card.commissionKzt, price - card.payoutKzt); assert.equal(card.payoutRule, 'driver');
  // владелец/админ вручную задал выплату — держится и при замене водителя
  card = (await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(admin.auth).send({ payoutKzt: 7500 })).body;
  assert.equal(card.payoutKzt, 7500); assert.equal(card.payoutManual, true); assert.equal(card.commissionKzt, price - 7500);
  card = (await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverUserId: ruslan.me.user.id })).body;
  assert.equal(card.payoutKzt, 7500, 'ручная выплата не сбрасывается при переназначении');
  // «снова по правилам» — пересчёт по ставке Руслана (аккаунт 20%)
  card = (await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ payoutAuto: true })).body;
  assert.equal(card.payoutManual, false); assert.equal(card.payoutKzt, Math.round(price * 0.8 / 100) * 100);
  // цена для гостя изменилась — выплата и комиссия пересчитаны
  card = (await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ priceKzt: 15000 })).body;
  assert.equal(card.priceKzt, 15000); assert.equal(card.payoutKzt, 12000); assert.equal(card.commissionKzt, 3000);
  // финансы: выручка трансферов, выплаты, маржа
  for (const s of ['en-route', 'arrived', 'picked-up', 'done']) await request(app).post(`/api/admin/transfer-jobs/${job.id}/status`).set(owner.auth).send({ action: s });
  const fin = (await request(app).get(`/api/admin/finance?month=${card.date.slice(0, 7)}`).set(owner.auth)).body;
  assert.equal(fin.transfersMarginKzt, fin.transfersRevenueKzt - fin.transfersPayoutKzt); assert.ok(fin.transfersMarginKzt >= 3000);
  assert.ok((await request(app).post(`/api/admin/transfer-jobs/${job.id}/paid`).set(owner.auth).send({ paid: true })).body.paid);
  assert.equal((await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ payoutKzt: 1 })).status, 409, 'оплаченную выплату не меняем');
});

test('фиксированная ставка водителю (режим FIXED) и фикс у внешнего водителя', async () => {
  await request(app).put('/api/admin/settings').set(owner.auth).send({ transferPayoutMode: 'FIXED', driverFixedKzt: 6000 });
  const { job } = await confirmedJob();
  assert.equal(job.payoutKzt, 6000); assert.equal(job.commissionKzt, job.transfer.priceKzt - 6000);
  const ext = await extDriver(acc.id);
  assert.equal((await request(app).patch(`/api/admin/contractors/${ext.id}`).set(admin.auth).send({ payoutFixedKzt: 5000 })).status, 403);
  assert.equal((await request(app).patch(`/api/admin/contractors/${ext.id}`).set(owner.auth).send({ payoutFixedKzt: 5000 })).status, 200);
  const card = (await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverContractorId: ext.id })).body;
  assert.equal(card.payoutKzt, 5000);
  // ссылка внешнего водителя: только его выплата
  const v = (await request(app).get(`/api/transfer-link/${card.link.token}`)).body;
  assert.equal(v.payoutKzt, 5000); assert.equal(v.priceKzt, undefined); assert.equal(v.commissionKzt, undefined);
  assert.ok(card.link.url.includes(`/link/${card.link.token}`), 'ссылка ведёт на страницу /link/:token');
  await prisma.contractor.update({ where: { id: ext.id }, data: { payoutFixedKzt: null } });
  await request(app).put('/api/admin/settings').set(owner.auth).send({ transferPayoutMode: 'PERCENT', ownerCommissionPercent: 20 });
});

test('номер квартиры скрыт до «Беру» — в приложении, в Telegram-предложении и для внешнего водителя', async () => {
  const { job } = await confirmedJob();
  const offer = (await request(app).get(`/api/staff/transfers/${job.id}`).set(ruslan.auth)).body;
  assert.equal(offer.apartment.apartmentNumber, undefined);
  assert.ok(offer.apartment.building.includes(apt.complex), offer.apartment.building);
  assert.equal(new RegExp(`кв\\.?\\s*${apt.code}\\b`).test(JSON.stringify(offer)), false);
  const msgs = await prisma.notificationLog.findMany({ where: { event: 'transfer.offered', dedupeKey: { startsWith: `transfer.offered:${job.id}:` } } });
  assert.ok(msgs.length >= 3);
  for (const m of msgs) { assert.doesNotMatch(m.text, new RegExp(`кв\\.?\\s*${apt.code}\\b`)); assert.doesNotMatch(m.text, /555 66 77/); }
  // внешний водитель: пока заказ у него в работе — видит квартиру; после — ссылка закрыта
  const ext = await extDriver(acc.id);
  const card = (await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverContractorId: ext.id })).body;
  const v = (await request(app).get(`/api/transfer-link/${card.link.token}`)).body;
  assert.equal(v.apartment.apartmentNumber, apt.code); assert.equal(v.guestPhone, '+7 701 555 66 77');
  // принял водитель из команды → номер квартиры и телефон
  const { job: j2 } = await confirmedJob();
  const acc2 = (await request(app).post(`/api/staff/transfers/${j2.id}/accept`).set(ruslan.auth)).body;
  assert.equal(acc2.apartment.apartmentNumber, apt.code); assert.equal(acc2.guestPhone, '+7 701 555 66 77');
});

test('уведомления менеджерам: только владельцу / только админу / обоим', async () => {
  const unassignedTo = async () => {
    const { job } = await confirmedJob();
    await app.locals.dispatch.runDispatch({ now: new Date(job.offeredAt.getTime() + 31 * 60000) }); await events.idle();
    return (await prisma.notificationLog.findMany({ where: { event: 'transfer.unassigned', dedupeKey: { startsWith: `transfer.unassigned:${job.id}` } } })).map(l => l.recipientType).sort();
  };
  await request(app).put('/api/admin/settings').set(owner.auth).send({ managerNotify: 'OWNER' });
  assert.deepEqual(await unassignedTo(), ['owner']);
  await request(app).put('/api/admin/settings').set(owner.auth).send({ managerNotify: 'ADMIN' });
  assert.deepEqual(await unassignedTo(), ['admin']);
  await request(app).put('/api/admin/settings').set(owner.auth).send({ managerNotify: 'BOTH' });
  assert.deepEqual(await unassignedTo(), ['admin', 'owner']);
});

test('кто одобряет сметы: по умолчанию владелец и админ; «только владелец» — админу 403, владелец получает сигнал', async () => {
  const marat = master;
  const create = async () => (await request(app).post('/api/admin/repairs').set(owner.auth).send({ apartmentId: apt.id, title: 'Течёт смеситель', type: 'plumb', assigneeId: marat.me.user.id })).body;
  const estimate = async (t) => (await request(app).post(`/api/staff/repairs/${t.id}/estimate`).set(marat.auth).send({ method: 'REMOTE', labourKzt: 8000, materialsIncluded: true, materialsKzt: 3000 })).body;
  let t = await create(); let e = await estimate(t);
  const est = e.estimates.at(-1);
  const r1 = await request(app).post(`/api/admin/estimates/${est.id}/approve`).set(admin.auth);
  assert.equal(r1.status, 200, 'по умолчанию админ тоже одобряет'); assert.equal(r1.body.canDecide, true);
  await request(app).put('/api/admin/settings').set(owner.auth).send({ approvalBy: 'OWNER_ONLY', managerNotify: 'ADMIN' });
  t = await create(); e = await estimate(t); await events.idle();
  const est2 = e.estimates.at(-1);
  const sub = await prisma.notificationLog.findMany({ where: { event: 'estimate.submitted', createdAt: { gte: new Date(Date.now() - 60000) } }, orderBy: { createdAt: 'desc' }, take: 5 });
  assert.ok(sub.some(l => l.recipientType === 'owner'), 'при «только владелец» смета приходит владельцу даже если уведомления — админу');
  assert.equal((await request(app).get(`/api/admin/repairs/${t.id}`).set(admin.auth)).body.canDecide, false);
  assert.equal((await request(app).post(`/api/admin/estimates/${est2.id}/approve`).set(admin.auth)).status, 403);
  assert.equal((await request(app).post(`/api/admin/estimates/${est2.id}/approve`).set(owner.auth)).status, 200);
  await request(app).put('/api/admin/settings').set(owner.auth).send({ approvalBy: 'OWNER_AND_ADMIN', managerNotify: 'BOTH' });
});

test('ставки водителей и финансы — только владелец: админ не видит ставку ни в списке, ни в ответе на правку; финансы — 403', async () => {
  const r = await prisma.user.findUnique({ where: { email: 'ruslan@astanastay.example' } });
  assert.equal((await request(app).patch(`/api/admin/team/${r.id}`).set(owner.auth).send({ payoutPercent: 15 })).status, 200);
  const list = await request(app).get('/api/admin/team').set(admin.auth);
  const row = list.body.find(x => x.userId === r.id);
  assert.ok(row && !('payoutPercent' in row) && !('payoutFixedKzt' in row));
  const upd = await request(app).patch(`/api/admin/team/${r.id}`).set(admin.auth).send({ vehicle: 'Hyundai Sonata, белая, 777 AAA 01' });
  assert.equal(upd.status, 200); assert.ok(!('payoutPercent' in upd.body));
  assert.equal((await request(app).patch(`/api/admin/team/${r.id}`).set(admin.auth).send({ payoutPercent: 0 })).status, 403);
  assert.equal((await request(app).get('/api/admin/finance').set(admin.auth)).status, 403);
  const fin = await request(app).get('/api/admin/finance').set(owner.auth);
  assert.equal(fin.status, 200);
  assert.equal(fin.body.transfersMarginKzt, fin.body.transfersRevenueKzt - fin.body.transfersPayoutKzt);
  assert.equal(fin.body.netKzt, fin.body.revenueKzt + fin.body.transfersRevenueKzt - fin.body.transfersPayoutKzt - fin.body.repairsKzt - fin.body.cleaningKzt);
  await request(app).patch(`/api/admin/team/${r.id}`).set(owner.auth).send({ payoutPercent: null });
});

test('после «Оплачено водителю» смена цены для гостя не меняет выплату — только комиссию', async () => {
  const { job } = await confirmedJob();
  const r = await prisma.user.findUnique({ where: { email: 'ruslan@astanastay.example' } });
  assert.equal((await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverUserId: r.id })).status, 200);
  for (const action of ['picked-up', 'done']) assert.equal((await request(app).post(`/api/admin/transfer-jobs/${job.id}/status`).set(owner.auth).send({ action })).status, 200);
  assert.equal((await request(app).post(`/api/admin/transfer-jobs/${job.id}/paid`).set(owner.auth).send({ paid: true })).status, 200);
  const before = (await request(app).get(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth)).body;
  const u = await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ priceKzt: before.priceKzt + 2000 });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.payoutKzt, before.payoutKzt);
  assert.equal(u.body.commissionKzt, before.priceKzt + 2000 - before.payoutKzt);
  assert.equal((await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ payoutKzt: 1000 })).status, 409);
});
