// Проход 4, шаг 2 спецификации: транзакционная занятость (withApartmentTx). Работает на SQLite, в памяти и на PostgreSQL.
// Гонки из разных процессов и настоящие ошибки базы — в pass4.pg.test.js (только PostgreSQL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request } from './helpers.js';
import { createBookingRequest, withApartmentTx, isAvailable, busyRanges, holdsDates, releaseExpiredHolds } from '../src/services/bookings.js';
import { HttpError } from '../src/lib/errors.js';
import { todayIn, addDays, isoDay } from '../src/lib/dates.js';
import { randomToken } from '../src/lib/tokens.js';

const isPg = /^postgres(ql)?:/.test(process.env.DATABASE_URL || '');
const { app } = makeApp();
let acc, aptA, aptB, admin, today;
let num = 950000 + (Date.now() % 9000);
const mkApt = (n) => prisma.apartment.create({ data: { accountId: acc.id, title: `Тест шаг 2 · ${n}`, address: `ул. Тестовая, 5${n}`, district: 'Есиль', rooms: '1-комн.', maxGuests: 4, basePriceKzt: 20000, sortOrder: -150 - n } });
const d = (n) => addDays(today, n);
const req = (apt, from, to, extra = {}) => createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: d(from), checkOut: d(to), guestsCount: 1, guest: null, paymentMethod: 'card', ...extra });
const is409 = (e) => e instanceof HttpError && e.status === 409;
const settle = (ps) => Promise.allSettled(ps).then(rs => ({ ok: rs.filter(r => r.status === 'fulfilled'), bad: rs.filter(r => r.status === 'rejected') }));
const blockingCount = (apt, from, to) => prisma.booking.count({ where: { apartmentId: apt.id, status: { in: ['request', 'confirmed'] }, checkIn: { lt: d(to) }, checkOut: { gt: d(from) } } });

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  today = todayIn(acc.timezone);
  aptA = await mkApt(1); aptB = await mkApt(2);
  admin = await login(app, 'alina@astanastay.example');
});
after(async () => {
  for (const a of [aptA, aptB]) await prisma.apartment.delete({ where: { id: a.id } }).catch(() => {});
  await prisma.$disconnect();
});

test('шаг 2: две одновременные пересекающиеся заявки через сервис → ровно одна, вторая 409 (не 500)', async () => {
  for (let round = 0; round < 3; round++) {
    const f = 20 + round * 10;
    const { ok, bad } = await settle([req(aptA, f, f + 3), req(aptA, f + 1, f + 4), req(aptA, f + 2, f + 3)]);
    assert.equal(ok.length, 1, `раунд ${round}: одна успешна`);
    assert.equal(bad.length, 2);
    for (const b of bad) assert.ok(is409(b.reason), `409, а не ${b.reason?.status || b.reason?.code || b.reason}`);
    assert.equal(await blockingCount(aptA, f, f + 4), 1);
  }
});

test('шаг 2: одновременные брони с сайта (HTTP) на одни даты → одна 201, остальные 409', async () => {
  const f = 60;
  const body = (n) => ({ apartmentId: aptA.id, checkIn: isoDay(d(f)), checkOut: isoDay(d(f + 2)), guests: 1, name: `Гость гонка ${n}`, phone: '+7 701 000 00 0' + n, paymentMethod: 'card' });
  const rs = await Promise.all([1, 2, 3].map(n => request(app).post('/api/public/astana-stay/bookings').send(body(n))));
  assert.deepEqual(rs.map(r => r.status).sort(), [201, 409, 409]);
  assert.ok(rs.filter(r => r.status === 409).every(r => r.body.error === 'Эти даты уже заняты'));
  assert.equal(await blockingCount(aptA, f, f + 2), 1);
});

test('шаг 2: брони встык (выезд = заезд) разрешены; разные квартиры на одни даты не конфликтуют', async () => {
  const f = 80;
  await req(aptA, f, f + 2);
  await req(aptA, f + 2, f + 4);   // встык после
  await req(aptA, f - 2, f);       // встык до
  const { ok } = await settle([req(aptA, f + 6, f + 8), req(aptB, f + 6, f + 8)]);   // одновременно, разные квартиры
  assert.equal(ok.length, 2);
  assert.equal(await blockingCount(aptA, f - 2, f + 8), 4);
  assert.equal(await blockingCount(aptB, f + 6, f + 8), 1);
});

test('шаг 2: смена дат на занятые → 409; на свободные — сумма и подготовка пересчитаны, как раньше', async () => {
  const f = 100;
  const a = await req(aptA, f, f + 2);
  const b = await req(aptA, f + 4, f + 6);
  const r1 = await request(app).patch(`/api/admin/bookings/${b.id}`).set(admin.auth).send({ checkIn: isoDay(d(f + 1)) });
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error, 'Эти даты уже заняты');
  const r2 = await request(app).patch(`/api/admin/bookings/${b.id}`).set(admin.auth).send({ checkIn: isoDay(d(f + 2)), checkOut: isoDay(d(f + 5)) });
  assert.equal(r2.status, 200);
  const nb = await prisma.booking.findUnique({ where: { id: b.id } });
  assert.equal(+nb.checkIn, +d(f + 2));
  assert.equal(nb.totalKzt, 20000 * 3);
  // без смены дат (заметка, время) — как раньше
  const r3 = await request(app).patch(`/api/admin/bookings/${a.id}`).set(admin.auth).send({ note: 'тест', checkOutTime: '11:00' });
  assert.equal(r3.status, 200);
  assert.equal(r3.body.checkOutTime, '11:00');
});

test('шаг 2: две одновременные смены дат не создают пересечение', async () => {
  for (let round = 0; round < 3; round++) {
    const f = 120 + round * 20;
    const a = await req(aptA, f, f + 1);
    const b = await req(aptA, f + 10, f + 11);
    const rs = await Promise.all([
      request(app).patch(`/api/admin/bookings/${a.id}`).set(admin.auth).send({ checkOut: isoDay(d(f + 6)) }),   // A: [f, f+6)
      request(app).patch(`/api/admin/bookings/${b.id}`).set(admin.auth).send({ checkIn: isoDay(d(f + 4)) }),    // B: [f+4, f+11)
    ]);
    assert.deepEqual(rs.map(r => r.status).sort(), [200, 409], `раунд ${round}`);
    const [na, nb] = await Promise.all([a, b].map(x => prisma.booking.findUnique({ where: { id: x.id } })));
    assert.ok(na.checkOut <= nb.checkIn, 'пересечения нет');
  }
});

test('шаг 2: ошибка базы внутри транзакции квартиры откатывает всё; ошибки занятости — 409, повтор при deadlock — только один', async () => {
  const f = 200;
  // откат: запись внутри fn, затем исключение → записи нет
  await assert.rejects(withApartmentTx(aptA.id, async (tx) => {
    await tx.booking.create({ data: { accountId: acc.id, apartmentId: aptA.id, number: ++num, token: randomToken(12), source: 'site', status: 'confirmed', checkIn: d(f), checkOut: d(f + 1), guestsCount: 1, nightlyKzt: 1, totalKzt: 1 } });
    throw new HttpError(409, 'проверка отката');
  }), (e) => is409(e) && e.message === 'проверка отката');
  if (!process.env.MEMORY_DB_SNAPSHOT) assert.equal(await blockingCount(aptA, f, f + 1), 0, 'запись откатилась');   // в памяти отката нет (демо)
  // взаимная блокировка: на PostgreSQL — ровно один повтор всей транзакции, затем 409; нигде — бесконечных повторов
  const deadlock = () => Object.assign(new Error('Error occurred during query execution: code: "40P01", message: "deadlock detected"'), { code: 'P2010' });
  let calls = 0;
  const r = await withApartmentTx(aptA.id, async () => { calls++; if (calls === 1) throw deadlock(); return 'ok'; }).catch(e => e);
  if (isPg) { assert.equal(r, 'ok'); assert.equal(calls, 2); } else { assert.ok(is409(r)); assert.equal(calls, 1); }
  calls = 0;
  const r2 = await withApartmentTx(aptA.id, async () => { calls++; throw deadlock(); }).catch(e => e);
  assert.ok(is409(r2), 'после повтора — 409, а не сырая ошибка');
  assert.equal(calls, isPg ? 2 : 1, 'не больше одного повтора');
  // нарушение ограничения (23P01) → 409 «Эти даты уже заняты»
  const overlap = Object.assign(new Error('code: "23P01", message: "conflicting key value violates exclusion constraint \\"booking_no_overlap\\""'), { code: 'P2010' });
  const r3 = await withApartmentTx(aptA.id, async () => { throw overlap; }).catch(e => e);
  assert.ok(is409(r3)); assert.equal(r3.message, 'Эти даты уже заняты');
});

test('шаг 2: правило удержания — заявка без срока держит даты (как раньше), с истёкшим сроком — нет и снимается в транзакции', async () => {
  const f = 230;
  const now = new Date();
  assert.equal(holdsDates({ status: 'request', holdUntil: null }, now), true);
  assert.equal(holdsDates({ status: 'request', holdUntil: new Date(+now + 1) }, now), true);
  assert.equal(holdsDates({ status: 'request', holdUntil: now }, now), false, 'ровно в срок — уже не держит');
  assert.equal(holdsDates({ status: 'confirmed', holdUntil: new Date(+now - 1) }, now), true);
  assert.equal(holdsDates({ status: 'cancelled' }, now), false);
  const keep = await req(aptA, f, f + 2);   // holdUntil = null
  assert.equal(keep.holdUntil, null);
  assert.equal(await isAvailable(acc.id, aptA.id, d(f), d(f + 2)), false);
  const exp = await req(aptA, f + 5, f + 7);
  await prisma.booking.update({ where: { id: exp.id }, data: { holdUntil: new Date(Date.now() - 1000) } });
  assert.equal(await isAvailable(acc.id, aptA.id, d(f + 5), d(f + 7)), true, 'истёкшее удержание даты не держит');
  assert.equal((await busyRanges(acc.id, aptA.id, d(f + 5), d(f + 7))).length, 0);
  const nb = await req(aptA, f + 5, f + 7);   // транзакция сама снимает истёкшее удержание — база не возражает
  assert.equal(nb.status, 'request');
  assert.equal((await prisma.booking.findUnique({ where: { id: exp.id } })).status, 'cancelled');
  assert.equal(await releaseExpiredHolds(prisma, { apartmentId: aptA.id }), 0, 'повтор ничего не меняет');
});
