// Проход 4, шаг 5 спецификации: право на индивидуальную цену (Membership.canSetLinkPrice) и атомарное изменение
// цены брони по ссылке вместе с журналом BookingPriceChange (services/linkPrice.js). Сервиса ссылок ещё нет —
// ссылка в тестах создаётся прямо в базе (только модель, шаг 5). Работает на SQLite, в памяти и на PostgreSQL.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeApp, login, prisma, request, PASS } from './helpers.js';
import { createBookingRequest, confirmBooking } from '../src/services/bookings.js';
import { setLinkPrice, hasLinkPriceRight, PRICE_FORBIDDEN } from '../src/services/linkPrice.js';
import { testHooks } from '../src/lib/testHooks.js';
import { todayIn, addDays } from '../src/lib/dates.js';

const memory = !!process.env.MEMORY_DB_SNAPSHOT;   // Prisma в памяти (демо) не откатывает транзакции
let A, acc, accB, apt, owner, admin, admin2, cleaner, ownerB, today, start = 40;
const team = (who) => request(A.app).get('/api/admin/team').set(who.auth);
const grant = (who, userId, v) => request(A.app).patch(`/api/admin/team/${userId}`).set(who.auth).send({ canSetLinkPrice: v });
const flag = async (userId, accountId = acc.id) => (await prisma.membership.findUnique({ where: { userId_accountId: { userId, accountId } } })).canSetLinkPrice;
const logs = (bookingId) => prisma.bookingPriceChange.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
const price = (who, bookingId, totalKzt, accountId = acc.id) => setLinkPrice({ accountId, bookingId, userId: who.me.user?.id ?? who.userId, totalKzt });
const total = async (id) => (await prisma.booking.findUnique({ where: { id } })).totalKzt;

/** Бронь по ссылке: request с удержанием + BookingLink (как создаст шаг 6; здесь — напрямую в базе). */
async function linkBooking({ len = 2, holdMs = 24 * 3600000, linkStatus = 'active', pets = false } = {}) {
  const f = start; start += len + 2;
  const b = await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: addDays(today, f), checkOut: addDays(today, f + len), guestsCount: 1, guest: null, source: 'link', pets, holdUntil: new Date(Date.now() + holdMs) });
  const link = await prisma.bookingLink.create({ data: { accountId: acc.id, bookingId: b.id, tokenHash: crypto.randomBytes(32).toString('hex'), terms: 'cash_on_arrival', status: linkStatus } });
  return { ...b, link };
}
async function expectReject(p, status, re) {
  await assert.rejects(p, (e) => { assert.equal(e.status, status, `${e.status} ${e.message}`); if (re) assert.match(e.message, re); return true; });
}

before(async () => {
  A = makeApp();
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  accB = await prisma.account.findUnique({ where: { slug: 'demo-b' } });
  today = todayIn(acc.timezone);
  apt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест шаг 5', address: 'ул. Тестовая, 65', district: 'Есиль', rooms: '1-комн.', maxGuests: 4, basePriceKzt: 20000, petsAllowed: true, petFeeKzt: 5000, sortOrder: -165 } });
  const om = await prisma.membership.findFirst({ where: { accountId: acc.id, role: 'owner', active: true }, include: { user: true } });
  owner = await login(A.app, om.user.email);
  admin = await login(A.app, 'alina@astanastay.example');
  const add = await request(A.app).post('/api/admin/team').set(owner.auth).send({ name: 'Админ Второй', email: `admin2-${Date.now()}@astanastay.example`, password: PASS, role: 'admin', canDrive: false });   // не водитель: не влияет на тесты трансферов
  assert.equal(add.status, 201, JSON.stringify(add.body));
  admin2 = await login(A.app, add.body.email);
  const cm = await prisma.membership.findFirst({ where: { accountId: acc.id, role: 'cleaning', active: true }, include: { user: true } });
  cleaner = await login(A.app, cm.user.email);
  ownerB = await login(A.app, 'owner@demo-b.example');
  for (const x of [owner, admin, admin2, cleaner, ownerB]) x.userId = x.me.user?.id ?? x.me.id;
});
afterEach(() => { for (const k of Object.keys(testHooks)) delete testHooks[k]; });
after(async () => {
  await prisma.membership.updateMany({ where: { accountId: acc.id }, data: { canSetLinkPrice: false } });
  await prisma.membership.updateMany({ where: { userId: admin.userId, accountId: acc.id }, data: { active: true } });
  await prisma.apartment.delete({ where: { id: apt.id } }).catch(() => {});
  if (admin2) await prisma.user.delete({ where: { id: admin2.userId } }).catch(() => {});   // временный сотрудник — убрать (членство удалится каскадом)
  await prisma.$disconnect();
});

test('шаг 5: по умолчанию у админов права нет; владельцу флаг виден, админу — нет', async () => {
  assert.ok(owner.userId && admin.userId && admin2.userId);
  assert.equal(await flag(admin.userId), false);
  assert.equal(await flag(admin2.userId), false);
  const t = await team(owner);
  const row = (id) => t.body.find(m => m.userId === id);
  assert.equal(row(admin.userId).canSetLinkPrice, false);
  assert.equal(row(admin.userId).linkPriceActive, false);
  assert.equal(row(owner.userId).canSetLinkPrice, true, 'у владельца право есть всегда');
  assert.equal(row(cleaner.userId).canSetLinkPrice, false);
  const ta = await team(admin);
  assert.ok(ta.body.every(m => !('canSetLinkPrice' in m)), 'админ флаг не видит');
});

test('шаг 5: владелец меняет цену — цена и запись журнала (старая, новая, стандартная, кто, бронь, ссылка)', async () => {
  const b = await linkBooking();
  const t0 = Date.now();
  const r = await price(owner, b.id, 33333);
  assert.equal(r.changed, true);
  const nb = await prisma.booking.findUnique({ where: { id: b.id } });
  assert.equal(nb.totalKzt, 33333);
  assert.equal(nb.nightlyKzt, Math.round(33333 / 2));
  const l = await logs(b.id);
  assert.equal(l.length, 1);
  assert.equal(l[0].accountId, acc.id); assert.equal(l[0].bookingId, b.id); assert.equal(l[0].linkId, b.link.id);
  assert.equal(l[0].oldTotalKzt, 40000); assert.equal(l[0].newTotalKzt, 33333); assert.equal(l[0].standardTotalKzt, 40000);
  assert.equal(l[0].reason, 'manual');
  assert.equal(l[0].byUserId, owner.userId); assert.equal(l[0].byRole, 'owner'); assert.ok(l[0].byName);
  assert.ok(+l[0].createdAt >= t0 - 1000);
  // та же сумма — без записи
  assert.equal((await price(owner, b.id, 33333)).changed, false);
  assert.equal((await logs(b.id)).length, 1);
  // вторая правка: старая цена берётся из базы (= прошлая новая)
  await price(owner, b.id, 30000);
  const l2 = await logs(b.id);
  assert.equal(l2.length, 2); assert.equal(l2[1].oldTotalKzt, 33333); assert.equal(l2[1].newTotalKzt, 30000);
});

test('шаг 5: админ без права → 403, цена и журнал без изменений', async () => {
  const b = await linkBooking();
  await expectReject(price(admin, b.id, 25000), 403, new RegExp(PRICE_FORBIDDEN));
  assert.equal(await total(b.id), 40000);
  assert.equal((await logs(b.id)).length, 0);
});

test('шаг 5: владелец выдал право → админ может (запись с автором-админом); забрал → снова 403, старая цена не меняется', async () => {
  const b = await linkBooking();
  const g = await grant(owner, admin.userId, true);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.canSetLinkPrice, true); assert.equal(g.body.linkPriceActive, true);
  assert.equal(await flag(admin.userId), true);
  assert.equal((await team(owner)).body.find(m => m.userId === admin.userId).canSetLinkPrice, true);
  const r = await price(admin, b.id, 28000);
  assert.equal(r.changed, true);
  const l = await logs(b.id);
  assert.equal(l.length, 1); assert.equal(l[0].byUserId, admin.userId); assert.equal(l[0].byRole, 'admin'); assert.equal(l[0].oldTotalKzt, 40000); assert.equal(l[0].newTotalKzt, 28000);
  const rv = await grant(owner, admin.userId, false);
  assert.equal(rv.status, 200); assert.equal(rv.body.canSetLinkPrice, false);
  await expectReject(price(admin, b.id, 26000), 403);
  assert.equal(await total(b.id), 28000, 'уже поставленная цена остаётся');
  assert.equal((await logs(b.id)).length, 1);
});

test('шаг 5: админ не может выдать право себе или другому админу (403); забрать — тоже нет', async () => {
  const self = await grant(admin, admin.userId, true);
  assert.equal(self.status, 403); assert.match(self.body.error, /только владелец/);
  assert.equal(await flag(admin.userId), false);
  const other = await grant(admin, admin2.userId, true);
  assert.equal(other.status, 403);
  assert.equal(await flag(admin2.userId), false);
  await grant(owner, admin2.userId, true);
  assert.equal((await grant(admin, admin2.userId, false)).status, 403, 'и забрать может только владелец');
  assert.equal(await flag(admin2.userId), true);
  assert.equal((await grant(cleaner, admin.userId, true)).status, 403, 'исполнители в API команды не пускаются вовсе');
  await grant(owner, admin2.userId, false);
});

test('шаг 5: другим ролям право не выдаётся (400) и не действует, даже если флаг оказался в базе', async () => {
  for (const role of ['cleaning', 'master', 'driver']) {
    const m = await prisma.membership.findFirst({ where: { accountId: acc.id, role, active: true } });
    const r = await grant(owner, m.userId, true);
    assert.equal(r.status, 400, `${role}: ${JSON.stringify(r.body)}`); assert.match(r.body.error, /только для администратора/);
    assert.equal(await flag(m.userId), false);
  }
  const ro = await grant(owner, owner.userId, true);
  assert.equal(ro.status, 400); assert.match(ro.body.error, /владельца.*всегда/);
  // флаг в обход API (например, роль сменили вручную) — проверка права всё равно не пускает
  await prisma.membership.update({ where: { userId_accountId: { userId: cleaner.userId, accountId: acc.id } }, data: { canSetLinkPrice: true } });
  const b = await linkBooking();
  await expectReject(price(cleaner, b.id, 25000), 403);
  await prisma.membership.update({ where: { userId_accountId: { userId: cleaner.userId, accountId: acc.id } }, data: { canSetLinkPrice: false } });
  assert.equal(hasLinkPriceRight({ role: 'driver', active: true, canSetLinkPrice: true }), false);
  assert.equal(hasLinkPriceRight({ role: 'admin', active: true, canSetLinkPrice: false }), false);
  assert.equal(hasLinkPriceRight({ role: 'admin', active: true, canSetLinkPrice: true }), true);
  assert.equal(hasLinkPriceRight({ role: 'owner', active: true, canSetLinkPrice: false }), true);
  assert.equal(hasLinkPriceRight({ role: 'owner', active: false }), false);
  assert.equal(hasLinkPriceRight(null), false);
});

test('шаг 5: отключённый админ с правом → 403; админ, ставший другой ролью, — тоже 403', async () => {
  const b = await linkBooking();
  await grant(owner, admin2.userId, true);
  assert.equal((await price(admin2, b.id, 39000)).changed, true);
  const off = await request(A.app).patch(`/api/admin/team/${admin2.userId}`).set(owner.auth).send({ active: false });
  assert.equal(off.status, 200);
  assert.equal((await team(owner)).body.find(m => m.userId === admin2.userId).linkPriceActive, false);
  await expectReject(price(admin2, b.id, 38000), 403);
  await request(A.app).patch(`/api/admin/team/${admin2.userId}`).set(owner.auth).send({ active: true });
  await prisma.membership.update({ where: { userId_accountId: { userId: admin2.userId, accountId: acc.id } }, data: { role: 'cleaning' } });
  await expectReject(price(admin2, b.id, 38000), 403);
  await prisma.membership.update({ where: { userId_accountId: { userId: admin2.userId, accountId: acc.id } }, data: { role: 'admin', canSetLinkPrice: false } });
  assert.equal(await total(b.id), 39000);
  assert.equal((await logs(b.id)).length, 1);
});

test('шаг 5: цена и журнал атомарны — сбой между ними откатывает цену, ложной записи нет', { skip: memory && 'в памяти (демо) транзакции не откатываются' }, async () => {
  const b = await linkBooking();
  testHooks.linkPriceBeforeLog = () => { throw new Error('сбой перед записью журнала'); };
  await assert.rejects(price(owner, b.id, 31000), /сбой перед записью журнала/);
  assert.equal(await total(b.id), 40000, 'цена не изменилась');
  assert.equal((await logs(b.id)).length, 0, 'записи нет');
  delete testHooks.linkPriceBeforeLog;
  await price(owner, b.id, 31000);
  assert.equal(await total(b.id), 31000);
  assert.equal((await logs(b.id)).length, 1);
});

test('шаг 5: отказ на любом шаге (право, состояние, сумма) не оставляет ни цены, ни записи', async () => {
  const b = await linkBooking();
  for (const bad of [0, -100, 1.5, '30000', null, 1_000_000_001]) await expectReject(price(owner, b.id, bad), 400);
  await expectReject(price(admin, b.id, 30000), 403);
  assert.equal(await total(b.id), 40000);
  assert.equal((await logs(b.id)).length, 0);
});

test('шаг 5: чужой аккаунт — нельзя ни бронь другого аккаунта, ни чужим пользователем', async () => {
  const b = await linkBooking();
  await expectReject(price(ownerB, b.id, 1000, accB.id), 404);   // владелец Б со своим аккаунтом — брони нет
  await expectReject(price(ownerB, b.id, 1000, acc.id), 403);    // владелец Б в аккаунте А — не участник
  await expectReject(price(owner, b.id, 1000, accB.id), 404);    // владелец А через аккаунт Б
  assert.equal(await total(b.id), 40000);
  assert.equal((await logs(b.id)).length, 0);
});

test('шаг 5: запрещённые состояния — подтверждённая бронь, закрытая ссылка, истёкшее удержание, бронь без ссылки → 409', async () => {
  // после подтверждения брони по ссылке цену этим механизмом менять нельзя
  const c = await linkBooking();
  await confirmBooking({ accountId: acc.id, bookingId: c.id, events: null, dispatch: null, actor: { type: 'admin', name: 'Тест' } });
  await expectReject(price(owner, c.id, 30000), 409, /подтверждена/);
  for (const linkStatus of ['completed', 'expired', 'revoked', 'cancelled']) {
    const b = await linkBooking({ linkStatus });
    await expectReject(price(owner, b.id, 30000), 409);
    assert.equal(await total(b.id), 40000);
  }
  const x = await linkBooking();
  await prisma.booking.update({ where: { id: x.id }, data: { status: 'cancelled' } });
  await expectReject(price(owner, x.id, 30000), 409, /не действует/);
  const e = await linkBooking();
  await prisma.booking.update({ where: { id: e.id }, data: { holdUntil: new Date(Date.now() - 1000) } });
  await expectReject(price(owner, e.id, 30000), 409, /не действует/);
  assert.equal(await total(e.id), 40000);
  // обычная бронь с сайта (без ссылки) — не этот механизм
  const f = start; start += 4;
  const s = await createBookingRequest({ accountId: acc.id, apartment: apt, checkIn: addDays(today, f), checkOut: addDays(today, f + 2), guestsCount: 1, guest: null, paymentMethod: 'card', holdUntil: new Date(Date.now() + 1800000) });
  await expectReject(price(owner, s.id, 30000), 409, /личной ссылке/);
  for (const id of [c.id, x.id, e.id, s.id]) assert.equal((await logs(id)).length, 0);
});

test('шаг 5: две одновременные правки — по очереди, журнал согласован (старая второй = новая первой)', async () => {
  const b = await linkBooking();
  await Promise.all([price(owner, b.id, 35000), price(owner, b.id, 36000)]);
  const l = await logs(b.id);
  assert.equal(l.length, 2);
  assert.equal(l[0].oldTotalKzt, 40000);
  assert.equal(l[1].oldTotalKzt, l[0].newTotalKzt);
  assert.equal(await total(b.id), l[1].newTotalKzt);
});

test('шаг 5: с животными цена за ночь пересчитывается без доплаты за животных (смена дат останется пропорциональной)', async () => {
  const b = await linkBooking({ pets: true });
  assert.equal(b.totalKzt, 45000);
  await price(owner, b.id, 35000);
  const nb = await prisma.booking.findUnique({ where: { id: b.id } });
  assert.equal(nb.nightlyKzt * 2 + nb.petFeeKzt, 35000);
  assert.equal((await logs(b.id))[0].standardTotalKzt, 45000);
});
