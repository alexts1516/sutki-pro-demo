// Проход 4, шаг 1 спецификации (миграция фундамента M1): уникальные ключи и новые поля.
// Работает одинаково на SQLite и PostgreSQL (спецификация, раздел 22). Поведение приложения не проверяется — оно не менялось.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from './helpers.js';
import { randomToken } from '../src/lib/tokens.js';
import { todayIn, addDays } from '../src/lib/dates.js';

let acc, apt;
let num = 970000 + (Date.now() % 9000);
const dupErr = (e) => e?.code === 'P2002';

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест проход 4 · M1', address: 'ул. Тестовая, 41', district: 'Есиль', rooms: '1-комн.', maxGuests: 2, basePriceKzt: 20000, sortOrder: -141 } });
});
after(async () => {
  await prisma.outboxEvent.deleteMany({ where: { accountId: acc.id, dedupeKey: { startsWith: 'test:m1:' } } });
  await prisma.apartment.delete({ where: { id: apt.id } }).catch(() => {});
  await prisma.$disconnect();
});

test('M1: CleaningTask.autoKey — одна автоматическая подготовка на ключ; ручных (без ключа) — сколько угодно', async () => {
  const date = todayIn(acc.timezone);
  const key = `turnover:test-${randomToken(8)}`;
  await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, date, autoKey: key } });
  await assert.rejects(prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, date, autoKey: key } }), dupErr, 'второй с тем же ключом — отказ базы');
  await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, date } });
  await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, date } });
  assert.equal(await prisma.cleaningTask.count({ where: { apartmentId: apt.id, autoKey: key } }), 1);
  assert.equal(await prisma.cleaningTask.count({ where: { apartmentId: apt.id, autoKey: null } }), 2, 'много NULL допустимо');
});

test('M1: OutboxEvent — строка журнала создаётся, повтор с тем же dedupeKey отклоняется базой', async () => {
  const dedupeKey = `test:m1:${randomToken(8)}`;
  const e = await prisma.outboxEvent.create({ data: { accountId: acc.id, kind: 'event', payload: { name: 'test', data: { n: 1 } }, dedupeKey } });
  assert.equal(e.status, 'pending');
  assert.equal(e.attempts, 0);
  assert.ok(e.nextAttemptAt instanceof Date);
  assert.deepEqual(e.payload, { name: 'test', data: { n: 1 } });
  await assert.rejects(prisma.outboxEvent.create({ data: { accountId: acc.id, kind: 'event', payload: {}, dedupeKey } }), dupErr);
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey } }), 1);
});

test('M1: Booking.holdUntil — поле есть, по умолчанию пусто; существующие правила занятости не изменились', async () => {
  const today = todayIn(acc.timezone);
  const b = await prisma.booking.create({ data: { accountId: acc.id, apartmentId: apt.id, number: ++num, token: randomToken(12), source: 'site', status: 'request', checkIn: addDays(today, 400), checkOut: addDays(today, 402), guestsCount: 1, nightlyKzt: 20000, totalKzt: 40000 } });
  assert.equal(b.holdUntil, null);
  const until = new Date(Date.now() + 30 * 60000);
  const u = await prisma.booking.update({ where: { id: b.id }, data: { holdUntil: until } });
  assert.equal(u.holdUntil.getTime(), until.getTime());
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'cancelled' } });
});
