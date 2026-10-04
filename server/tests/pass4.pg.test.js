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
