// Проход 4, шаг 5: миграция M2 `pass4_booking_links` (BookingLink, BookingPriceChange, Membership.canSetLinkPrice).
// Проверяется настоящим `prisma migrate deploy` на отдельных временных базах того же вида, что и прогон:
// SQLite (npm test) — временные файлы; PostgreSQL (npm run test:pg) — временные базы рядом с тестовой.
//  1) пустая база → все миграции сразу;
//  2) база в состоянии после M1 с данными прохода 3 и шагов 1–4 → применяется только M2, данные не меняются.
// В памяти (демо) миграций нет — пропускается.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { prisma } from './helpers.js';

const memory = !!process.env.MEMORY_DB_SNAPSHOT;
const isPg = /^postgres(ql)?:/.test(process.env.DATABASE_URL || '');
const skip = memory ? 'в памяти (демо) миграций нет' : false;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M2 = '20261004160000_pass4_booking_links';
const M1 = '20261004143000_pass4_foundation';
const srcDir = path.join(root, isPg ? 'prisma/postgres' : 'prisma');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sutki-m2-'));
const pgDbs = [];
let n = 0;

/** Временная копия схемы и миграций (без M2 — если upTo='M1'). Возвращает { schema, url, migDir }. */
function workspace(upTo) {
  const dir = path.join(tmpRoot, `w${++n}`, 'prisma');
  fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
  fs.copyFileSync(path.join(srcDir, 'schema.prisma'), path.join(dir, 'schema.prisma'));
  for (const f of fs.readdirSync(path.join(srcDir, 'migrations'))) {
    if (upTo === 'M1' && f === M2) continue;
    fs.cpSync(path.join(srcDir, 'migrations', f), path.join(dir, 'migrations', f), { recursive: true });
  }
  let url;
  if (isPg) { const u = new URL(process.env.DATABASE_URL); u.pathname = `${u.pathname}_m2_${n}`; url = u.toString(); pgDbs.push(u.pathname.slice(1)); } else url = `file:${path.join(dir, 'm.db')}`;
  return { schema: path.join(dir, 'schema.prisma'), url, migDir: path.join(dir, 'migrations') };
}
const sh = (cmd, url) => execSync(cmd, { cwd: root, env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, stdio: 'pipe' }).toString();
const deploy = (w) => sh(`npx prisma migrate deploy --schema ${w.schema}`, w.url);
const status = (w) => { try { return sh(`npx prisma migrate status --schema ${w.schema}`, w.url); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const execSql = (w, sql) => { const f = path.join(path.dirname(w.schema), `data-${n}.sql`); fs.writeFileSync(f, sql); sh(`npx prisma db execute --file ${f} --schema ${w.schema}`, w.url); };

// Данные прохода 3 и шагов 1–4 сырым SQL (клиент Prisma уже знает поля M2, поэтому писать им в базу M1 нельзя).
const T = (iso) => (isPg ? `'${iso.replace('T', ' ').replace('Z', '')}'` : String(Date.parse(iso)));
const NOW = new Date().toISOString();
const HOLD = new Date(Date.now() + 30 * 60000).toISOString();
const DATA = () => `
INSERT INTO "Account" ("id","name","slug","updatedAt") VALUES ('m2acc','Миграция','m2-acc',${T(NOW)});
INSERT INTO "User" ("id","name","passwordHash","updatedAt","email") VALUES ('m2own','Владелец','x',${T(NOW)},'m2own@x.example'),('m2adm','Админ','x',${T(NOW)},'m2adm@x.example'),('m2drv','Водитель','x',${T(NOW)},'m2drv@x.example');
INSERT INTO "Membership" ("id","userId","accountId","role","paidAsDriver") VALUES ('m2m1','m2own','m2acc','owner',false),('m2m2','m2adm','m2acc','admin',true),('m2m3','m2drv','m2acc','driver',true);
INSERT INTO "Apartment" ("id","accountId","title","address","district","rooms","maxGuests","basePriceKzt","updatedAt") VALUES ('m2apt','m2acc','Кв','ул. 1','Есиль','1-комн.',4,20000,${T(NOW)});
INSERT INTO "Booking" ("id","accountId","apartmentId","number","token","source","status","checkIn","checkOut","guestsCount","nightlyKzt","totalKzt","paymentMethod","paymentStatus","updatedAt","holdUntil") VALUES
 ('m2b1','m2acc','m2apt',1001,'tok-m2b1','site','confirmed',${T('2027-01-10T00:00:00.000Z')},${T('2027-01-12T00:00:00.000Z')},2,20000,40000,'card','paid',${T(NOW)},NULL),
 ('m2b2','m2acc','m2apt',1002,'tok-m2b2','site','request',${T('2027-01-12T00:00:00.000Z')},${T('2027-01-14T00:00:00.000Z')},1,20000,40000,'card','unpaid',${T(NOW)},${T(HOLD)}),
 ('m2b3','m2acc','m2apt',1003,'tok-m2b3','direct','cancelled',${T('2027-01-10T00:00:00.000Z')},${T('2027-01-11T00:00:00.000Z')},1,20000,20000,'cash','unpaid',${T(NOW)},NULL);
INSERT INTO "CleaningTask" ("id","accountId","apartmentId","date","bookingId","autoKey") VALUES ('m2c1','m2acc','m2apt',${T('2027-01-12T00:00:00.000Z')},'m2b1','turnover:m2b1');
INSERT INTO "OutboxEvent" ("id","accountId","kind","payload","dedupeKey","status") VALUES ('m2o1','m2acc','event','{"name":"booking.confirmed","data":{"bookingId":"m2b1"}}','event:booking.confirmed:m2b1','done');
`;

async function withClient(url, fn) {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try { return await fn(db); } finally { await db.$disconnect(); }
}
/** M2 на месте: новые таблицы пустые и работают, уникальные ключи действуют, флаг по умолчанию false. */
async function checkM2(db) {
  assert.equal(await db.bookingLink.count(), 0);
  assert.equal(await db.bookingPriceChange.count(), 0);
  const b = await db.booking.findFirst({ where: { status: 'request' } });
  const link = await db.bookingLink.create({ data: { accountId: b.accountId, bookingId: b.id, tokenHash: 'h'.repeat(64), terms: 'deposit', depositKzt: 10000 } });
  assert.equal(link.status, 'active'); assert.equal(link.openCount, 0); assert.equal(link.extraCheckRequired, false);
  await assert.rejects(db.bookingLink.create({ data: { accountId: b.accountId, bookingId: b.id, tokenHash: 'g'.repeat(64), terms: 'deposit' } }), 'одна ссылка на бронь (bookingId @unique)');
  const b2 = await db.booking.findFirst({ where: { NOT: { id: b.id } } });
  await assert.rejects(db.bookingLink.create({ data: { accountId: b.accountId, bookingId: b2.id, tokenHash: 'h'.repeat(64), terms: 'deposit' } }), 'tokenHash @unique');
  const pc = await db.bookingPriceChange.create({ data: { accountId: b.accountId, bookingId: b.id, linkId: link.id, oldTotalKzt: 1, newTotalKzt: 2, standardTotalKzt: 1, reason: 'manual', byRole: 'owner' } });
  assert.ok(pc.createdAt);
  assert.equal((await db.booking.findUnique({ where: { id: b.id }, include: { link: true } })).link.id, link.id);
  // журнал переживает удаление брони (без внешнего ключа), ссылка удаляется вместе с бронью
  await db.bookingLink.delete({ where: { id: link.id } });
  assert.equal(await db.bookingPriceChange.count({ where: { id: pc.id } }), 1);
  await db.bookingPriceChange.deleteMany({ where: { id: pc.id } });
}

after(async () => {
  if (isPg) for (const d of pgDbs) await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${d}" WITH (FORCE)`).catch(() => {});
  await prisma.$disconnect();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('M2: применяется на пустой базе (все миграции подряд), схема совпадает с миграциями', { skip }, async () => {
  const w = workspace('all');
  const out = deploy(w);
  assert.match(out, new RegExp(M2));
  assert.match(status(w), /Database schema is up to date/);
  execSql(w, DATA());
  await withClient(w.url, async (db) => {
    assert.equal((await db.membership.findUnique({ where: { id: 'm2m2' } })).canSetLinkPrice, false);
    await checkM2(db);
  });
  if (!isPg) {   // SQLite: модель схемы = итог миграций (без расхождений)
    const r = (() => { try { sh(`npx prisma migrate diff --from-migrations ${w.migDir} --to-schema-datamodel ${w.schema} --shadow-database-url file:${path.join(tmpRoot, 'shadow.db')} --exit-code`, w.url); return 0; } catch (e) { return e.status; } })();
    assert.equal(r, 0, 'migrate diff: схема и миграции совпадают');
  }
});

test('M2: применяется поверх M1 на базе с данными прохода 3 и шагов 1–4 — данные не меняются', { skip }, async () => {
  const w = workspace('M1');
  deploy(w);
  assert.match(status(w), /Database schema is up to date/);
  execSql(w, DATA());
  const snap = async (db) => ({
    bookings: await db.$queryRawUnsafe('SELECT "id","status","totalKzt","nightlyKzt","holdUntil","paymentStatus","checkIn","checkOut" FROM "Booking" ORDER BY "id"'),
    members: await db.$queryRawUnsafe('SELECT "id","role","active","canDrive","paidAsDriver" FROM "Membership" ORDER BY "id"'),
    cleanings: await db.$queryRawUnsafe('SELECT "id","bookingId","autoKey","status" FROM "CleaningTask" ORDER BY "id"'),
    outbox: await db.$queryRawUnsafe('SELECT "id","dedupeKey","status","attempts" FROM "OutboxEvent" ORDER BY "id"'),
  });
  const before = await withClient(w.url, snap);
  assert.equal(before.bookings.length, 3);
  // добавляем M2 и применяем: должна примениться только она
  fs.cpSync(path.join(srcDir, 'migrations', M2), path.join(w.migDir, M2), { recursive: true });
  assert.match(status(w), new RegExp(M2));
  const out = deploy(w);
  assert.match(out, new RegExp(M2)); assert.doesNotMatch(out, new RegExp(M1));
  assert.match(status(w), /Database schema is up to date/);
  await withClient(w.url, async (db) => {
    assert.deepEqual(await snap(db), before, 'данные прохода 3 и шагов 1–4 не изменились');
    const ms = await db.membership.findMany({ where: { accountId: 'm2acc' } });
    assert.ok(ms.every(m => m.canSetLinkPrice === false), 'у всех, включая админа, права по умолчанию нет');
    if (isPg) {   // ограничение M1 на месте
      const c = await db.$queryRaw`SELECT conname FROM pg_constraint WHERE conname = 'booking_no_overlap'`;
      assert.equal(c.length, 1);
    }
    await checkM2(db);
  });
});

test('M2: текущая тестовая база содержит M2 и поле права (сид прошёл поверх всех миграций)', { skip }, async () => {
  const rows = await prisma.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL');
  assert.ok(rows.some(r => r.migration_name === M2));
  assert.equal(await prisma.membership.count({ where: { canSetLinkPrice: true, role: { not: 'admin' } } }), 0);
});
