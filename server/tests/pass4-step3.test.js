// Проход 4, шаг 3 спецификации: надёжное подтверждение и отмена — транзакция + журнал отложенных действий (outbox)
// + сверка + единая отмена. Работает на SQLite, в памяти и на PostgreSQL; гонки двух процессов — в pass4.pg.test.js.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { grantGuestAccess, makeApp, login, prisma, request } from './helpers.js';
import { createBookingRequest, confirmBooking, cancelBooking, reconcileBookings, turnoverKey, confirmKeys } from '../src/services/bookings.js';
import { enqueue, runOutbox, OUTBOX_MAX_ATTEMPTS } from '../src/services/outbox.js';
import { runBookingMaintenance } from '../src/notifications/scheduler.js';
import { todayView } from '../src/services/ops.js';
import { testHooks } from '../src/lib/testHooks.js';
import { todayIn, addDays, isoDay } from '../src/lib/dates.js';
import { randomToken } from '../src/lib/tokens.js';

const memory = !!process.env.MEMORY_DB_SNAPSHOT;   // Prisma в памяти (демо) не откатывает транзакции
let A, acc, apt, admin, today, num = 940000 + (Date.now() % 9000), start = 20;
const seen = [];   // все события шины текущего «процесса»
function boot() {   // «процесс» приложения: своя шина событий и свой диспетчер водителей
  const x = makeApp();
  x.events.onAny((p, name) => seen.push({ name, ...p }));
  return { app: x.app, events: x.events, dispatch: x.app.locals.dispatch };
}
const emitted = (name, bookingId) => seen.filter(e => e.name === name && e.bookingId === bookingId).length;
const d = (n) => addDays(today, n);

async function newRequest({ transfer = true, len = 2 } = {}) {
  const f = start; start += len + 2;
  const b = await grantGuestAccess(await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: d(f), checkOut: d(f + len), guestsCount: 1, guest: null, paymentMethod: 'card' }));
  if (transfer) {
    const r = await request(A.app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.token, direction: 'in', place: 'airport', date: isoDay(d(f)), time: '15:00', pax: 1, bags: 1, name: 'Гость', phone: '+7 701 000 00 00' });
    assert.equal(r.status, 201);
  }
  return b;
}
const state = async (id) => ({
  booking: await prisma.booking.findUnique({ where: { id } }),
  preps: await prisma.cleaningTask.findMany({ where: { bookingId: id } }),
  jobs: await prisma.transferJob.findMany({ where: { bookingId: id } }),
  rows: await prisma.outboxEvent.findMany({ where: { dedupeKey: { contains: id } } }),
});
const confirm = (id, x = A) => confirmBooking({ accountId: acc.id, bookingId: id, events: x.events, dispatch: x.dispatch, actor: { type: 'admin', name: 'Тест' } });

before(async () => {
  A = boot();
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  today = todayIn(acc.timezone);
  apt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест шаг 3', address: 'ул. Тестовая, 63', district: 'Есиль', rooms: '1-комн.', maxGuests: 4, basePriceKzt: 20000, sortOrder: -163 } });
  admin = await login(A.app, 'alina@astanastay.example');
});
afterEach(() => { for (const k of Object.keys(testHooks)) delete testHooks[k]; });
after(async () => {
  await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: 'test:s3:' } } });
  await prisma.apartment.delete({ where: { id: apt.id } }).catch(() => {});
  await prisma.$disconnect();
});

test('шаг 3: обычное подтверждение → бронь confirmed, одна обязательная подготовка (autoKey), один заказ, одно уведомление', async () => {
  const b = await newRequest();
  const r = await confirm(b.id);
  assert.equal(r.status, 'confirmed');
  await A.events.idle();
  const s = await state(b.id);
  assert.equal(s.booking.status, 'confirmed');
  assert.ok(s.booking.confirmedAt);
  assert.equal(s.booking.holdUntil, null);
  assert.equal(s.preps.length, 1);
  assert.equal(s.preps[0].autoKey, turnoverKey(b.id));
  assert.equal(+s.preps[0].date, +s.booking.checkOut);
  assert.equal(s.jobs.length, 1);
  assert.deepEqual(s.rows.map(x => x.status).sort(), ['done', 'done']);
  assert.equal(emitted('booking.confirmed', b.id), 1);
});

test('шаг 3: два одновременных и три последовательных подтверждения → одна подготовка, один заказ, одно уведомление', async () => {
  const b = await newRequest();
  const rs = await Promise.all([confirm(b.id), confirm(b.id)]);
  assert.deepEqual(rs.map(x => x.status), ['confirmed', 'confirmed']);
  for (let i = 0; i < 3; i++) assert.equal((await confirm(b.id)).status, 'confirmed');
  await A.events.idle();
  const s = await state(b.id);
  assert.equal(s.preps.length, 1);
  assert.equal(s.jobs.length, 1);
  assert.equal(s.rows.length, 2);
  assert.equal(emitted('booking.confirmed', b.id), 1);
  // через HTTP (двойной клик в админке) — тоже без дублей
  const b2 = await newRequest();
  const hs = await Promise.all([1, 2, 3].map(() => request(A.app).post(`/api/admin/bookings/${b2.id}/confirm`).set(admin.auth)));
  assert.deepEqual(hs.map(h => h.status), [200, 200, 200]);
  const s2 = await state(b2.id);
  assert.equal(s2.preps.length, 1); assert.equal(s2.jobs.length, 1);
});

test('шаг 3, сбой A: «падение» внутри транзакции до коммита → бронь осталась заявкой, ни подготовки, ни строк журнала', async () => {
  const b = await newRequest();
  testHooks.confirmBeforeCommit = () => { throw new Error('ПАДЕНИЕ до коммита'); };
  await assert.rejects(confirm(b.id), /ПАДЕНИЕ до коммита/);
  if (!memory) {
    const s = await state(b.id);
    assert.equal(s.booking.status, 'request');
    assert.equal(s.booking.confirmedAt, null);
    assert.equal(s.preps.length, 0);
    assert.equal(s.rows.length, 0);
    assert.equal(s.jobs.length, 0);
  }
  delete testHooks.confirmBeforeCommit;
  if (!memory) {   // гость повторяет «Подтвердить» — всё создаётся один раз
    await confirm(b.id);
    const s = await state(b.id);
    assert.equal(s.booking.status, 'confirmed'); assert.equal(s.preps.length, 1); assert.equal(s.jobs.length, 1);
  }
});

test('шаг 3, сбой B: коммит прошёл, «падение» до журнала → после перезапуска планировщик достраивает, без дублей; повтор клиента после таймаута', async () => {
  const b = await newRequest();
  testHooks.confirmAfterCommit = () => { throw new Error('ПАДЕНИЕ после коммита'); };
  await assert.rejects(confirm(b.id), /ПАДЕНИЕ после коммита/);
  delete testHooks.confirmAfterCommit;
  let s = await state(b.id);
  assert.equal(s.booking.status, 'confirmed');
  assert.equal(s.preps.length, 1, 'подготовка уже есть — она в той же транзакции');
  assert.deepEqual(s.rows.map(x => x.status), ['pending', 'pending']);
  assert.equal(s.jobs.length, 0, 'водителям ещё не предложено');
  // клиент не получил ответ и повторил — «подтверждена», вторых эффектов нет (журнал выполнится один раз)
  const B = boot();   // «перезапуск»: новый процесс, новая шина и диспетчер
  assert.equal((await confirm(b.id, B)).status, 'confirmed');
  await runBookingMaintenance({ events: B.events, dispatch: B.dispatch });
  await runBookingMaintenance({ events: B.events, dispatch: B.dispatch });
  await B.events.idle(); await A.events.idle();
  s = await state(b.id);
  assert.equal(s.preps.length, 1);
  assert.equal(s.jobs.length, 1);
  assert.deepEqual(s.rows.map(x => x.status), ['done', 'done']);
  assert.equal(emitted('booking.confirmed', b.id), 1);
  assert.equal(seen.filter(e => e.name === 'transfer.offered' && e.jobId === s.jobs[0].id).length, 1, 'водителям предложено один раз');
});

test('шаг 3, сбой C: часть журнала выполнена, «падение» → после перезапуска выполняется только остальное', async () => {
  const b = await newRequest();
  let n = 0;
  testHooks.outboxAfterRow = () => { if (++n === 1) throw new Error('ПАДЕНИЕ посреди журнала'); };
  await confirm(b.id);   // ответ гостю уже ушёл; журнал оборвался после первой строки
  delete testHooks.outboxAfterRow;
  let s = await state(b.id);
  assert.deepEqual(s.rows.map(x => x.status).sort(), ['done', 'pending']);
  const doneKey = s.rows.find(x => x.status === 'done').dedupeKey;
  const B = boot();
  await runOutbox({ events: B.events, dispatch: B.dispatch });
  await runOutbox({ events: B.events, dispatch: B.dispatch });
  await B.events.idle(); await A.events.idle();
  s = await state(b.id);
  assert.deepEqual(s.rows.map(x => x.status), ['done', 'done']);
  assert.equal(s.rows.find(x => x.dedupeKey === doneKey).attempts, 0, 'выполненная строка не повторялась');
  assert.equal(s.jobs.length, 1);
  assert.equal(emitted('booking.confirmed', b.id), 1);
});

test('шаг 3: журнал — повтор dedupeKey не создаёт строку; два одновременных прогона выполняют строку один раз', async () => {
  const key = `test:s3:${randomToken(8)}`;
  const bookingId = `fake-${randomToken(6)}`;
  await enqueue(prisma, { accountId: acc.id, kind: 'event', payload: { name: 'test.s3', data: { bookingId } }, dedupeKey: key });
  await enqueue(prisma, { accountId: acc.id, kind: 'event', payload: { name: 'test.s3', data: { bookingId } }, dedupeKey: key });
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: key } }), 1);
  await Promise.all([runOutbox({ events: A.events, keys: [key] }), runOutbox({ events: A.events, keys: [key] }), runOutbox({ events: A.events, keys: [key] })]);
  await A.events.idle();
  assert.equal(emitted('test.s3', bookingId), 1, 'внешнее действие — один раз');
  assert.equal((await prisma.outboxEvent.findUnique({ where: { dedupeKey: key } })).status, 'done');
});

test('шаг 3: ошибка строки журнала → повтор позже; после 5 попыток — «failed» и «Критично» в «Сегодня»', async () => {
  const b = await newRequest();
  const broken = { createForBooking: async () => { throw new Error('водители недоступны'); }, cancelForBooking: async () => 0 };
  await confirmBooking({ accountId: acc.id, bookingId: b.id, events: A.events, dispatch: broken });
  const key = confirmKeys(b.id)[1];
  let row = await prisma.outboxEvent.findUnique({ where: { dedupeKey: key } });
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.match(row.lastError, /водители недоступны/);
  assert.ok(row.nextAttemptAt > new Date(), 'следующая попытка — позже');
  // повтор, когда пришло время, уже с рабочим диспетчером — выполнено
  await prisma.outboxEvent.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  await runOutbox({ events: A.events, dispatch: A.dispatch, keys: [key] });
  row = await prisma.outboxEvent.findUnique({ where: { dedupeKey: key } });
  assert.equal(row.status, 'done');
  assert.equal((await state(b.id)).jobs.length, 1);
  // строка, которая падает всегда: 5 попыток → failed, дальше не трогается и видна в «Сегодня»
  const b2 = await newRequest();
  await confirmBooking({ accountId: acc.id, bookingId: b2.id, events: A.events, dispatch: broken });
  const key2 = confirmKeys(b2.id)[1];
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
    await prisma.outboxEvent.updateMany({ where: { dedupeKey: key2, status: 'pending' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await runOutbox({ events: A.events, dispatch: broken, keys: [key2] });
  }
  row = await prisma.outboxEvent.findUnique({ where: { dedupeKey: key2 } });
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, OUTBOX_MAX_ATTEMPTS);
  const tv = await todayView(acc.id, { role: 'admin' });
  const item = tv.items.find(i => i.kind === 'outbox_failed' && i.ref === row.id);
  assert.ok(item, 'пункт «Критично» в «Сегодня»');
  assert.equal(item.level, 'critical');
  assert.match(item.problem, new RegExp(`№${b2.number}`));
  assert.equal((await state(b2.id)).booking.status, 'confirmed', 'бронь при этом подтверждена и с подготовкой');
  assert.equal((await state(b2.id)).preps.length, 1);
  await prisma.outboxEvent.update({ where: { id: row.id }, data: { status: 'done' } });   // «разобрали вручную»
});

test('шаг 3: сверка — создаёт недостающую подготовку и заказ водителям; повтор ничего не дублирует', async () => {
  const f = start; start += 4;
  const b = await grantGuestAccess(await prisma.booking.create({ data: { accountId: acc.id, apartmentId: apt.id, number: ++num, token: randomToken(12), source: 'site', status: 'confirmed', confirmedAt: new Date(), checkIn: d(f), checkOut: d(f + 2), guestsCount: 1, nightlyKzt: 20000, totalKzt: 40000 } }));
  const tr = await request(A.app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.token, direction: 'in', place: 'airport', date: isoDay(d(f)), time: '15:00', pax: 1, bags: 1, name: 'Гость', phone: '+7 701 000 00 00' });
  assert.equal(tr.status, 201);
  await prisma.transferJob.deleteMany({ where: { bookingId: b.id } });   // «потерянный» заказ (как после сбоя в старом коде)
  await prisma.transfer.updateMany({ where: { bookingId: b.id }, data: { status: 'requested' } });
  const r1 = await reconcileBookings();
  assert.ok(r1.preps >= 1 && r1.dispatch >= 1);
  await runOutbox({ events: A.events, dispatch: A.dispatch });
  await reconcileBookings();
  await reconcileBookings();
  await runOutbox({ events: A.events, dispatch: A.dispatch });
  const s = await state(b.id);
  assert.equal(s.preps.length, 1);
  assert.equal(s.preps[0].autoKey, turnoverKey(b.id));
  assert.equal(s.jobs.length, 1);
  assert.equal(s.rows.filter(x => x.kind === 'transfers.dispatch').length, 1);
  // ручную подготовку прохода 3 сверка не трогает и вторую не добавляет
  const b2 = await prisma.booking.create({ data: { accountId: acc.id, apartmentId: apt.id, number: ++num, token: randomToken(12), source: 'site', status: 'confirmed', checkIn: d(f + 2), checkOut: d(f + 3), guestsCount: 1, nightlyKzt: 20000, totalKzt: 20000 } });
  await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, bookingId: b2.id, date: d(f + 3) } });
  await reconcileBookings();
  const p2 = await prisma.cleaningTask.findMany({ where: { bookingId: b2.id } });
  assert.equal(p2.length, 1); assert.equal(p2[0].autoKey, null);
});

test('шаг 3: отмена — освобождает даты, отменяет заказ, удаляет только неначатую подготовку; повтор — 409 без эффектов', async () => {
  // заявка: отмена освобождает даты
  const r = await newRequest({ transfer: false });
  const c = await request(A.app).post(`/api/admin/bookings/${r.id}/cancel`).set(admin.auth);
  assert.equal(c.status, 200); assert.equal(c.body.status, 'cancelled');
  const again = await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: r.checkIn, checkOut: r.checkOut, guestsCount: 1, guest: null, paymentMethod: 'card' });
  assert.equal(again.status, 'request');
  await cancelBooking({ accountId: acc.id, bookingId: again.id, today });
  // подтверждённая: заказ водителям отменён, неначатая подготовка удалена
  const b = await newRequest();
  await confirm(b.id);
  const c2 = await request(A.app).post(`/api/admin/bookings/${b.id}/cancel`).set(admin.auth);
  assert.equal(c2.status, 200);
  let s = await state(b.id);
  assert.equal(s.booking.status, 'cancelled');
  assert.equal(s.preps.length, 0);
  assert.deepEqual(s.jobs.map(j => j.status), ['CANCELLED']);
  // повтор отмены: 409 «Бронь уже отменена», ничего не меняется
  const c3 = await request(A.app).post(`/api/admin/bookings/${b.id}/cancel`).set(admin.auth);
  assert.equal(c3.status, 409); assert.equal(c3.body.error, 'Бронь уже отменена');
  s = await state(b.id);
  assert.equal(s.rows.filter(x => x.kind === 'transfers.cancel').length, 1);
  // начатая подготовка при отмене остаётся (правило прохода 3)
  const b3 = await newRequest({ transfer: false });
  await confirm(b3.id);
  await prisma.cleaningTask.updateMany({ where: { bookingId: b3.id }, data: { status: 'progress' } });
  await cancelBooking({ accountId: acc.id, bookingId: b3.id, today });
  assert.deepEqual((await state(b3.id)).preps.map(p => p.status), ['progress']);
});

test('шаг 3: подтверждение одновременно с отменой → всегда одно согласованное состояние', async () => {
  for (let round = 0; round < 3; round++) {
    const b = await newRequest();
    const rs = await Promise.allSettled([confirm(b.id), cancelBooking({ accountId: acc.id, bookingId: b.id, today, events: A.events, dispatch: A.dispatch })]);
    assert.equal(rs[1].status, 'fulfilled', 'отмена проходит в любом порядке');
    if (rs[0].status === 'rejected') assert.equal(rs[0].reason.status, 409);
    await runOutbox({ events: A.events, dispatch: A.dispatch });
    const s = await state(b.id);
    assert.equal(s.booking.status, 'cancelled');
    assert.equal(s.preps.filter(p => p.status === 'assigned').length, 0, 'неначатой подготовки нет');
    assert.equal(s.jobs.filter(j => !['CANCELLED', 'DONE'].includes(j.status)).length, 0, 'активных заказов нет');
    const free = await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: b.checkIn, checkOut: b.checkOut, guestsCount: 1, guest: null, paymentMethod: 'card' });
    await cancelBooking({ accountId: acc.id, bookingId: free.id, today });
  }
});
