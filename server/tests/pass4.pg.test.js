// Проход 4, шаг 1 спецификации: гарантия базы PostgreSQL против двойной брони (ограничение booking_no_overlap,
// EXCLUDE USING gist + btree_gist; разделы 10, 21, 22). Только PostgreSQL (npm run test:pg); на SQLite пропускается:
// там такой гарантии нет, и тест её не изображает.
// Одновременность проверяется из ОТДЕЛЬНЫХ процессов node, каждый со своим подключением к базе, — без блокировок в памяти.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './helpers.js';
import { randomToken } from '../src/lib/tokens.js';
import { todayIn, addDays } from '../src/lib/dates.js';

const isPg = /^postgres(ql)?:/.test(process.env.DATABASE_URL || '');
const skip = isPg ? false : 'только PostgreSQL (npm run test:pg) — в SQLite ограничения EXCLUDE нет (раздел 22)';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERLAP = /23P01|booking_no_overlap|exclusion constraint|conflicts with existing key/i;
// При строго одновременной вставке PostgreSQL может вместо 23P01 прервать одну из транзакций как взаимную блокировку
// (40P01, deadlock detected: обе ждут незакоммиченную строку друг друга при проверке EXCLUDE). Итог тот же — вставка отклонена базой.
const OVERLAP_OR_DEADLOCK = new RegExp(OVERLAP.source + '|40P01|deadlock detected', 'i');

let acc, apt, today;
let num = 960000 + (Date.now() % 9000);

// Отдельный процесс: своё подключение (свой PrismaClient), вставка брони.
// mode 'race' — ждёт общий момент startAt и вставляет; mode 'hold' — вставляет в транзакции, сообщает INSERTED и держит её holdMs.
const CHILD = `
import { PrismaClient } from '@prisma/client';
const a = JSON.parse(process.argv[1]);
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const data = { ...a.data, checkIn: new Date(a.data.checkIn), checkOut: new Date(a.data.checkOut) };
let out;
try {
  await db.$connect();
  await db.$queryRaw\`SELECT 1\`;
  if (a.mode === 'hold') {
    await db.$transaction(async (tx) => {
      await tx.booking.create({ data });
      console.log('INSERTED');
      await new Promise(r => setTimeout(r, a.holdMs));
    }, { timeout: a.holdMs + 10000 });
  } else {
    while (Date.now() < a.startAt) await new Promise(r => setTimeout(r, 1));
    await db.booking.create({ data });
  }
  out = { ok: true };
} catch (e) { out = { ok: false, code: e.code || null, msg: String(e.message || e) }; }
await db.$disconnect();
console.log('RESULT ' + JSON.stringify(out));
`;

function child(args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', CHILD, JSON.stringify(args)], { cwd: root, env: process.env });
    let buf = '', err = '';
    p.stdout.on('data', (d) => { buf += d; for (const l of String(d).split('\n')) if (l.trim()) onLine?.(l.trim()); });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', () => {
      const m = buf.match(/RESULT (.*)/);
      if (!m) return reject(new Error('процесс не вернул результат: ' + err.slice(-500)));
      resolve({ ...JSON.parse(m[1]), pid: p.pid });
    });
  });
}

const bookingData = (o) => ({ accountId: acc.id, apartmentId: apt.id, number: ++num, token: randomToken(12), source: 'site', status: 'confirmed', guestsCount: 1, nightlyKzt: 20000, totalKzt: 40000, ...o });
const range = (from, to) => ({ checkIn: addDays(today, from).toISOString(), checkOut: addDays(today, to).toISOString() });
const blocking = (from, to) => prisma.booking.count({ where: { apartmentId: apt.id, status: { in: ['request', 'confirmed'] }, checkIn: { lt: addDays(today, to) }, checkOut: { gt: addDays(today, from) } } });

before(async () => {
  if (!isPg) return;
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  today = todayIn(acc.timezone);
  apt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест проход 4 · EXCLUDE', address: 'ул. Тестовая, 42', district: 'Есиль', rooms: '1-комн.', maxGuests: 2, basePriceKzt: 20000, sortOrder: -142 } });
});
after(async () => {
  if (isPg && apt) await prisma.apartment.delete({ where: { id: apt.id } }).catch(() => {});
  await prisma.$disconnect();
});

test('PG: ограничение booking_no_overlap установлено миграцией (EXCLUDE, btree_gist)', { skip }, async () => {
  const c = await prisma.$queryRaw`SELECT contype::text AS t, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'booking_no_overlap'`;
  assert.equal(c.length, 1, 'ограничение есть');
  assert.equal(c[0].t, 'x', 'это EXCLUDE');
  assert.match(c[0].def, /gist/i);
  assert.match(c[0].def, /tsrange\("checkIn", "checkOut", '\[\)'::text\)/);
  assert.match(c[0].def, /request.*confirmed/);
  const ext = await prisma.$queryRaw`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`;
  assert.equal(ext.length, 1);
});

test('PG: два отдельных процесса одновременно вставляют пересекающиеся брони → ровно одна', { skip }, async () => {
  for (let round = 0; round < 3; round++) {
    const from = 10 + round * 10;
    const startAt = Date.now() + 1500;   // общий старт после подключения обоих процессов
    const rs = await Promise.all([
      child({ mode: 'race', startAt, data: bookingData(range(from, from + 3)) }),
      child({ mode: 'race', startAt, data: bookingData({ ...range(from + 1, from + 4), status: 'request' }) }),
    ]);
    assert.notEqual(rs[0].pid, rs[1].pid);
    assert.equal(rs.filter(r => r.ok).length, 1, `раунд ${round}: успешна ровно одна вставка ${JSON.stringify(rs)}`);
    assert.match(rs.find(r => !r.ok).msg, OVERLAP_OR_DEADLOCK, 'вторая отклонена базой');
    assert.equal(await blocking(from, from + 4), 1);
  }
});

test('PG: вторая вставка ждёт незакоммиченную первую и после коммита отклоняется (разные подключения)', { skip }, async () => {
  let resolveInserted;
  const inserted = new Promise((r) => { resolveInserted = r; });
  const first = child({ mode: 'hold', holdMs: 1500, data: bookingData(range(50, 53)) }, (l) => { if (l === 'INSERTED') resolveInserted(); });
  await inserted;   // первая бронь вставлена, транзакция ещё открыта
  const second = await child({ mode: 'race', startAt: 0, data: bookingData(range(51, 52)) });
  const r1 = await first;
  assert.equal(r1.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.msg, OVERLAP);
  assert.equal(await blocking(50, 53), 1);
});

test('PG: вставка в обход кода ($executeRaw) тоже отклоняется базой', { skip }, async () => {
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 60), checkOut: addDays(today, 63) }) });
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "Booking" ("id","accountId","apartmentId","number","token","source","status","checkIn","checkOut","guestsCount","nightlyKzt","totalKzt","updatedAt")
      VALUES (${'raw' + randomToken(10)}, ${acc.id}, ${apt.id}, ${++num}, ${randomToken(12)}, 'site', 'request', ${addDays(today, 62)}, ${addDays(today, 65)}, 1, 20000, 60000, now())`,
    (e) => OVERLAP.test(String(e.message) + (e.meta ? JSON.stringify(e.meta) : '')),
  );
  // смена дат существующей брони на пересекающиеся — тоже отказ
  const other = await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 70), checkOut: addDays(today, 72) }) });
  await assert.rejects(prisma.booking.update({ where: { id: other.id }, data: { checkIn: addDays(today, 62) } }), (e) => OVERLAP.test(String(e.message)));
});

test('PG: брони встык (выезд = заезд) разрешены; отменённые и завершённые даты не держат', { skip }, async () => {
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 80), checkOut: addDays(today, 83) }) });
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 83), checkOut: addDays(today, 85), status: 'request' }) });   // встык после
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 78), checkOut: addDays(today, 80) }) });   // встык до
  assert.equal(await blocking(78, 85), 3);
  const c = await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 90), checkOut: addDays(today, 93) }) });
  await prisma.booking.update({ where: { id: c.id }, data: { status: 'cancelled' } });
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 90), checkOut: addDays(today, 93), status: 'cancelled' }) });
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 91), checkOut: addDays(today, 92), status: 'completed' }) });
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 90), checkOut: addDays(today, 93) }) });   // после отмены даты свободны
  // другая квартира на те же даты — без ограничений
  const apt2 = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест проход 4 · EXCLUDE 2', address: 'ул. Тестовая, 43', district: 'Есиль', rooms: '1-комн.', maxGuests: 2, basePriceKzt: 20000, sortOrder: -143 } });
  await prisma.booking.create({ data: bookingData({ apartmentId: apt2.id, checkIn: addDays(today, 90), checkOut: addDays(today, 93) }) });
  await prisma.apartment.delete({ where: { id: apt2.id } });
});

// ---------- Шаг 2: транзакционная занятость через код приложения (withApartmentTx) ----------

// Отдельный процесс, который вызывает НАСТОЯЩИЙ сервис приложения (src/services/bookings.js) со своим подключением.
const APP_CHILD = `
const a = JSON.parse(process.argv[1]);
const { createBookingRequest, withApartmentTx } = await import('./src/services/bookings.js');
const { prisma } = await import('./src/db.js');
let out;
try {
  await prisma.$queryRaw\`SELECT 1\`;
  while (Date.now() < a.startAt) await new Promise(r => setTimeout(r, 1));
  const t0 = Date.now();
  if (a.mode === 'confirm' || a.mode === 'outbox') {   // шаг 3: настоящий диспетчер водителей и шина событий в этом процессе
    const { createEventBus } = await import('./src/notifications/events.js');
    const { createTransferDispatch } = await import('./src/services/transferJobs.js');
    const events = createEventBus({ logger: { error() {} } });
    const dispatch = createTransferDispatch({ events });
    if (a.mode === 'confirm') {
      const { confirmBooking } = await import('./src/services/bookings.js');
      const b = await confirmBooking({ accountId: a.accountId, bookingId: a.bookingId, events, dispatch });
      out = { ok: true, status: b.status, ms: Date.now() - t0 };
    } else {
      const { runOutbox } = await import('./src/services/outbox.js');
      out = { ok: true, ...(await runOutbox({ events, dispatch, keys: a.keys })), ms: Date.now() - t0 };
    }
  } else if (a.mode === 'pay') {   // шаг 4: вебхук оплаты в отдельном процессе (своя шина и диспетчер)
    const { createEventBus } = await import('./src/notifications/events.js');
    const { createTransferDispatch } = await import('./src/services/transferJobs.js');
    const { applyPaymentResult } = await import('./src/payments/index.js');
    const events = createEventBus({ logger: { error() {} } });
    const r = await applyPaymentResult({ prisma, events, dispatch: createTransferDispatch({ events }), result: { paymentId: a.paymentId, status: 'succeeded' } });
    out = { ok: true, outcome: r?.outcome || null, ms: Date.now() - t0 };
  } else if (a.mode === 'release') {   // шаг 4: планировщик снимает истёкшие удержания
    const { releaseAllExpiredHolds } = await import('./src/services/bookings.js');
    out = { ok: true, released: await releaseAllExpiredHolds(), ms: Date.now() - t0 };
  } else if (a.mode === 'create') {
    const apartment = await prisma.apartment.findUnique({ where: { id: a.apartmentId } });
    const b = await createBookingRequest({ accountId: a.accountId, apartment, checkIn: new Date(a.checkIn), checkOut: new Date(a.checkOut), guestsCount: 1, guest: null, paymentMethod: 'card' });
    out = { ok: true, id: b.id, ms: Date.now() - t0 };
  } else {   // 'hold': держать транзакцию квартиры holdMs; 'touch': войти в транзакцию квартиры и сразу выйти
    await withApartmentTx(a.apartmentId, async () => { if (a.mode === 'hold') { console.log('LOCKED'); await new Promise(r => setTimeout(r, a.holdMs)); } });
    out = { ok: true, ms: Date.now() - t0 };
  }
} catch (e) { out = { ok: false, status: e.status || null, code: e.code || null, msg: String(e.message || e) }; }
await prisma.$disconnect();
console.log('RESULT ' + JSON.stringify(out));
`;
function appChild(args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', APP_CHILD, JSON.stringify(args)], { cwd: root, env: process.env });
    let buf = '', err = '';
    p.stdout.on('data', (d) => { buf += d; for (const l of String(d).split('\n')) if (l.trim()) onLine?.(l.trim()); });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', () => { const m = buf.match(/RESULT (.*)/); if (!m) return reject(new Error('нет результата: ' + err.slice(-500))); resolve({ ...JSON.parse(m[1]), pid: p.pid }); });
  });
}

test('PG шаг 2: два процесса одновременно бронируют через сервис приложения → одна бронь, вторая 409 (не сырая ошибка)', { skip }, async () => {
  for (let round = 0; round < 3; round++) {
    const from = 300 + round * 10;
    const startAt = Date.now() + 2500;
    const rs = await Promise.all([0, 1].map(k => appChild({ mode: 'create', startAt: startAt + (round % 2 ? 300 : 0), accountId: acc.id, apartmentId: apt.id, checkIn: addDays(today, from + k).toISOString(), checkOut: addDays(today, from + 3).toISOString() })));
    assert.notEqual(rs[0].pid, rs[1].pid);
    assert.equal(rs.filter(r => r.ok).length, 1, `раунд ${round}: ${JSON.stringify(rs)}`);
    const bad = rs.find(r => !r.ok);
    assert.equal(bad.status, 409, `ответ 409: ${JSON.stringify(bad)}`);
    assert.equal(bad.msg, 'Эти даты уже заняты');
    assert.equal(await blocking(from, from + 3), 1);
  }
});

test('PG шаг 2: транзакция квартиры упорядочивает процессы (FOR NO KEY UPDATE): та же квартира ждёт, другая — нет, посторонние записи не блокируются', { skip }, async () => {
  const apt2 = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест шаг 2 · блокировка', address: 'ул. Тестовая, 44', district: 'Есиль', rooms: '1-комн.', maxGuests: 2, basePriceKzt: 20000, sortOrder: -144 } });
  let locked; const isLocked = new Promise(r => { locked = r; });
  const holder = appChild({ mode: 'hold', holdMs: 2000, startAt: 0, apartmentId: apt.id }, (l) => { if (l === 'LOCKED') locked(); });
  await isLocked;
  const t0 = Date.now();
  // запись, ссылающаяся на ту же квартиру (подготовка), не ждёт блокировку квартиры — она не меняет ключ строки
  await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, date: today } });
  const fkMs = Date.now() - t0;
  const [same, other] = await Promise.all([
    appChild({ mode: 'touch', startAt: 0, apartmentId: apt.id }),
    appChild({ mode: 'touch', startAt: 0, apartmentId: apt2.id }),
  ]);
  const h = await holder;
  assert.equal(h.ok, true);
  assert.ok(fkMs < 1000, `подготовка создана без ожидания (${fkMs} мс)`);
  assert.ok(same.ok && other.ok);
  assert.ok(Date.now() - t0 >= 1000, 'та же квартира дождалась окончания чужой транзакции');
  assert.ok(other.ms < same.ms, `другая квартира не ждала (${other.ms} мс против ${same.ms} мс)`);
  await prisma.apartment.delete({ where: { id: apt2.id } });
});

test('PG шаг 2: настоящий 23P01 внутри транзакции квартиры → 409 «Эти даты уже заняты»; настоящий 40P01 распознаётся', { skip }, async () => {
  const { withApartmentTx } = await import('../src/services/bookings.js');
  const { isDeadlockError, isOverlapError } = await import('../src/lib/dbErrors.js');
  await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 400), checkOut: addDays(today, 403) }) });
  // запись в обход проверки isAvailable — ловит ограничение базы, а клиент получает 409
  const e = await withApartmentTx(apt.id, (tx) => tx.booking.create({ data: bookingData({ checkIn: addDays(today, 401), checkOut: addDays(today, 402) }) })).catch(x => x);
  assert.equal(e.status, 409);
  assert.equal(e.message, 'Эти даты уже заняты');
  // сырая ошибка Prisma при нарушении ограничения распознаётся
  const raw = await prisma.booking.create({ data: bookingData({ checkIn: addDays(today, 401), checkOut: addDays(today, 402) }) }).catch(x => x);
  assert.ok(isOverlapError(raw));
  // настоящая взаимная блокировка двух транзакций (две строки в обратном порядке) распознаётся как 40P01
  const [a1, a2] = await Promise.all([1, 2].map(n => prisma.apartment.create({ data: { accountId: acc.id, title: `Тест deadlock ${n}`, address: 'ул. Тестовая, 45', district: 'Есиль', rooms: '1-комн.', maxGuests: 2, basePriceKzt: 1, sortOrder: -145 } })));
  const lockBoth = (x, y) => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Apartment" WHERE id = ${x} FOR UPDATE`;
    await new Promise(r => setTimeout(r, 300));
    await tx.$queryRaw`SELECT id FROM "Apartment" WHERE id = ${y} FOR UPDATE`;
  }, { timeout: 10000 });
  const rs = await Promise.allSettled([lockBoth(a1.id, a2.id), lockBoth(a2.id, a1.id)]);
  const failed = rs.filter(r => r.status === 'rejected');
  assert.equal(failed.length, 1, 'база прервала одну из двух транзакций');
  assert.ok(isDeadlockError(failed[0].reason), `распознано как deadlock: ${failed[0].reason?.code} ${String(failed[0].reason?.message).slice(0, 200)}`);
  await prisma.apartment.deleteMany({ where: { id: { in: [a1.id, a2.id] } } });
});

// ---------- Шаг 3: надёжное подтверждение и журнал отложенных действий — два процесса ----------

test('PG шаг 3: два процесса одновременно подтверждают одну бронь → одна подготовка, один заказ, одно предложение водителям', { skip }, async () => {
  const { makeApp, request } = await import('./helpers.js');
  const { createBookingRequest } = await import('../src/services/bookings.js');
  const { app } = makeApp();
  for (let round = 0; round < 3; round++) {
    const from = 500 + round * 10;
    const b = await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: addDays(today, from), checkOut: addDays(today, from + 2), guestsCount: 1, guest: null, paymentMethod: 'card' });
    const tr = await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.token, direction: 'in', place: 'airport', date: addDays(today, from).toISOString().slice(0, 10), time: '15:00', pax: 1, bags: 1, name: 'Гость', phone: '+7 701 000 00 00' });
    assert.equal(tr.status, 201);
    const startAt = Date.now() + 2500;
    const rs = await Promise.all([0, 1].map(() => appChild({ mode: 'confirm', startAt, accountId: acc.id, bookingId: b.id })));
    assert.deepEqual(rs.map(r => r.ok && r.status), ['confirmed', 'confirmed'], JSON.stringify(rs));
    const preps = await prisma.cleaningTask.findMany({ where: { bookingId: b.id } });
    const jobs = await prisma.transferJob.findMany({ where: { bookingId: b.id } });
    assert.equal(preps.length, 1);
    assert.equal(jobs.length, 1);
    assert.equal(await prisma.transferEvent.count({ where: { jobId: jobs[0].id, type: 'offered' } }), 1, 'предложение водителям — один раз');
    const rows = await prisma.outboxEvent.findMany({ where: { dedupeKey: { contains: b.id } } });
    assert.deepEqual(rows.map(r => r.status).sort(), ['done', 'done']);
  }
});

test('PG шаг 3: два процесса одновременно прогоняют журнал → каждая строка выполнена один раз (аренда)', { skip }, async () => {
  const { createBookingRequest, confirmBooking, confirmKeys } = await import('../src/services/bookings.js');
  const { makeApp, request } = await import('./helpers.js');
  const { app } = makeApp();
  const from = 560;
  const b = await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: addDays(today, from), checkOut: addDays(today, from + 2), guestsCount: 1, guest: null, paymentMethod: 'card' });
  await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.token, direction: 'in', place: 'airport', date: addDays(today, from).toISOString().slice(0, 10), time: '15:00', pax: 1, bags: 1, name: 'Гость', phone: '+7 701 000 00 00' });
  await confirmBooking({ accountId: acc.id, bookingId: b.id, events: null, dispatch: null });   // как «упал после коммита»: строки ждут
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: { in: confirmKeys(b.id) }, status: 'pending' } }), 2);
  const startAt = Date.now() + 2500;
  const rs = await Promise.all([0, 1, 2].map(() => appChild({ mode: 'outbox', startAt, keys: confirmKeys(b.id) })));
  assert.ok(rs.every(r => r.ok), JSON.stringify(rs));
  assert.equal(rs.reduce((x, r) => x + r.done, 0), 2, `всего выполнено ровно 2 строки: ${JSON.stringify(rs)}`);
  const jobs = await prisma.transferJob.findMany({ where: { bookingId: b.id } });
  assert.equal(jobs.length, 1);
  assert.equal(await prisma.transferEvent.count({ where: { jobId: jobs[0].id, type: 'offered' } }), 1);
  const rows = await prisma.outboxEvent.findMany({ where: { dedupeKey: { in: confirmKeys(b.id) } } });
  assert.ok(rows.every(r => r.status === 'done' && r.attempts === 0));
});

// ---------- Шаг 4: сайт — только с оплатой; поздняя оплата и гонки — два и три процесса ----------

async function paidRequest(from, holdMs) {   // заявка с сайта (карта, срок удержания) + созданный платёж
  const { createBookingRequest } = await import('../src/services/bookings.js');
  const b = await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: addDays(today, from), checkOut: addDays(today, from + 2), guestsCount: 1, guest: null, paymentMethod: 'card', holdUntil: new Date(Date.now() + holdMs) });
  const p = await prisma.payment.create({ data: { accountId: acc.id, bookingId: b.id, provider: 'test', amountKzt: b.totalKzt, currency: 'KZT', amount: b.totalKzt, status: 'created' } });
  return { b, p };
}
const holdersOf = (from) => prisma.booking.findMany({ where: { apartmentId: apt.id, status: { in: ['request', 'confirmed'] }, checkIn: { lt: addDays(today, from + 2) }, checkOut: { gt: addDays(today, from) } } });

test('PG шаг 4: два процесса одновременно применяют один успешный платёж → одна подтверждённая бронь, одна подготовка', { skip }, async () => {
  for (let round = 0; round < 3; round++) {
    const from = 600 + round * 10;
    const { b, p } = await paidRequest(from, 30 * 60000);
    const startAt = Date.now() + 2500;
    const rs = await Promise.all([0, 1].map(() => appChild({ mode: 'pay', startAt, paymentId: p.id })));
    assert.ok(rs.every(r => r.ok), JSON.stringify(rs));
    assert.equal(rs.filter(r => r.outcome === 'confirmed').length, 1, JSON.stringify(rs));
    const nb = await prisma.booking.findUnique({ where: { id: b.id } });
    assert.equal(nb.status, 'confirmed'); assert.equal(nb.paymentStatus, 'paid');
    assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
    assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:payment.succeeded:${p.id}` } }), 1);
  }
});

test('PG шаг 4: три процесса — поздняя оплата vs новая бронь другого гостя vs планировщик → одна бронь на даты, согласованный итог', { skip }, async () => {
  const outcomes = [];
  for (let round = 0; round < 4; round++) {   // чётные раунды — строго одновременно, нечётные — новая бронь на 300 мс позже
    const from = 650 + round * 10;
    const { b, p } = await paidRequest(from, -1000);   // удержание уже истекло, но ещё не снято
    const startAt = Date.now() + 2500;
    const [pay, create, rel] = await Promise.all([
      appChild({ mode: 'pay', startAt, paymentId: p.id }),
      appChild({ mode: 'create', startAt: startAt + (round % 2 ? 300 : 0), accountId: acc.id, apartmentId: apt.id, checkIn: addDays(today, from).toISOString(), checkOut: addDays(today, from + 2).toISOString() }),
      appChild({ mode: 'release', startAt }),
    ]);
    assert.ok(pay.ok && rel.ok, JSON.stringify({ pay, rel }));
    outcomes.push(pay.outcome);
    const holders = await holdersOf(from);
    assert.equal(holders.length, 1, 'на даты ровно одна бронь');
    const orphans = await prisma.outboxEvent.count({ where: { dedupeKey: `event:payment.orphaned:${p.id}` } });
    if (create.ok) {
      assert.equal(pay.outcome, 'orphaned', JSON.stringify({ pay, create }));
      assert.equal(holders[0].id, create.id);
      assert.equal(orphans, 1);
      assert.equal((await prisma.booking.findUnique({ where: { id: b.id } })).status, 'cancelled');
    } else {
      assert.equal(create.status, 409, JSON.stringify(create));
      assert.equal(pay.outcome, 'restored');
      assert.equal(holders[0].id, b.id);
      assert.equal(orphans, 0);
      assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
    }
    assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'succeeded');
  }
  console.log('# исходы поздней оплаты:', outcomes.join(', '));
  assert.ok(outcomes.includes('restored'), 'хотя бы раз оплата успела первой — бронь восстановлена');
});
