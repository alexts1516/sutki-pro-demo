// Проход 4, шаг 4 спецификации: сайт — только с оплатой картой. Удержание 30 мин (Booking.holdUntil), продление при
// открытии оплаты, оплата до и после истечения (восстановление или «Оплата без брони — верните деньги»), гонки.
// Работает на SQLite, в памяти и на PostgreSQL; два отдельных процесса — в pass4.pg.test.js.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request } from './helpers.js';
import { isAvailable, PUBLIC_HOLD_MIN, PAY_EXTEND_MIN, turnoverKey, confirmKeys } from '../src/services/bookings.js';
import { applyPaymentResult, orphanKey } from '../src/payments/index.js';
import { createTestPayments } from '../src/payments/test.js';
import { runBookingMaintenance } from '../src/notifications/scheduler.js';
import { todayView } from '../src/services/ops.js';
import { testHooks } from '../src/lib/testHooks.js';
import { todayIn, addDays, isoDay } from '../src/lib/dates.js';

const MIN = 60000;
// провайдер «с переходом на страницу банка»: платёж создаётся, результат приходит позже (вебхук = applyPaymentResult)
const redirectPayments = { name: 'test', async createPayment() { return { type: 'redirect', url: 'https://pay.example/checkout' }; } };
let X, acc, apt, admin, today, start = 30;
const seen = [];
const emitted = (name, key, id) => seen.filter(e => e.name === name && e[key] === id).length;
const d = (n) => isoDay(addDays(today, n));
const pub = (x = X) => request(x.app);

function boot(payments = redirectPayments) {
  const x = makeApp({ payments });
  x.events.onAny((p, name) => seen.push({ name, ...p }));
  return { app: x.app, events: x.events, dispatch: x.app.locals.dispatch };
}
const dates = (len = 2) => { const f = start; start += len + 2; return { checkIn: d(f), checkOut: d(f + len) }; };
let phoneN = 1000;
async function book(dt, body = {}, x = X) {
  return pub(x).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dt, guests: 1, name: 'Гость Шаг4', phone: `+7 701 444 ${String(phoneN++).padStart(4, '0')}`, ...body });
}
const byToken = (token) => prisma.booking.findUnique({ where: { token } });
async function startPay(token, x = X) { return pub(x).post(`/api/public/astana-stay/bookings/${token}/pay`).send({}); }
const pay = (paymentId, x = X) => applyPaymentResult({ prisma, events: x.events, dispatch: x.dispatch, result: { paymentId, status: 'succeeded', providerPaymentId: 'prov-' + paymentId } });
const expire = (id, msAgo = 1000) => prisma.booking.update({ where: { id }, data: { holdUntil: new Date(Date.now() - msAgo) } });
const blockingIn = async (dt) => (await prisma.booking.findMany({ where: { apartmentId: apt.id, status: { in: ['request', 'confirmed'] }, checkIn: { lt: new Date(dt.checkOut) }, checkOut: { gt: new Date(dt.checkIn) } } }));
const orphanItems = async () => (await todayView(acc.id, { role: 'admin' })).items.filter(i => i.kind === 'payment_orphaned');

/** Заявка с сайта + открытая оплата (платёж «created»). */
async function requestWithPayment(dt = dates()) {
  const r = await book(dt); assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = await startPay(r.body.token); assert.equal(p.status, 201, JSON.stringify(p.body));
  return { dt, token: r.body.token, booking: await byToken(r.body.token), paymentId: p.body.paymentId };
}

before(async () => {
  X = boot();
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  today = todayIn(acc.timezone);
  apt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест шаг 4', address: 'ул. Тестовая, 64', district: 'Есиль', rooms: '1-комн.', maxGuests: 4, basePriceKzt: 20000, sortOrder: -164 } });
  admin = await login(X.app, 'alina@astanastay.example');
});
afterEach(() => { for (const k of Object.keys(testHooks)) delete testHooks[k]; });
after(async () => {
  await prisma.apartment.delete({ where: { id: apt.id } }).catch(() => {});
  await prisma.$disconnect();
});

test('шаг 4: публичная бронь — всегда карта (способ оплаты ставит сервер); сайт не предлагает наличные', async () => {
  for (const body of [{}, { paymentMethod: 'card' }]) {
    const r = await book(dates(), body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.payOnline, true);
    const b = await byToken(r.body.token);
    assert.equal(b.paymentMethod, 'card');
    assert.equal(b.status, 'request');
    assert.equal(b.paymentStatus, 'unpaid');
  }
  const s = await pub().get('/api/public/astana-stay/site');
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.payments.offline, []);
  assert.equal(s.body.payments.bookingMethod, 'card');
});

test('шаг 4: наличные / Kaspi / перевод / залог / оплата при заезде через публичный маршрут → 400, бронь не создаётся', async () => {
  const before = await prisma.booking.count({ where: { apartmentId: apt.id } });
  for (const m of ['cash', 'kaspi', 'transfer', 'deposit', 'cash_on_arrival', 'telegram', 'CARD', '']) {
    const r = await book(dates(), { paymentMethod: m });
    assert.equal(r.status, 400, `${m}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, /только с оплатой картой/);
  }
  // посторонние поля (статус, удержание, оплачено) клиент тоже не задаёт — схема их не принимает, сервер ставит сам
  const r = await book(dates(), { paymentMethod: 'card', status: 'confirmed', paymentStatus: 'paid', holdUntil: null, source: 'link' });
  assert.equal(r.status, 201);
  const b = await byToken(r.body.token);
  assert.equal(b.status, 'request'); assert.equal(b.paymentStatus, 'unpaid'); assert.equal(b.source, 'site'); assert.ok(b.holdUntil);
  assert.equal(await prisma.booking.count({ where: { apartmentId: apt.id } }), before + 1);
});

test('шаг 4: публичная заявка получает holdUntil = сейчас + 30 мин (единственный источник удержания)', async () => {
  const t0 = Date.now();
  const r = await book(dates());
  const b = await byToken(r.body.token);
  assert.ok(b.holdUntil);
  assert.ok(+b.holdUntil >= t0 + PUBLIC_HOLD_MIN * MIN - 50 && +b.holdUntil <= Date.now() + PUBLIC_HOLD_MIN * MIN + 50, String(b.holdUntil));
  assert.equal(+new Date(r.body.holdUntil), +b.holdUntil);
  assert.equal(await isAvailable(acc.id, apt.id, b.checkIn, b.checkOut), false, 'пока удержание живо — даты заняты');
});

test('шаг 4: через 30 мин даты свободны — новая бронь проходит, старая заявка снята (бронь не вечная)', async () => {
  const dt = dates();
  const r = await book(dt); const b = await byToken(r.body.token);
  assert.equal((await book(dt)).status, 409, 'пока держит — второй гость не может');
  await expire(b.id);   // «прошло 30 мин»
  assert.equal(await isAvailable(acc.id, apt.id, b.checkIn, b.checkOut), true);
  const av = await pub().get(`/api/public/astana-stay/apartments/${apt.id}/availability?from=${dt.checkIn}&to=${dt.checkOut}`);
  assert.deepEqual(av.body.busy, []);
  const r2 = await book(dt);
  assert.equal(r2.status, 201);
  assert.equal((await prisma.booking.findUnique({ where: { id: b.id } })).status, 'cancelled', 'истёкшую сняла та же транзакция квартиры');
  assert.ok(await prisma.outboxEvent.findUnique({ where: { dedupeKey: `event:booking.hold_expired:${b.id}` } }));
});

test('шаг 4: открытие оплаты продлевает удержание до «сейчас + 20 мин»', async () => {
  const r = await book(dates()); const b = await byToken(r.body.token);
  await prisma.booking.update({ where: { id: b.id }, data: { holdUntil: new Date(Date.now() + 5 * MIN) } });   // осталось 5 мин
  const t0 = Date.now();
  const p = await startPay(r.body.token);
  assert.equal(p.status, 201); assert.equal(p.body.type, 'redirect');
  const nb = await byToken(r.body.token);
  assert.ok(+nb.holdUntil >= t0 + PAY_EXTEND_MIN * MIN - 50 && +nb.holdUntil <= Date.now() + PAY_EXTEND_MIN * MIN + 50, String(nb.holdUntil));
  const pm = await prisma.payment.findUnique({ where: { id: p.body.paymentId } });
  assert.equal(pm.status, 'created'); assert.equal(pm.bookingId, b.id); assert.equal(pm.amountKzt, b.totalKzt);
});

test('шаг 4: продление никогда не укорачивает более длинное удержание', async () => {
  const r = await book(dates()); const b = await byToken(r.body.token);   // 30 мин > 20 мин
  assert.equal((await startPay(r.body.token)).status, 201);
  assert.equal(+(await byToken(r.body.token)).holdUntil, +b.holdUntil);
  const long = new Date(Date.now() + 3 * 60 * MIN);
  await prisma.booking.update({ where: { id: b.id }, data: { holdUntil: long } });
  assert.equal((await startPay(r.body.token)).status, 201);
  assert.equal(+(await byToken(r.body.token)).holdUntil, +long);
});

test('шаг 4: оплатить истёкшую или отменённую заявку нельзя — 409, оплата её не оживляет', async () => {
  const r = await book(dates()); const b = await byToken(r.body.token);
  await expire(b.id);
  const p = await startPay(r.body.token);
  assert.equal(p.status, 409); assert.match(p.body.error, /истекло|заново/i);
  const nb = await byToken(r.body.token);
  assert.equal(nb.status, 'cancelled');
  assert.equal(await prisma.payment.count({ where: { bookingId: b.id } }), 0);
  const r2 = await book(dates()); const b2 = await byToken(r2.body.token);
  await prisma.booking.update({ where: { id: b2.id }, data: { status: 'cancelled' } });
  const p2 = await startPay(r2.body.token);
  assert.equal(p2.status, 409); assert.match(p2.body.error, /отменена/);
});

test('шаг 4: успешная оплата до истечения → одна подтверждённая бронь (paid), одна подготовка, журнал выполнен', async () => {
  const x = await requestWithPayment();
  const out = await pay(x.paymentId);
  assert.equal(out.outcome, 'confirmed'); assert.equal(out.status, 'succeeded');
  await X.events.idle();
  const b = await byToken(x.token);
  assert.equal(b.status, 'confirmed'); assert.equal(b.paymentStatus, 'paid'); assert.equal(b.holdUntil, null); assert.ok(b.confirmedAt);
  const preps = await prisma.cleaningTask.findMany({ where: { bookingId: b.id } });
  assert.equal(preps.length, 1); assert.equal(preps[0].autoKey, turnoverKey(b.id));
  const rows = await prisma.outboxEvent.findMany({ where: { dedupeKey: { in: [...confirmKeys(b.id), `event:payment.succeeded:${x.paymentId}`] } } });
  assert.deepEqual(rows.map(r => r.status), ['done', 'done', 'done']);
  assert.equal(emitted('booking.confirmed', 'bookingId', b.id), 1);
  assert.equal(emitted('payment.succeeded', 'paymentId', x.paymentId), 1);
  assert.equal((await blockingIn(x.dt)).length, 1);
});

test('шаг 4: демо-оплата (мгновенный тестовый провайдер) — тот же путь: бронь подтверждена сразу', async () => {
  const T = boot(createTestPayments());
  const r = await book(dates(), {}, T);
  const p = await startPay(r.body.token, T);
  assert.equal(p.status, 201); assert.equal(p.body.paid, true); assert.equal(p.body.status, 'confirmed');
  assert.equal((await startPay(r.body.token, T)).status, 409, 'повторно не оплатить');
});

test('шаг 4: повторный вебхук (последовательно и одновременно) ничего не дублирует', async () => {
  const x = await requestWithPayment();
  const rs = await Promise.all([pay(x.paymentId), pay(x.paymentId)]);
  for (let i = 0; i < 3; i++) await pay(x.paymentId);
  assert.equal(rs.filter(r => r.outcome === 'confirmed').length, 1, JSON.stringify(rs.map(r => r.outcome)));
  await X.events.idle();
  const b = await byToken(x.token);
  assert.equal(b.status, 'confirmed');
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
  assert.equal(emitted('booking.confirmed', 'bookingId', b.id), 1);
  assert.equal(emitted('payment.succeeded', 'paymentId', x.paymentId), 1);
  // неуспешный вебхук после успешного не откатывает платёж
  await applyPaymentResult({ prisma, events: X.events, result: { paymentId: x.paymentId, status: 'failed' } });
  assert.equal((await prisma.payment.findUnique({ where: { id: x.paymentId } })).status, 'succeeded');
});

test('шаг 4: оплата после истечения, даты свободны → бронь восстановлена и подтверждена (одна подготовка)', async () => {
  for (const viaScheduler of [true, false]) {   // снята планировщиком заранее / ещё не снята (снимет транзакция оплаты)
    const x = await requestWithPayment();
    await expire(x.booking.id);
    if (viaScheduler) {
      await runBookingMaintenance({ events: X.events, dispatch: X.dispatch });
      assert.equal((await byToken(x.token)).status, 'cancelled');
    }
    const out = await pay(x.paymentId);
    assert.equal(out.outcome, 'restored');
    await X.events.idle();
    const b = await byToken(x.token);
    assert.equal(b.status, 'confirmed'); assert.equal(b.paymentStatus, 'paid'); assert.equal(b.holdUntil, null);
    assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
    assert.equal(emitted('booking.confirmed', 'bookingId', b.id), 1);
    assert.equal((await blockingIn(x.dt)).length, 1);
    assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: orphanKey(x.paymentId) } }), 0);
    await pay(x.paymentId);   // повтор — без изменений
    assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
  }
});

test('шаг 4: оплата после истечения, даты заняты → второй брони нет, платёж записан, один пункт «Верните деньги»; повтор вебхука — без второго', async () => {
  const x = await requestWithPayment();
  await expire(x.booking.id);
  const other = await book(x.dt);   // другой гость занял даты
  assert.equal(other.status, 201);
  const out = await pay(x.paymentId);
  assert.equal(out.outcome, 'orphaned'); assert.equal(out.status, 'succeeded');
  await X.events.idle();
  const b = await byToken(x.token);
  assert.equal(b.status, 'cancelled', 'даты не заняты повторно');
  assert.equal(b.paymentStatus, 'paid', 'деньги получены — их нужно вернуть');
  const holders = await blockingIn(x.dt);
  assert.deepEqual(holders.map(h => h.token), [other.body.token]);
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 0);
  let items = (await orphanItems()).filter(i => i.ref === x.paymentId);
  assert.equal(items.length, 1);
  assert.equal(items[0].level, 'critical');
  assert.match(items[0].problem, /Оплата без брони — верните деньги/);
  assert.match(items[0].details, new RegExp(`№${b.number}`));
  assert.match(items[0].details, /Гость Шаг4/);
  assert.equal(items[0].open, `bk:${b.id}`);
  assert.equal(emitted('payment.orphaned', 'paymentId', x.paymentId), 1);
  // повторные вебхуки (последовательно и одновременно) — второго сигнала нет
  await Promise.all([pay(x.paymentId), pay(x.paymentId)]);
  await pay(x.paymentId);
  await X.events.idle();
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: orphanKey(x.paymentId) } }), 1);
  assert.equal((await orphanItems()).filter(i => i.ref === x.paymentId).length, 1);
  assert.equal(emitted('payment.orphaned', 'paymentId', x.paymentId), 1);
  assert.equal((await blockingIn(x.dt)).length, 1);
  // админ вернул деньги и отметил «возврат» (существующее поле брони) → пункт уходит
  const pr = await request(X.app).patch(`/api/admin/bookings/${b.id}`).set(admin.auth).send({ paymentStatus: 'refunded' });
  assert.equal(pr.status, 200);
  assert.equal((await orphanItems()).filter(i => i.ref === x.paymentId).length, 0);
});

test('шаг 4: гонка «планировщик снимает удержание» vs «пришла оплата» → одно согласованное состояние', async () => {
  for (const ms of [1000, 0, -1]) {   // уже истекло / истекает «сейчас» / ещё живо (истечёт через миг)
    const x = await requestWithPayment();
    await prisma.booking.update({ where: { id: x.booking.id }, data: { holdUntil: new Date(Date.now() - ms) } });
    const [, out] = await Promise.all([runBookingMaintenance({ events: X.events, dispatch: X.dispatch }), pay(x.paymentId)]);
    assert.ok(['confirmed', 'restored'].includes(out.outcome), out.outcome);
    await X.events.idle();
    const b = await byToken(x.token);
    assert.equal(b.status, 'confirmed'); assert.equal(b.paymentStatus, 'paid');
    assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
    assert.equal(emitted('booking.confirmed', 'bookingId', b.id), 1);
    assert.equal((await blockingIn(x.dt)).length, 1);
  }
});

test('шаг 4: оплата ровно в момент holdUntil — уже истекло (строгая граница), но даты свободны → восстановлена', async () => {
  const x = await requestWithPayment();
  const at = new Date(Date.now() + 300);
  await prisma.booking.update({ where: { id: x.booking.id }, data: { holdUntil: at } });
  while (Date.now() < +at) await new Promise(r => setTimeout(r, 5));
  const out = await pay(x.paymentId);
  assert.equal(out.outcome, 'restored');
  assert.equal((await byToken(x.token)).status, 'confirmed');
});

test('шаг 4: гонка «поздняя оплата» vs «новая бронь другого гостя» → одна бронь на даты; либо восстановлена, либо «верните деньги»', async () => {
  const seenOutcomes = new Set();
  for (let round = 0; round < 4; round++) {
    const x = await requestWithPayment();
    await expire(x.booking.id);
    if (round % 2) testHooks.confirmBeforeCommit = () => new Promise(r => setTimeout(r, 30));   // оплата держит транзакцию дольше
    const [out, other] = await Promise.all([pay(x.paymentId), book(x.dt)]);
    delete testHooks.confirmBeforeCommit;
    seenOutcomes.add(out.outcome);
    const holders = await blockingIn(x.dt);
    assert.equal(holders.length, 1, 'на даты ровно одна бронь');
    if (other.status === 201) {
      assert.equal(out.outcome, 'orphaned');
      assert.equal(holders[0].token, other.body.token);
      assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: orphanKey(x.paymentId) } }), 1);
    } else {
      assert.equal(other.status, 409, JSON.stringify(other.body));
      assert.equal(out.outcome, 'restored');
      assert.equal(holders[0].token, x.token);
      assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: orphanKey(x.paymentId) } }), 0);
    }
  }
  assert.ok(seenOutcomes.size >= 1);
});

test('шаг 4: бронь, отменённая админом (не по истечению), при поздней оплате не оживает — «верните деньги»', async () => {
  const x = await requestWithPayment();
  const c = await request(X.app).post(`/api/admin/bookings/${x.booking.id}/cancel`).set(admin.auth).send({});
  assert.equal(c.status, 200);
  const out = await pay(x.paymentId);
  assert.equal(out.outcome, 'orphaned');
  assert.equal((await byToken(x.token)).status, 'cancelled');
  assert.equal((await orphanItems()).filter(i => i.ref === x.paymentId).length, 1);
});

test('шаг 4: «Сегодня» не показывает истёкшую заявку как «ждёт оплаты»', async () => {
  const r = await book(dates()); const b = await byToken(r.body.token);
  const has = async () => (await todayView(acc.id, { role: 'admin' })).items.some(i => i.kind === 'awaiting_payment' && (i.open === `bk:${b.id}` || i.ref === b.id));
  assert.equal(await has(), true);
  await expire(b.id);
  assert.equal(await has(), false);
});
