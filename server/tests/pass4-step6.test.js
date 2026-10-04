// Проход 4, шаг 6 спецификации: сервис личных ссылок и админ-API (/api/admin/booking-links). Гостевого API ещё нет (шаг 7):
// действия гостя (данные, согласие, «Подтвердить») в тестах имитируются прямой записью в базу.
// Работает на SQLite, в памяти и на PostgreSQL; гонки двух процессов — в pass4.pg.test.js.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, PASS } from './helpers.js';
import { isAvailable, releaseExpiredHolds } from '../src/services/bookings.js';
import { findLinkByToken, hashToken, termsHashOf, missing, LINK_MAX_DAYS } from '../src/services/bookingLinks.js';
import { runBookingMaintenance } from '../src/notifications/scheduler.js';
import { testHooks } from '../src/lib/testHooks.js';
import { todayIn, addDays, isoDay } from '../src/lib/dates.js';

const memory = !!process.env.MEMORY_DB_SNAPSHOT;
const H = 3600000;
let X, acc, apt, apt2, owner, admin, admin2, cleaner, ownerB, today, start = 30;
const seen = [];
const d = (n) => isoDay(addDays(today, n));
const dates = (len = 2) => { const f = start; start += len + 2; return { checkIn: d(f), checkOut: d(f + len) }; };
const api = (who) => ({
  get: (p) => request(X.app).get(`/api/admin${p}`).set(who.auth),
  post: (p, body = {}) => request(X.app).post(`/api/admin${p}`).set(who.auth).send(body),
  patch: (p, body = {}) => request(X.app).patch(`/api/admin${p}`).set(who.auth).send(body),
});
const tokenOf = (url) => url.split('/link/')[1];
async function create(who = owner, body = {}) {
  return api(who).post('/booking-links', { apartmentId: apt.id, ...dates(), guestsCount: 2, terms: 'cash_on_arrival', ...body });
}
async function created(who = owner, body = {}) {
  const r = await create(who, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { ...r.body, token: tokenOf(r.body.url), id: r.body.link.id, bookingId: r.body.link.bookingId };
}
const dbLink = (id) => prisma.bookingLink.findUnique({ where: { id } });
const dbBooking = (id) => prisma.booking.findUnique({ where: { id }, include: { guest: true } });
const logs = (bookingId) => prisma.bookingPriceChange.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
const countApt = (a = apt) => prisma.booking.count({ where: { apartmentId: a.id } });
/** Имитация гостя (шаг 7): имя, телефон, согласие с текущим предложением, «Подтвердить». */
async function guestDone(id, { submit = true } = {}) {
  const l = await dbLink(id); const b = await dbBooking(l.bookingId);
  await prisma.guest.update({ where: { id: b.guestId }, data: { name: 'Гость Ссылки', phone: '+7 701 555 66 77' } });
  await prisma.bookingLink.update({ where: { id }, data: { guestStartedAt: new Date(), termsAcceptedAt: new Date(), termsHash: termsHashOf(b, l), ...(submit ? { submittedAt: new Date() } : {}) } });
}

before(async () => {
  const x = makeApp(); x.events.onAny((p, name) => seen.push({ name, ...p }));
  X = { app: x.app, events: x.events };
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  today = todayIn(acc.timezone);
  const mk = (n) => prisma.apartment.create({ data: { accountId: acc.id, title: `Тест шаг 6 ${n}`, address: 'ул. Тестовая, 66', district: 'Есиль', rooms: '1-комн.', maxGuests: 4, basePriceKzt: 20000, sortOrder: -166 - n } });
  apt = await mk(1); apt2 = await mk(2);
  const om = await prisma.membership.findFirst({ where: { accountId: acc.id, role: 'owner', active: true }, include: { user: true } });
  owner = await login(X.app, om.user.email);
  admin = await login(X.app, 'alina@astanastay.example');
  const add = await request(X.app).post('/api/admin/team').set(owner.auth).send({ name: 'Админ Шаг6', email: `admin6-${Date.now()}@astanastay.example`, password: PASS, role: 'admin', canDrive: false });
  admin2 = await login(X.app, add.body.email);
  const cm = await prisma.membership.findFirst({ where: { accountId: acc.id, role: 'cleaning', active: true }, include: { user: true } });
  cleaner = await login(X.app, cm.user.email);
  ownerB = await login(X.app, 'owner@demo-b.example');
  for (const w of [owner, admin, admin2, cleaner, ownerB]) w.userId = w.me.user?.id ?? w.me.id;
});
afterEach(() => { for (const k of Object.keys(testHooks)) delete testHooks[k]; });
after(async () => {
  await prisma.membership.updateMany({ where: { accountId: acc.id }, data: { canSetLinkPrice: false } });
  for (const a of [apt, apt2]) await prisma.apartment.delete({ where: { id: a.id } }).catch(() => {});
  if (admin2) await prisma.user.delete({ where: { id: admin2.userId } }).catch(() => {});
  await prisma.$disconnect();
});

test('шаг 6: создание → одна заявка Booking(request, source link, срок = holdUntil) и одна BookingLink; токен — только в url', async () => {
  const before = await countApt();
  const t0 = Date.now();
  const r = await create(admin, { guestName: 'Айдана', guestPhone: '+7 701 111 22 33', note: 'Договорились в WhatsApp' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.headers['cache-control'], 'no-store');
  const { link, url } = r.body;
  const token = tokenOf(url);
  assert.match(url, /\/link\/[A-Za-z0-9_-]{43}$/);
  assert.equal(await countApt(), before + 1);
  const b = await dbBooking(link.bookingId);
  assert.equal(b.status, 'request'); assert.equal(b.source, 'link'); assert.equal(b.paymentMethod, 'cash_on_arrival');
  assert.ok(+b.holdUntil >= t0 + 24 * H - 2000 && +b.holdUntil <= Date.now() + 24 * H + 2000);
  assert.notEqual(b.token, token, 'Booking.token не используется как токен ссылки');
  assert.equal(b.guest.name, 'Айдана'); assert.equal(b.guest.phone, '+7 701 111 22 33');
  assert.equal(await prisma.bookingLink.count({ where: { bookingId: b.id } }), 1);
  assert.equal(link.status, 'active'); assert.equal(link.stage, 'waiting_guest');
  assert.deepEqual(link.missing, ['terms']);
  assert.equal(link.totalKzt, 40000); assert.equal(link.standardTotalKzt, 40000); assert.equal(link.individualPrice, false);
  assert.equal(link.createdByName, admin.me.user?.name ?? admin.me.name);
  assert.equal(link.note, 'Договорились в WhatsApp');
  assert.equal(+new Date(link.holdUntil), +b.holdUntil, 'срок ссылки = Booking.holdUntil');
});

test('шаг 6: даты держатся — сайт и вторая ссылка на те же даты получают 409', async () => {
  const dt = dates();
  const c = await created(owner, { ...dt });
  const b = await dbBooking(c.bookingId);
  assert.equal(await isAvailable(acc.id, apt.id, b.checkIn, b.checkOut), false);
  const again = await create(owner, { ...dt });
  assert.equal(again.status, 409); assert.match(again.body.error, /заняты/);
  const site = await request(X.app).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dt, guests: 1, name: 'Сайт', phone: '+7 701 000 11 22' });
  assert.equal(site.status, 409);
});

test('шаг 6: одновременное создание на одни даты — одна ссылка; разные квартиры — обе', async () => {
  const dt = dates();
  const rs = await Promise.all([create(owner, { ...dt }), create(admin, { ...dt })]);
  assert.deepEqual(rs.map(r => r.status).sort(), [201, 409]);
  assert.equal(await prisma.booking.count({ where: { apartmentId: apt.id, checkIn: new Date(dt.checkIn), status: 'request' } }), 1);
  const both = await Promise.all([create(owner, { ...dt, apartmentId: apt2.id }), create(admin, { ...dates(), apartmentId: apt.id })]);
  assert.deepEqual(both.map(r => r.status), [201, 201]);
});

test('шаг 6: токен хранится только хэшем; сырой токен находит ссылку; ни список, ни карточка не отдают токен или хэш', async () => {
  const c = await created();
  const row = await dbLink(c.id);
  assert.equal(row.tokenHash, hashToken(c.token));
  assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  const b = await dbBooking(c.bookingId);
  assert.ok(!JSON.stringify(row).includes(c.token) && !JSON.stringify(b).includes(c.token), 'сырого токена нет в базе');
  const found = await findLinkByToken(c.token);
  assert.equal(found.id, c.id); assert.equal(found.booking.id, c.bookingId);
  assert.equal(await findLinkByToken(c.token.slice(0, -1) + (c.token.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(await findLinkByToken('short'), null);
  const one = await api(owner).get(`/booking-links/${c.id}`);
  const list = await api(owner).get('/booking-links?status=all');
  for (const body of [one.body, list.body]) {
    const s = JSON.stringify(body);
    assert.ok(!s.includes(c.token) && !s.includes(row.tokenHash) && !s.includes('tokenHash'));
  }
  assert.ok(list.body.some(l => l.id === c.id));
});

test('шаг 6: «Новая ссылка» — та же бронь и даты, старый токен сразу не работает, новый работает', async () => {
  const c = await created();
  const r = await api(admin).post(`/booking-links/${c.id}/rotate`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const fresh = tokenOf(r.body.url);
  assert.notEqual(fresh, c.token);
  assert.equal(await findLinkByToken(c.token), null, 'старый токен не работает');
  assert.equal((await findLinkByToken(fresh)).id, c.id, 'новый работает');
  assert.equal(r.body.link.bookingId, c.bookingId);
  assert.equal(r.body.link.checkIn, c.link.checkIn); assert.equal(r.body.link.checkOut, c.link.checkOut);
  assert.equal(await prisma.bookingLink.count({ where: { bookingId: c.bookingId } }), 1);
});

test('шаг 6: продление активной ссылки; после истечения — 409 «создайте новую»; предел 7 суток от создания', async () => {
  const c = await created();
  const h0 = (await dbBooking(c.bookingId)).holdUntil;
  const r = await api(owner).post(`/booking-links/${c.id}/extend`, { hours: 12 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(+(await dbBooking(c.bookingId)).holdUntil, +h0 + 12 * H);
  for (const hours of [0, 73, 1.5]) assert.equal((await api(owner).post(`/booking-links/${c.id}/extend`, { hours })).status, 400);
  // истекла (ещё не снята планировщиком) — продлить нельзя; снятие при этом закоммичено
  await prisma.booking.update({ where: { id: c.bookingId }, data: { holdUntil: new Date(Date.now() - 1000) } });
  const late = await api(owner).post(`/booking-links/${c.id}/extend`, { hours: 1 });
  assert.equal(late.status, 409); assert.match(late.body.error, /истекла — создайте новую/);
  assert.equal((await dbLink(c.id)).status, 'expired');
  assert.equal((await dbBooking(c.bookingId)).status, 'cancelled');
  // предел: 72 + 72 + 24 = 168 ч = 7 суток — можно; ещё час — нельзя
  const m = await created(owner, { expiresInHours: 72 });
  assert.equal((await api(owner).post(`/booking-links/${m.id}/extend`, { hours: 72 })).status, 200);
  assert.equal((await api(owner).post(`/booking-links/${m.id}/extend`, { hours: 24 })).status, 200);
  const over = await api(owner).post(`/booking-links/${m.id}/extend`, { hours: 1 });
  assert.equal(over.status, 409); assert.match(over.body.error, new RegExp(`${LINK_MAX_DAYS} суток`));
  const l = await dbLink(m.id); const b = await dbBooking(m.bookingId);
  assert.ok(+b.holdUntil <= +l.createdAt + LINK_MAX_DAYS * 24 * H);
  assert.equal((await create(owner, { expiresInHours: 73 })).status, 400);
  assert.equal((await create(owner, { expiresInHours: 0 })).status, 400);
});

test('шаг 6: отзыв — ссылка revoked, бронь cancelled (единая отмена), даты свободны, токен закрыт; повтор — 200 без эффектов', async () => {
  const dt = dates();
  const c = await created(owner, { ...dt });
  const r = await api(admin).post(`/booking-links/${c.id}/revoke`, { reason: 'Гость передумал' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'revoked'); assert.equal(r.body.bookingStatus, 'cancelled');
  const l = await dbLink(c.id);
  assert.equal(l.status, 'revoked'); assert.ok(l.closedAt); assert.equal(l.closedByName, admin.me.user?.name ?? admin.me.name);
  assert.equal(await isAvailable(acc.id, apt.id, new Date(dt.checkIn), new Date(dt.checkOut)), true);
  assert.equal((await findLinkByToken(c.token)).status, 'revoked', 'токен больше не даёт активную ссылку');
  const again = await api(admin).post(`/booking-links/${c.id}/revoke`);
  assert.equal(again.status, 200); assert.equal(again.body.status, 'revoked');
  assert.equal(+(await dbLink(c.id)).closedAt, +l.closedAt);
  assert.equal((await create(owner, { ...dt })).status, 201, 'даты снова можно бронировать');
  // закрытую ссылку нельзя менять как активную
  for (const p of ['extend', 'rotate']) assert.equal((await api(owner).post(`/booking-links/${c.id}/${p}`, { hours: 1 })).status, 409, p);
  assert.equal((await api(owner).patch(`/booking-links/${c.id}/price`, { totalKzt: 30000 })).status, 409);
});

test('шаг 6: истечение — ссылка expired, бронь cancelled, даты свободны; повторы ничего не дублируют', async () => {
  const dt = dates();
  const c = await created(owner, { ...dt });
  await prisma.booking.update({ where: { id: c.bookingId }, data: { holdUntil: new Date(Date.now() - 1000) } });
  const lazy = await api(owner).get(`/booking-links/${c.id}`);   // ленивое снятие при чтении
  assert.equal(lazy.body.status, 'expired');
  await runBookingMaintenance({ events: X.events });
  await runBookingMaintenance({ events: X.events });
  await releaseExpiredHolds(prisma, { apartmentId: apt.id });
  const l = await dbLink(c.id);
  assert.equal(l.status, 'expired'); assert.ok(l.closedAt);
  assert.equal((await dbBooking(c.bookingId)).status, 'cancelled');
  assert.equal(await isAvailable(acc.id, apt.id, new Date(dt.checkIn), new Date(dt.checkOut)), true);
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:link.expired:${c.id}` } }), 1);
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:booking.hold_expired:${c.bookingId}` } }), 1);
  await X.events.idle();
  assert.equal(seen.filter(e => e.name === 'link.expired' && e.linkId === c.id).length, 1);
  // истёкшая, но не снятая — по токену уже истёкшая
  const c2 = await created();
  await prisma.booking.update({ where: { id: c2.bookingId }, data: { holdUntil: new Date(Date.now() - 1) } });
  assert.equal((await findLinkByToken(c2.token)).status, 'expired');
  // отзыв истёкшей — 200, статус остаётся expired
  const rv = await api(owner).post(`/booking-links/${c2.id}/revoke`);
  assert.equal(rv.status, 200); assert.equal(rv.body.status, 'expired');
});

test('шаг 6: залог — сумма обязательна и корректна; ничего не создаётся при ошибке', async () => {
  const before = await countApt();
  for (const body of [{}, { depositKzt: 0 }, { depositKzt: -5 }, { depositKzt: 1.5 }, { depositKzt: 40001 }, { depositKzt: '10000' }]) {
    const r = await create(owner, { terms: 'deposit', ...body });
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.body)}`);
  }
  assert.equal((await create(owner, { terms: 'cash_on_arrival', depositKzt: 5000 })).status, 400, 'залог только для условий «залог»');
  assert.equal((await create(owner, { terms: 'deposit', depositKzt: 30000, totalKzt: 25000 })).status, 400, 'залог не больше итоговой суммы');
  assert.equal((await create(owner, { terms: 'kaspi' })).status, 400);
  assert.equal(await countApt(), before);
  const ok = await created(owner, { terms: 'deposit', depositKzt: 10000 });
  assert.equal(ok.link.depositKzt, 10000); assert.deepEqual(ok.link.missing, ['guest', 'terms', 'deposit']);   // гость ещё не заполнил имя и телефон
  assert.equal((await dbBooking(ok.bookingId)).paymentMethod, 'deposit');
});

test('шаг 6: «Залог получен» — кто и когда ставит сервер; бронь prepaid; повтор 200; без залога / закрытая — 409', async () => {
  const c = await created(owner, { terms: 'deposit', depositKzt: 10000 });
  const t0 = Date.now();
  const r = await api(admin).post(`/booking-links/${c.id}/deposit`, { depositMarkedBy: 'Хакер', depositReceivedAt: '2020-01-01T00:00:00Z' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const l = await dbLink(c.id);
  assert.equal(l.depositMarkedBy, admin.me.user?.name ?? admin.me.name);
  assert.ok(+l.depositReceivedAt >= t0 - 1000);
  assert.equal((await dbBooking(c.bookingId)).paymentStatus, 'prepaid');
  assert.equal((await dbBooking(c.bookingId)).status, 'request', 'гость ещё не подтвердил — бронь не подтверждена');
  assert.deepEqual(r.body.missing, ['guest', 'terms']);
  const again = await api(owner).post(`/booking-links/${c.id}/deposit`);
  assert.equal(again.status, 200);
  assert.equal(+(await dbLink(c.id)).depositReceivedAt, +l.depositReceivedAt);
  assert.equal((await dbLink(c.id)).depositMarkedBy, l.depositMarkedBy);
  const cash = await created();
  assert.equal((await api(owner).post(`/booking-links/${cash.id}/deposit`)).status, 409);
  const closed = await created(owner, { terms: 'deposit', depositKzt: 1000 });
  await api(owner).post(`/booking-links/${closed.id}/revoke`);
  assert.equal((await api(owner).post(`/booking-links/${closed.id}/deposit`)).status, 409);
});

test('шаг 6: доп. подтверждение — только отметка (без файлов); не запрашивалось — 409', async () => {
  const c = await created(owner, { extraCheckRequired: true, extraCheckNote: 'Паспорт и билет — в WhatsApp' });
  assert.deepEqual(c.link.missing, ['guest', 'terms', 'extra_check']);
  assert.equal(c.link.extraCheckNote, 'Паспорт и билет — в WhatsApp');
  const r = await api(admin).post(`/booking-links/${c.id}/extra-check`, { extraCheckedBy: 'Хакер', file: 'passport.jpg' });
  assert.equal(r.status, 200);
  const l = await dbLink(c.id);
  assert.ok(l.extraCheckedAt); assert.equal(l.extraCheckedBy, admin.me.user?.name ?? admin.me.name);
  assert.deepEqual(r.body.missing, ['guest', 'terms']);
  const plain = await created();
  assert.equal((await api(owner).post(`/booking-links/${plain.id}/extra-check`)).status, 409);
  const noNote = await created(owner, { extraCheckRequired: false, extraCheckNote: 'не нужно' });
  assert.equal(noNote.link.extraCheckNote, null);
});

test('шаг 6: подтверждение через общее ядро — гость всё сделал + последняя отметка админа → completed, confirmed, одна подготовка', async () => {
  const c = await created(owner, { terms: 'deposit', depositKzt: 5000, extraCheckRequired: true });
  await guestDone(c.id);
  const r1 = await api(admin).post(`/booking-links/${c.id}/deposit`);
  assert.equal(r1.body.status, 'active'); assert.equal(r1.body.stage, 'waiting_admin'); assert.deepEqual(r1.body.missing, ['extra_check']);
  const r2 = await api(admin).post(`/booking-links/${c.id}/extra-check`);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.status, 'completed'); assert.equal(r2.body.bookingStatus, 'confirmed');
  const b = await dbBooking(c.bookingId);
  assert.equal(b.status, 'confirmed'); assert.equal(b.holdUntil, null); assert.equal(b.paymentStatus, 'prepaid');
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
  assert.ok((await dbLink(c.id)).completedAt);
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:link.completed:${c.id}` } }), 1);
  // подтверждённую нельзя отозвать, продлить, сменить цену или токен
  assert.equal((await api(owner).post(`/booking-links/${c.id}/revoke`)).status, 409);
  assert.equal((await api(owner).post(`/booking-links/${c.id}/extend`, { hours: 1 })).status, 409);
  assert.equal((await api(owner).post(`/booking-links/${c.id}/rotate`)).status, 409);
  assert.equal((await api(owner).patch(`/booking-links/${c.id}/price`, { totalKzt: 30000 })).status, 409);
  assert.equal((await dbBooking(c.bookingId)).status, 'confirmed', 'подтверждённая бронь не возвращается в заявку');
  // обычная отмена подтверждённой брони → ссылка cancelled
  const cn = await api(owner).post(`/bookings/${c.bookingId}/cancel`);
  assert.equal(cn.status, 200);
  assert.equal((await dbLink(c.id)).status, 'cancelled');
});

test('шаг 6: подтверждение админом (существующий маршрут) закрывает ссылку как completed', async () => {
  const c = await created();
  const r = await api(admin).post(`/bookings/${c.bookingId}/confirm`);
  assert.equal(r.status, 200);
  assert.equal((await dbLink(c.id)).status, 'completed');
});

test('шаг 6: ранее созданный ремонт закрывает даты в момент подтверждения → не подтверждено, link.conflict (один), ссылка active', async () => {
  const c = await created(owner, { extraCheckRequired: true });
  await guestDone(c.id);
  const b = await dbBooking(c.bookingId);
  const rep = await prisma.repairTask.create({ data: { accountId: acc.id, apartmentId: apt.id, title: 'Потоп', createdAt: new Date(+b.createdAt - 1000), date: b.checkIn, blockDays: 1 } });
  const r = await api(admin).post(`/booking-links/${c.id}/extra-check`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'active'); assert.match(r.body.conflict, /недоступны/);
  assert.equal((await dbBooking(c.bookingId)).status, 'request');
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:link.conflict:${c.id}` } }), 1);
  await prisma.repairTask.delete({ where: { id: rep.id } });
});

test('шаг 6: индивидуальная цена — админ без права 403 (и при создании: ничего не создано), с правом — можно, владелец — можно; всё в журнале', async () => {
  const before = await countApt();
  const no = await create(admin, { totalKzt: 30000 });
  assert.equal(no.status, 403); assert.match(no.body.error, /владелец или администратор с его разрешения/);
  assert.equal(await countApt(), before, 'ни брони, ни ссылки');
  const same = await create(admin, { totalKzt: 40000 });   // совпадает со стандартной — не индивидуальная
  assert.equal(same.status, 201); assert.equal(same.body.link.individualPrice, false);
  assert.equal((await logs(same.body.link.bookingId)).length, 0);
  const plain = await created(admin);
  assert.equal((await api(admin).patch(`/booking-links/${plain.id}/price`, { totalKzt: 30000 })).status, 403);
  // владелец выдал право
  assert.equal((await api(owner).patch(`/team/${admin.userId}`, { canSetLinkPrice: true })).status, 200);
  const yes = await created(admin, { totalKzt: 33000 });
  assert.equal(yes.link.totalKzt, 33000); assert.equal(yes.link.individualPrice, true); assert.equal(yes.link.standardTotalKzt, 40000);
  const l1 = await logs(yes.bookingId);
  assert.equal(l1.length, 1);
  assert.equal(l1[0].reason, 'link_created'); assert.equal(l1[0].oldTotalKzt, 40000); assert.equal(l1[0].newTotalKzt, 33000);
  assert.equal(l1[0].byUserId, admin.userId); assert.equal(l1[0].byRole, 'admin'); assert.equal(l1[0].linkId, yes.id);
  const p = await api(admin).patch(`/booking-links/${yes.id}/price`, { totalKzt: 31000 });
  assert.equal(p.status, 200); assert.equal(p.body.totalKzt, 31000);
  // забрал — снова 403
  await api(owner).patch(`/team/${admin.userId}`, { canSetLinkPrice: false });
  assert.equal((await api(admin).patch(`/booking-links/${yes.id}/price`, { totalKzt: 30000 })).status, 403);
  assert.equal((await create(admin, { totalKzt: 30000 })).status, 403);
  // владелец
  const o = await created(owner, { totalKzt: 50000 });
  assert.equal((await api(owner).patch(`/booking-links/${o.id}/price`, { totalKzt: 45000 })).status, 200);
  const hist = await api(admin).get(`/booking-links/${o.id}/price-history`);
  assert.equal(hist.status, 200);
  assert.deepEqual(hist.body.map(h => [h.reason, h.oldTotalKzt, h.newTotalKzt, h.byRole]), [['link_created', 40000, 50000, 'owner'], ['manual', 50000, 45000, 'owner']]);
  assert.deepEqual((await api(owner).get(`/booking-links/${yes.id}/price-history`)).body.map(h => h.reason), ['link_created', 'manual']);
  for (const totalKzt of [0, -1, 1.5]) assert.equal((await api(owner).patch(`/booking-links/${o.id}/price`, { totalKzt })).status, 400);
});

test('шаг 6: создание с ценой атомарно — сбой при записи журнала откатывает и бронь, и ссылку', { skip: memory && 'в памяти (демо) транзакции не откатываются' }, async () => {
  const before = await countApt();
  testHooks.linkPriceBeforeLog = () => { throw new Error('сбой журнала'); };
  const r = await create(owner, { totalKzt: 35000 });
  assert.equal(r.status, 500);
  assert.equal(await countApt(), before);
  assert.equal(await prisma.bookingLink.count({ where: { booking: { apartmentId: apt.id }, createdAt: { gte: new Date(Date.now() - 5000) }, status: 'active', depositKzt: 35000 } }), 0);
});

test('шаг 6: чужой аккаунт — 404 на всё; исполнители — 403; поля сервера из тела игнорируются', async () => {
  const c = await created();
  const B = api(ownerB);
  for (const [m, p, body] of [['get', `/booking-links/${c.id}`], ['get', `/booking-links/${c.id}/price-history`], ['post', `/booking-links/${c.id}/extend`, { hours: 1 }], ['post', `/booking-links/${c.id}/rotate`], ['post', `/booking-links/${c.id}/revoke`], ['post', `/booking-links/${c.id}/deposit`], ['post', `/booking-links/${c.id}/extra-check`], ['patch', `/booking-links/${c.id}/price`, { totalKzt: 1000 }]]) {
    const r = await B[m](p, body);
    assert.equal(r.status, 404, `${m} ${p}: ${r.status}`);
  }
  assert.ok(!(await B.get('/booking-links?status=all')).body.some(l => l.id === c.id));
  assert.equal((await B.post('/booking-links', { apartmentId: apt.id, ...dates(), guestsCount: 1, terms: 'cash_on_arrival' })).status, 404, 'чужая квартира');
  assert.equal((await dbLink(c.id)).status, 'active');
  assert.equal((await api(cleaner).get('/booking-links')).status, 403);
  assert.equal((await api(cleaner).post('/booking-links', { apartmentId: apt.id, ...dates(), guestsCount: 1, terms: 'cash_on_arrival' })).status, 403);
  const accB = await prisma.account.findUnique({ where: { slug: 'demo-b' } });
  const forged = await created(admin, { accountId: accB.id, createdById: 'x', createdByName: 'Хакер', status: 'completed', tokenHash: 'a'.repeat(64), depositReceivedAt: '2020-01-01', depositMarkedBy: 'Хакер', extraCheckedBy: 'Хакер', holdUntil: '2099-01-01', source: 'site' });
  const l = await dbLink(forged.id); const b = await dbBooking(forged.bookingId);
  assert.equal(l.accountId, acc.id); assert.equal(b.accountId, acc.id);
  assert.equal(l.createdById, admin.userId); assert.notEqual(l.createdByName, 'Хакер');
  assert.equal(l.status, 'active'); assert.notEqual(l.tokenHash, 'a'.repeat(64));
  assert.equal(l.depositReceivedAt, null); assert.equal(l.depositMarkedBy, null); assert.equal(l.extraCheckedBy, null);
  assert.equal(b.source, 'link'); assert.ok(+b.holdUntil < Date.now() + 25 * H);
});

test('шаг 6: смена дат брони по ссылке — защита занятости, без новой брони; цена за ночь; журнал dates_changed; согласие гостя сбрасывается', async () => {
  const dtA = dates(3), dtB = dates(2);
  await api(owner).patch(`/team/${admin.userId}`, { canSetLinkPrice: false });
  const a = await created(owner, { ...dtA, totalKzt: 45000 });   // 3 ночи по 15 000 — индивидуальная
  const b = await created(owner, { ...dtB });
  await guestDone(a.id, { submit: false });
  assert.deepEqual(missing(await dbLink(a.id), await dbBooking(a.bookingId)), []);
  const before = await countApt();
  // на даты соседней ссылки — 409 (защита занятости шага 2), ничего не меняется
  const clash = await api(admin).patch(`/bookings/${a.bookingId}`, { checkIn: dtA.checkIn, checkOut: dtB.checkOut });
  assert.equal(clash.status, 409);
  assert.equal((await dbBooking(a.bookingId)).checkOut.toISOString().slice(0, 10), dtA.checkOut);
  // на свободные: 3 → 2 ночи, сумма = цена за ночь брони × ночи (пропорционально индивидуальной цене)
  const ok = await api(admin).patch(`/bookings/${a.bookingId}`, { checkIn: dtA.checkIn, checkOut: isoDay(addDays(new Date(dtA.checkIn), 2)) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await countApt(), before, 'новой брони нет');
  const nb = await dbBooking(a.bookingId);
  assert.equal(nb.totalKzt, 30000);
  const l = await logs(a.bookingId);
  assert.deepEqual(l.map(x => [x.reason, x.oldTotalKzt, x.newTotalKzt]), [['link_created', 60000, 45000], ['dates_changed', 45000, 30000]]);
  assert.equal(l[1].byUserId, admin.userId); assert.equal(l[1].standardTotalKzt, 40000);
  // предложение изменилось — согласие гостя больше не действует
  const view = (await api(owner).get(`/booking-links/${a.id}`)).body;
  assert.deepEqual(view.missing, ['terms']);
  assert.equal(view.checkOut, isoDay(addDays(new Date(dtA.checkIn), 2)));
  // и после смены цены — тоже
  await guestDone(a.id, { submit: false });
  await api(owner).patch(`/booking-links/${a.id}/price`, { totalKzt: 29000 });
  assert.deepEqual((await api(owner).get(`/booking-links/${a.id}`)).body.missing, ['terms']);
});
