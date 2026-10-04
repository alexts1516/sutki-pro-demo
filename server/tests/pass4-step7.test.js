// Проход 4, шаг 7 спецификации: гостевое API личной ссылки (/api/special-link, раздел 6.2) и вид special страницы /link/:token.
// Работает на SQLite, в памяти и на PostgreSQL; гонка двух процессов «двойной Подтвердить» — в pass4.pg.test.js.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request } from './helpers.js';
import { config } from '../src/config.js';
import { isAvailable } from '../src/services/bookings.js';
import { termsHashOf, guestSubmit, guestView } from '../src/services/bookingLinks.js';
import { testHooks } from '../src/lib/testHooks.js';
import { createApp } from '../src/app.js';
import { createEventBus } from '../src/notifications/events.js';
import { createStorage } from '../src/storage/index.js';
import { todayIn, addDays, isoDay } from '../src/lib/dates.js';

const memory = !!process.env.MEMORY_DB_SNAPSHOT;
const BIG = { linkMax: 100000, linkBadMax: 100000, linkWindowMin: 15 };   // основное приложение тестов — без упора в лимит
let X, acc, apt, owner, admin, today, start = 40;
const transfers = [];
const d = (n) => isoDay(addDays(today, n));
const dates = (len = 2) => { const f = start; start += len + 2; return { checkIn: d(f), checkOut: d(f + len) }; };
const adm = (who) => ({
  post: (p, body = {}) => request(X.app).post(`/api/admin${p}`).set(who.auth).send(body),
  patch: (p, body = {}) => request(X.app).patch(`/api/admin${p}`).set(who.auth).send(body),
});
const tokenOf = (url) => url.split('/link/')[1];
async function created(body = {}, who = owner) {
  const r = await adm(who).post('/booking-links', { apartmentId: apt.id, ...dates(), guestsCount: 2, terms: 'cash_on_arrival', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: tokenOf(r.body.url), id: r.body.link.id, bookingId: r.body.link.bookingId };
}
const G = (token, app = X.app) => ({
  get: () => request(app).get(`/api/special-link/${token}`),
  guest: (body) => request(app).post(`/api/special-link/${token}/guest`).send(body),
  submit: () => request(app).post(`/api/special-link/${token}/submit`).send({}),
});
const GOOD = { name: 'Гость Ссылки', phone: '+7 701 555 66 77', email: 'guest@example.com', acceptTerms: true };
const dbLink = (id) => prisma.bookingLink.findUnique({ where: { id } });
const dbBooking = (id) => prisma.booking.findUnique({ where: { id }, include: { guest: true, apartment: true } });
/** Все строки ответа (включая вложенные) — чтобы искать утечки id, токена и хэша. */
const strings = (o, acc = []) => { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) { acc.push(k); strings(v, acc); } } else if (o != null) acc.push(String(o)); return acc; };
async function assertSafe(body, c) {
  const b = await dbBooking(c.bookingId); const l = await dbLink(c.id);
  const all = strings(body);
  for (const key of ['id', 'bookingId', 'guestId', 'accountId', 'apartmentId', 'tokenHash', 'token', 'linkId', 'termsHash', 'createdById', 'openCount', 'depositMarkedBy', 'extraCheckedBy']) assert.ok(!all.includes(key), `нет поля ${key}`);
  for (const secret of [b.id, b.guestId, b.accountId, b.apartmentId, l.id, l.tokenHash, c.token, l.termsHash].filter(Boolean)) assert.ok(!all.some(s => s.includes(secret)), `нет значения ${secret.slice(0, 8)}…`);
  if (body.status !== 'completed') assert.ok(!all.some(s => s.includes(b.token)), 'Booking.token (Telegram) — только после подтверждения');
}

before(async () => {
  const x = makeApp({ config: { ...config, rateLimit: BIG } });
  X = { app: x.app, events: x.events };
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  today = todayIn(acc.timezone);
  apt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест шаг 7', address: 'ул. Секретная, 77, кв. 7', district: 'Есиль', rooms: '2-комн.', maxGuests: 4, basePriceKzt: 20000, sortOrder: -177 } });
  await prisma.apartmentPhoto.create({ data: { accountId: acc.id, apartmentId: apt.id, url: '/uploads/test-step7.jpg', storageKey: 'test-step7.jpg', isCover: true } });
  const om = await prisma.membership.findFirst({ where: { accountId: acc.id, role: 'owner', active: true }, include: { user: true } });
  owner = await login(X.app, om.user.email);
  admin = await login(X.app, 'alina@astanastay.example');
});
afterEach(() => { for (const k of Object.keys(testHooks)) delete testHooks[k]; });
after(async () => {
  for (const id of transfers) { await prisma.transferJob.deleteMany({ where: { transferId: id } }).catch(() => {}); await prisma.transfer.delete({ where: { id } }).catch(() => {}); }
  await prisma.apartmentPhoto.deleteMany({ where: { apartmentId: apt.id } }).catch(() => {});
  await prisma.apartment.delete({ where: { id: apt.id } }).catch(() => {});
  await prisma.$disconnect();
});

test('шаг 7 (1, 5, 6): GET действующей ссылки — предложение без входа; ни внутренних id, ни токена, ни хэша; адреса нет; no-store', async () => {
  const c = await created({ note: 'Договорились в WhatsApp', guestName: 'Айдана' });
  const r = await G(c.token).get();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const j = r.body;
  assert.equal(j.status, 'active'); assert.equal(j.stage, 'waiting_guest'); assert.deepEqual(j.missing, ['guest', 'terms']);
  const b = await dbBooking(c.bookingId);
  assert.equal(+new Date(j.holdUntil), +b.holdUntil);
  assert.deepEqual(j.apartment, { title: 'Тест шаг 7', rooms: '2-комн.', maxGuests: 4, photo: '/uploads/test-step7.jpg' });
  assert.equal(j.checkIn, isoDay(b.checkIn)); assert.equal(j.checkOut, isoDay(b.checkOut));
  assert.equal(j.checkInTime, b.checkInTime); assert.equal(j.checkOutTime, b.checkOutTime);
  assert.equal(j.nights, 2); assert.equal(j.guestsCount, 2); assert.equal(j.totalKzt, 40000);
  assert.equal(j.terms, 'cash_on_arrival'); assert.equal(j.depositKzt, null); assert.equal(j.note, 'Договорились в WhatsApp');
  assert.equal(j.extraCheckRequired, false); assert.equal(j.extraCheckNote, null);
  assert.deepEqual(j.guest, { name: 'Айдана', phone: null });
  assert.deepEqual(j.booking, { number: b.number, status: 'request' });
  assert.equal(j.telegramLink, undefined, 'Telegram — только после подтверждения');
  assert.ok(!JSON.stringify(j).includes('Секретная'), 'адрес до подтверждения не отдаётся');
  await assertSafe(j, c);
  // два GET — один и тот же ответ; открытия только считаются (не «гость начал»)
  const r2 = await G(c.token).get();
  assert.deepEqual(r2.body, j);
  const l = await dbLink(c.id);
  assert.equal(l.openCount, 2); assert.ok(l.lastOpenedAt); assert.equal(l.guestStartedAt, null);
  // без входа — да; админ-API без входа — нет
  assert.equal((await request(X.app).get(`/api/admin/booking-links/${c.id}`)).status, 401);
});

test('шаг 7 (2, 3, 26, 27): неверный токен 404; короткий/длинный — 404 без запроса к базе; после «Новой ссылки» старый 404, новый работает', async () => {
  const c = await created();
  const wrong = c.token.slice(0, -1) + (c.token.endsWith('A') ? 'B' : 'A');
  assert.equal((await G(wrong).get()).status, 404);
  assert.equal((await G(wrong).submit()).status, 404);
  const del = prisma.bookingLink; const orig = del.findUnique; let calls = 0;
  del.findUnique = (...a) => { calls++; return orig.apply(del, a); };
  try {
    for (const t of ['short', 'x'.repeat(39), 'y'.repeat(65)]) {
      assert.equal((await G(t).get()).status, 404);
      assert.equal((await G(t).guest(GOOD)).status, 404, 'длина проверяется до разбора тела');
      assert.equal((await G(t).submit()).status, 404);
    }
    assert.equal(calls, 0, 'короткий/длинный токен — ни одного запроса к BookingLink');
    assert.equal((await G(c.token).get()).status, 200);
    assert.ok(calls >= 1, 'перехват действительно видит запросы');
  } finally { del.findUnique = orig; }
  const rot = await adm(owner).post(`/booking-links/${c.id}/rotate`);
  assert.equal(rot.status, 200);
  const fresh = tokenOf(rot.body.url);
  assert.equal((await G(c.token).get()).status, 404, 'старый токен после «Новой ссылки» — 404');
  assert.equal((await G(c.token).guest(GOOD)).status, 404);
  assert.equal((await G(fresh).get()).status, 200, 'новый токен работает');
  assert.equal((await G(fresh).guest(GOOD)).status, 200);
  assert.equal((await request(X.app).get(`/api/link/${fresh}`)).body.kind, 'special');
  assert.equal((await request(X.app).get(`/api/link/${c.token}`)).status, 404);
});

test('шаг 7 (4, 8): linkGuard без изменений лимитов — 404 считаются, после 20 неверных — 429; действующая ссылка работает до лимита', async () => {
  const c = await created();
  const x = makeApp();   // лимиты по умолчанию: 120 запросов и 20 неверных за 15 мин с IP
  assert.equal((await G(c.token, x.app).get()).status, 200);
  for (let i = 0; i < 20; i++) assert.equal((await G('bad' + i, x.app).get()).status, 404);
  const r = await G(c.token, x.app).get();
  assert.equal(r.status, 429, 'после лимита неверных — 429 даже для верной ссылки');
  assert.ok(r.headers['retry-after']);
  // общий лимит на все ссылки без входа: /api/link и /api/task-link тоже под тем же счётчиком
  assert.equal((await request(x.app).get(`/api/link/${c.token}`)).status, 429);
  // свой лимит (из конфигурации) — неверные длинные токены тоже считаются
  const y = makeApp({ config: { ...config, rateLimit: { linkMax: 120, linkBadMax: 3, linkWindowMin: 15 } } });
  for (let i = 0; i < 3; i++) assert.equal((await G('z'.repeat(43 + i), y.app).get()).status, 404);
  assert.equal((await G(c.token, y.app).get()).status, 429);
});

test('шаг 7 (7, 8, 9, 13 безопасность): POST данных — Guest обновлён, согласие с текущими условиями; без acceptTerms — 400; лишние поля отброшены; повтор без дублей', async () => {
  const c = await created();
  const before = await dbBooking(c.bookingId);
  for (const bad of [{ ...GOOD, acceptTerms: undefined }, { ...GOOD, acceptTerms: false }, { ...GOOD, acceptTerms: 'true' }]) {
    const r = await G(c.token).guest(bad);
    assert.equal(r.status, 400, JSON.stringify(r.body));
  }
  assert.equal((await G(c.token).guest({ ...GOOD, name: '' })).status, 400);
  assert.equal((await G(c.token).guest({ ...GOOD, phone: 'abc' })).status, 400);
  assert.equal((await G(c.token).guest({ ...GOOD, email: 'not-mail' })).status, 400);
  assert.equal((await dbLink(c.id)).guestStartedAt, null, 'отказ ничего не записал');
  const r = await G(c.token).guest({
    ...GOOD, totalKzt: 1, checkIn: d(1), checkOut: d(200), status: 'confirmed', bookingStatus: 'confirmed', depositReceivedAt: new Date().toISOString(),
    extraCheckedAt: new Date().toISOString(), termsHash: 'x', terms: 'deposit', depositKzt: 1, guestsCount: 4, accountId: 'other', paymentStatus: 'paid',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'active'); assert.equal(r.body.stage, 'ready'); assert.deepEqual(r.body.missing, []);
  assert.deepEqual(r.body.guest, { name: 'Гость Ссылки', phone: '+7 701 555 66 77' });
  await assertSafe(r.body, c);
  const b = await dbBooking(c.bookingId); const l = await dbLink(c.id);
  assert.equal(b.guest.name, 'Гость Ссылки'); assert.equal(b.guest.phone, '+7 701 555 66 77'); assert.equal(b.guest.email, 'guest@example.com');
  assert.equal(b.totalKzt, before.totalKzt); assert.equal(+b.checkIn, +before.checkIn); assert.equal(+b.checkOut, +before.checkOut);
  assert.equal(b.status, 'request'); assert.equal(b.paymentStatus, before.paymentStatus); assert.equal(b.guestsCount, 2);
  assert.equal(l.terms, 'cash_on_arrival'); assert.equal(l.depositKzt, null); assert.equal(l.depositReceivedAt, null); assert.equal(l.extraCheckedAt, null);
  assert.equal(l.submittedAt, null, 'POST данных — не «Подтвердить»');
  assert.equal(l.termsHash, termsHashOf(b, l), 'termsHash = отпечаток текущих условий');
  assert.ok(l.termsAcceptedAt && l.guestStartedAt);
  const started = l.guestStartedAt;
  // повтор: тот же Guest, guestStartedAt не меняется, одно событие link.started
  const guests = await prisma.guest.count({ where: { accountId: acc.id } });
  const r2 = await G(c.token).guest({ ...GOOD, name: 'Гость Ссылки Второй' });
  assert.equal(r2.status, 200);
  assert.equal(await prisma.guest.count({ where: { accountId: acc.id } }), guests, 'новый Guest не создаётся');
  assert.equal(+(await dbLink(c.id)).guestStartedAt, +started);
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:link.started:${c.id}` } }), 1);
  assert.equal(await prisma.booking.count({ where: { apartmentId: apt.id, checkIn: before.checkIn } }), 1, 'брони не дублируются');
});

test('шаг 7 (10, 11): смена дат или цены админом делает старое согласие недействительным — гость соглашается заново', async () => {
  const c = await created();
  assert.equal((await G(c.token).guest(GOOD)).status, 200);
  assert.deepEqual((await G(c.token).get()).body.missing, []);
  const b = await dbBooking(c.bookingId);
  const moved = await adm(owner).patch(`/bookings/${c.bookingId}`, { checkOut: isoDay(addDays(b.checkOut, 1)) });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  let j = (await G(c.token).get()).body;
  assert.deepEqual(j.missing, ['terms'], 'даты изменились — нужно новое согласие'); assert.equal(j.stage, 'guest_started');
  let s = await G(c.token).submit();
  assert.equal(s.status, 200); assert.equal(s.body.status, 'active'); assert.deepEqual(s.body.missing, ['terms']);
  assert.equal((await dbBooking(c.bookingId)).status, 'request', 'по старому согласию не подтверждается');
  // новое согласие — с новыми условиями; т.к. «Подтвердить» уже нажато, бронь подтверждается сразу (раздел 4.3)
  const again = await G(c.token).guest(GOOD);
  assert.equal(again.status, 200); assert.equal(again.body.status, 'completed');
  // цена
  const c2 = await created();
  assert.equal((await G(c2.token).guest(GOOD)).status, 200);
  assert.equal((await adm(owner).patch(`/booking-links/${c2.id}/price`, { totalKzt: 33000 })).status, 200);
  j = (await G(c2.token).get()).body;
  assert.equal(j.totalKzt, 33000); assert.deepEqual(j.missing, ['terms'], 'цена изменилась — нужно новое согласие');
  s = await G(c2.token).submit();
  assert.deepEqual(s.body.missing, ['terms']);
  assert.equal((await G(c2.token).guest(GOOD)).body.status, 'completed');
  const l2 = await dbLink(c2.id); const b2 = await dbBooking(c2.bookingId);
  assert.equal(l2.termsHash, termsHashOf(b2, l2)); assert.equal(b2.totalKzt, 33000); assert.equal(b2.status, 'confirmed');
});

test('шаг 7 (12, 13, 16): «Подтвердить» без данных / без согласия — active + missing; документы не нужны никогда', async () => {
  const c = await created();
  let s = await G(c.token).submit();
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body, { status: 'active', stage: 'waiting_guest', missing: ['guest', 'terms'], booking: { number: (await dbBooking(c.bookingId)).number, status: 'request' } });
  assert.ok((await dbLink(c.id)).submittedAt, 'нажатие запомнено (submittedAt)');
  // данные есть, согласия нет (гость с именем и телефоном, но галочки не было)
  const c2 = await created({ guestName: 'Айдана', guestPhone: '+7 701 111 22 33' });
  s = await G(c2.token).submit();
  assert.equal(s.body.status, 'active'); assert.deepEqual(s.body.missing, ['terms']);
  assert.equal((await dbBooking(c2.bookingId)).status, 'request');
  // без доп. подтверждения: имя + телефон + согласие → подтверждено (паспорт/билет/файлы не нужны)
  assert.equal((await G(c2.token).guest({ name: 'Айдана', phone: '+7 701 111 22 33', acceptTerms: true })).body.status, 'completed');
  for (const m of ['passport', 'ticket', 'document', 'documents']) assert.ok(!JSON.stringify(s.body).includes(m));
});

test('шаг 7 (14, 15): залог и доп. подтверждение без отметки админа — стадия waiting_admin, не ошибка; отметка — подтверждение', async () => {
  const c = await created({ terms: 'deposit', depositKzt: 10000 });
  assert.equal((await G(c.token).guest(GOOD)).status, 200);
  let s = await G(c.token).submit();
  assert.equal(s.status, 200);
  assert.equal(s.body.status, 'active'); assert.equal(s.body.stage, 'waiting_admin'); assert.deepEqual(s.body.missing, ['deposit']);
  let j = (await G(c.token).get()).body;
  assert.equal(j.stage, 'waiting_admin'); assert.equal(j.depositKzt, 10000); assert.equal(j.terms, 'deposit');
  assert.equal((await adm(admin).post(`/booking-links/${c.id}/deposit`)).status, 200);
  j = (await G(c.token).get()).body;
  assert.equal(j.status, 'completed'); assert.equal(j.booking.status, 'confirmed');
  const e = await created({ extraCheckRequired: true, extraCheckNote: 'Пришлите фото паспорта в WhatsApp' });
  assert.equal((await G(e.token).guest(GOOD)).status, 200);
  s = await G(e.token).submit();
  assert.equal(s.body.stage, 'waiting_admin'); assert.deepEqual(s.body.missing, ['extra_check']);
  j = (await G(e.token).get()).body;
  assert.equal(j.extraCheckRequired, true); assert.equal(j.extraCheckNote, 'Пришлите фото паспорта в WhatsApp');
  assert.equal((await G(e.token).submit()).body.stage, 'waiting_admin', 'повтор — тот же ответ ожидания');
  assert.equal((await adm(owner).post(`/booking-links/${e.id}/extra-check`)).status, 200);
  assert.equal((await G(e.token).submit()).body.status, 'completed');
});

test('шаг 7 (17–20, 28, 29): готовая ссылка подтверждается общим ядром — бронь confirmed, ссылка completed, одна подготовка, один заказ водителю; повтор без эффектов; адрес и Telegram', async () => {
  const xt = makeApp({ config: { ...config, rateLimit: BIG, telegram: { ...config.telegram, username: 'sutki_test_bot' } } });
  const c = await created();
  const b0 = await dbBooking(c.bookingId);
  const tr = await prisma.transfer.create({ data: { accountId: acc.id, apartmentId: apt.id, bookingId: c.bookingId, direction: 'in', date: b0.checkIn, time: '13:00', priceKzt: 8000, status: 'planned' } });
  transfers.push(tr.id);
  assert.equal((await G(c.token, xt.app).guest(GOOD)).status, 200);
  const s = await G(c.token, xt.app).submit();
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body, { status: 'completed', stage: 'completed', missing: [], booking: { number: b0.number, status: 'confirmed' } });
  const b = await dbBooking(c.bookingId); const l = await dbLink(c.id);
  assert.equal(b.status, 'confirmed'); assert.equal(b.holdUntil, null); assert.ok(b.confirmedAt);
  assert.equal(l.status, 'completed'); assert.ok(l.completedAt);
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1, 'ровно одна подготовка');
  assert.equal(await prisma.transferJob.count({ where: { transferId: tr.id } }), 1, 'проход 3: заказ водителю создан');
  for (const k of [`event:booking.confirmed:${b.id}`, `transfers.dispatch:${b.id}`, `event:link.completed:${l.id}`]) {
    const row = await prisma.outboxEvent.findUnique({ where: { dedupeKey: k } });
    assert.ok(row, k); assert.equal(row.status, 'done', `${k} выполнен сразу после коммита`);
  }
  // повторный «Подтвердить» и повторный POST данных — без эффектов
  const again = await G(c.token, xt.app).submit();
  assert.deepEqual(again.body, s.body);
  assert.equal((await G(c.token, xt.app).guest(GOOD)).status, 409, 'данные подтверждённой брони не меняются');
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
  assert.equal(await prisma.transferJob.count({ where: { transferId: tr.id } }), 1);
  assert.equal(await prisma.booking.count({ where: { apartmentId: apt.id, checkIn: b.checkIn } }), 1);
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:link.completed:${l.id}` } }), 1);
  // после подтверждения: «Бронь №… подтверждена», адрес, Telegram b_<Booking.token>
  const j = (await G(c.token, xt.app).get()).body;
  assert.equal(j.status, 'completed'); assert.equal(j.stage, 'completed'); assert.equal(j.holdUntil, null);
  assert.deepEqual(j.booking, { number: b.number, status: 'confirmed' });
  assert.equal(j.apartment.address, 'ул. Секретная, 77, кв. 7', 'полный адрес — после подтверждения');
  assert.equal(j.telegramLink, `https://t.me/sutki_test_bot?start=b_${b.token}`);
  await assertSafe(j, c);
  assert.equal((await dbLink(c.id)).openCount, l.openCount, 'просмотр подтверждённой ссылки ничего не пишет');
  // без имени бота — ссылки на Telegram нет (как у брони с сайта)
  assert.equal((await G(c.token).get()).body.telegramLink, null);
});

test('шаг 7 (21): ответ на «Подтвердить» потерян (клиент не дождался) — повтор возвращает «подтверждена», не 410 и не ошибку', async () => {
  const c = await created();
  assert.equal((await G(c.token).guest(GOOD)).status, 200);
  // первый запрос закоммитился, но ответ «потерялся»: вызываем ядро напрямую (как сервер), ответ клиенту не используем
  await guestSubmit({ token: c.token });
  assert.equal((await dbBooking(c.bookingId)).status, 'confirmed');
  const r = await G(c.token).submit();
  assert.equal(r.status, 200); assert.equal(r.body.status, 'completed'); assert.equal(r.body.booking.status, 'confirmed');
  assert.equal((await G(c.token).get()).status, 200);
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: c.bookingId } }), 1);
});

test('шаг 7: сбой до коммита подтверждения — 500 без подтверждения; в журнал ошибок токен не попадает; повтор подтверждает', async () => {
  const c = await created();
  const logged = [];
  const cap = (...a) => logged.push(a.map(x => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' '));
  const app = createApp({ config: { ...config, rateLimit: BIG }, events: createEventBus({ logger: { error: cap } }), storage: createStorage(config.storage), logger: { error: cap, warn: cap, log: cap, info: cap } });
  assert.equal((await G(c.token, app).guest(GOOD)).status, 200);
  testHooks.confirmBeforeCommit = () => { throw new Error('сбой процесса (тест)'); };
  const r = await G(c.token, app).submit();
  assert.equal(r.status, 500);
  delete testHooks.confirmBeforeCommit;
  assert.ok(logged.length >= 1, 'ошибка записана в журнал');
  assert.ok(logged.some(s => s.includes('/api/special-link/***/submit')), 'адрес в журнале — с маской');
  assert.ok(!logged.some(s => s.includes(c.token)), 'токена в журнале нет');
  if (!memory) assert.equal((await dbBooking(c.bookingId)).status, 'request', 'откат: бронь не подтверждена');
  const ok = await G(c.token, app).submit();
  assert.equal(ok.status, 200); assert.equal(ok.body.status, 'completed');
  assert.ok(!logged.some(s => s.includes(c.token)));
});

test('шаг 7 (22, 23, 24): граница срока строгая — за 1 мс до holdUntil подтверждается; ровно в holdUntil — 410, ссылка expired, бронь cancelled, даты свободны', async () => {
  const c = await created();
  assert.equal((await G(c.token).guest(GOOD)).status, 200);
  const hold = (await dbBooking(c.bookingId)).holdUntil;
  const r = await guestSubmit({ token: c.token, now: new Date(+hold - 1) });
  assert.equal(r.status, 'completed', 'за 1 мс до срока — подтверждено');
  assert.equal((await dbBooking(c.bookingId)).status, 'confirmed');

  const e = await created();
  assert.equal((await G(e.token).guest(GOOD)).status, 200);
  const be = await dbBooking(e.bookingId);
  await assert.rejects(guestSubmit({ token: e.token, now: be.holdUntil }), (err) => err.status === 410 && err.details?.status === 'expired');
  const bx = await dbBooking(e.bookingId); const lx = await dbLink(e.id);
  assert.equal(bx.status, 'cancelled', 'истечение — бронь cancelled'); assert.equal(lx.status, 'expired'); assert.ok(lx.closedAt);
  assert.ok(await isAvailable(acc.id, apt.id, bx.checkIn, bx.checkOut), 'даты свободны');
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:link.expired:${e.id}` } }), 1);
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: e.bookingId } }), 0);
  // по HTTP: истёкшая ссылка — 410 на всё (ленивое закрытие уже выполнено)
  for (const res of [await G(e.token).get(), await G(e.token).guest(GOOD), await G(e.token).submit()]) {
    assert.equal(res.status, 410); assert.match(res.body.error, /больше не действует/); assert.equal(res.body.details.status, 'expired');
  }
  // срок вышел, но планировщик ещё не снял: первое же чтение гостя закрывает ссылку (лениво) и отвечает 410
  const f = await created();
  assert.equal((await G(f.token).guest(GOOD)).status, 200);
  await prisma.booking.update({ where: { id: f.bookingId }, data: { holdUntil: new Date(Date.now() - 1000) } });
  assert.equal((await dbLink(f.id)).status, 'active');
  const gf = await G(f.token).submit();
  assert.equal(gf.status, 410); assert.equal(gf.body.details.status, 'expired');
  assert.equal((await dbLink(f.id)).status, 'expired'); assert.equal((await dbBooking(f.bookingId)).status, 'cancelled');
  // GET ровно в момент срока (сервисом с тем же now)
  const g = await created();
  const hg = (await dbBooking(g.bookingId)).holdUntil;
  assert.equal((await guestView({ token: g.token, now: new Date(+hg - 1) })).status, 'active');
  await assert.rejects(guestView({ token: g.token, now: hg }), (err) => err.status === 410);
  assert.equal((await dbLink(g.id)).status, 'expired');
});

test('шаг 7 (25): отозванная ссылка — 410; отменённая после подтверждения — 410', async () => {
  const c = await created();
  assert.equal((await adm(admin).post(`/booking-links/${c.id}/revoke`)).status, 200);
  for (const res of [await G(c.token).get(), await G(c.token).guest(GOOD), await G(c.token).submit()]) {
    assert.equal(res.status, 410); assert.equal(res.body.details.status, 'revoked'); assert.equal(res.body.error, 'Ссылка больше не действует — напишите владельцу');
  }
  assert.equal((await request(X.app).get(`/api/link/${c.token}`)).body.kind, 'special', 'страница узнаёт вид и сама покажет «отозвана»');
  const k = await created();
  assert.equal((await G(k.token).guest(GOOD)).status, 200);
  assert.equal((await G(k.token).submit()).body.status, 'completed');
  assert.equal((await adm(owner).post(`/bookings/${k.bookingId}/cancel`, { reason: 'тест' })).status, 200);
  const r = await G(k.token).get();
  assert.equal(r.status, 410); assert.equal(r.body.details.status, 'cancelled');
});

test('шаг 7: подтверждённая — просмотр до дня выезда + 1, потом 410 (раздел 8)', async () => {
  const c = await created();
  assert.equal((await G(c.token).guest(GOOD)).status, 200);
  assert.equal((await G(c.token).submit()).body.status, 'completed');
  const b = await dbBooking(c.bookingId);
  const dayAfter = new Date(+addDays(b.checkOut, 1) + 12 * 3600000);   // полдень дня «выезд + 1» по UTC — ещё можно
  assert.equal((await guestView({ token: c.token, now: dayAfter })).status, 'completed');
  await assert.rejects(guestView({ token: c.token, now: new Date(+addDays(b.checkOut, 2) + 12 * 3600000) }), (err) => err.status === 410);
});

test('шаг 7 (7 конфликт): ранее созданный ремонт закрывает даты в момент «Подтвердить» — 409 понятным текстом, новой брони нет, заявка и ссылка как были; событие link.conflict', async () => {
  const c = await created();
  assert.equal((await G(c.token).guest(GOOD)).status, 200);
  const b = await dbBooking(c.bookingId);
  const rep = await prisma.repairTask.create({ data: { accountId: acc.id, apartmentId: apt.id, title: 'Потоп (шаг 7)', createdAt: new Date(+b.createdAt - 1000), date: b.checkIn, blockDays: 1 } });
  try {
    const count = await prisma.booking.count({ where: { apartmentId: apt.id } });
    const r = await G(c.token).submit();
    assert.equal(r.status, 409); assert.equal(r.body.error, 'Даты стали недоступны — владелец свяжется с вами');
    const again = await G(c.token).submit();
    assert.equal(again.status, 409, 'повтор — тот же ответ');
    assert.equal(await prisma.booking.count({ where: { apartmentId: apt.id } }), count, 'новой брони нет');
    const b2 = await dbBooking(c.bookingId); const l2 = await dbLink(c.id);
    assert.equal(b2.status, 'request'); assert.equal(+b2.checkIn, +b.checkIn); assert.equal(b2.totalKzt, b.totalKzt);
    assert.equal(l2.status, 'active');
    assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 0);
    assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:link.conflict:${c.id}` } }), 1);
    assert.equal((await G(c.token).get()).body.stage, 'ready', 'GET показывает текущее состояние (всё выполнено, не подтверждено)');
  } finally { await prisma.repairTask.delete({ where: { id: rep.id } }); }
  const ok = await G(c.token).submit();
  assert.equal(ok.body.status, 'completed', 'ремонт сняли — «Подтвердить» снова работает');
});

test('шаг 7 (20): одновременные «Подтвердить» в одном процессе — одна бронь, одна подготовка, одинаковые ответы', async () => {
  const c = await created();
  assert.equal((await G(c.token).guest(GOOD)).status, 200);
  const rs = await Promise.all([G(c.token).submit(), G(c.token).submit(), G(c.token).submit()]);
  for (const r of rs) { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'completed'); }
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: c.bookingId } }), 1);
  assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: `event:booking.confirmed:${c.bookingId}` } }), 1);
});

test('шаг 7 (30): страница /link/:token — вид special; задачи мастеру и трансферы не сломаны', async () => {
  const c = await created();
  assert.deepEqual((await request(X.app).get(`/api/link/${c.token}`)).body, { kind: 'special' });
  const page = await request(X.app).get(`/link/${c.token}`);
  assert.equal(page.status, 200); assert.match(page.text, /link-assets\/link\.js/);
  const js = await request(X.app).get('/link-assets/special.js');
  assert.equal(js.status, 200); assert.match(js.text, /showSpecial/);
  const task = await prisma.repairTask.findFirst({ where: { accountId: acc.id, linkToken: { not: null } } });
  if (task) {
    assert.deepEqual((await request(X.app).get(`/api/link/${task.linkToken}`)).body, { kind: 'task' });
    assert.equal((await request(X.app).get(`/api/task-link/${task.linkToken}`)).status === 404, false);
  }
  const job = await prisma.transferJob.findFirst({ where: { accountId: acc.id, linkToken: { not: null }, driverContractorId: { not: null } } });
  if (job) assert.deepEqual((await request(X.app).get(`/api/link/${job.linkToken}`)).body, { kind: 'transfer' });
  assert.equal((await request(X.app).get('/api/link/' + 'n'.repeat(20))).status, 404);
  assert.equal((await request(X.app).get('/api/link/' + 'n'.repeat(43))).status, 404);
});
