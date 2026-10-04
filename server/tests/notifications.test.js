// Заявка → уведомления; сервис уведомлений с подменным ботом; привязка Telegram; напоминания.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, freeDates } from './helpers.js';
import { telegramTransport } from '../src/notifications/transports.js';
import { linkByStartPayload } from '../src/telegram/linking.js';
import { createTelegramBot } from '../src/telegram/bot.js';
import { runReminders } from '../src/notifications/scheduler.js';
import { render } from '../src/notifications/templates.js';
import { EVENTS } from '../src/notifications/service.js';

// «Бот» без интернета: вместо Telegram API — массив отправленных сообщений
const sent = [];
const mockApi = { sendMessage: async (chatId, text, opts) => { if (String(chatId) === 'broken') throw new Error('Forbidden: bot was blocked by the user'); sent.push({ chatId: String(chatId), text, opts }); } };
const withBot = makeApp({ transport: telegramTransport(mockApi) });
const noBot = makeApp();
let acc, apt, owner, admin, master;

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false }, orderBy: { sortOrder: 'asc' } });
  owner = await login(noBot.app, 'azamat@astanastay.example');
  admin = await login(noBot.app, 'alina@astanastay.example');
  master = await login(noBot.app, 'marat@astanastay.example');
});
after(() => prisma.$disconnect());

const bookingBody = async (extra = {}) => ({ apartmentId: apt.id, ...(await freeDates(acc.id, apt.id)), guests: 2, name: 'Тест Гостев', phone: '+7 700 123 45 67', paymentMethod: 'cash', ...extra });

test('без бота: заявка с сайта создаётся, уведомление владельцу и админу — в журнал', async () => {
  const r = await request(noBot.app).post('/api/public/astana-stay/bookings').send(await bookingBody({ currency: 'USD', comment: 'Поздний заезд' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'request'); assert.ok(r.body.token); assert.ok(r.body.amountShown > 0 && r.body.amountShown < r.body.totalKzt);
  await noBot.events.idle();
  const b = await prisma.booking.findUnique({ where: { token: r.body.token } });
  const logs = await prisma.notificationLog.findMany({ where: { accountId: acc.id, event: 'booking.requested', text: { contains: `№${b.number}` } } });
  assert.deepEqual(logs.map(l => l.recipientType).sort(), ['admin', 'owner']);
  assert.ok(logs.every(l => l.status === 'logged' && l.channel === 'console'));
  assert.match(logs[0].text, /Новая заявка/); assert.match(logs[0].text, /Поздний заезд/);
  // те же даты второй раз — 409
  const dup = await request(noBot.app).post('/api/public/astana-stay/bookings').send({ ...(await bookingBody()), checkIn: r.body.checkIn, checkOut: r.body.checkOut });
  assert.equal(dup.status, 409);
});

test('проверка данных заявки', async () => {
  const base = await bookingBody();
  assert.equal((await request(noBot.app).post('/api/public/astana-stay/bookings').send({ ...base, phone: 'abc' })).status, 400);
  assert.equal((await request(noBot.app).post('/api/public/astana-stay/bookings').send({ ...base, guests: 99 })).status, 400);
  assert.equal((await request(noBot.app).post('/api/public/astana-stay/bookings').send({ ...base, pets: true })).status, 400);
  assert.equal((await request(noBot.app).post('/api/public/astana-stay/bookings').send({ ...base, checkIn: '2020-01-01', checkOut: '2020-01-03' })).status, 400);
  assert.equal((await request(noBot.app).post('/api/public/nope/bookings').send(base)).status, 404);
});

test('с ботом: владелец с Telegram получает сообщение, админ без Telegram — в журнал', async () => {
  await prisma.user.update({ where: { id: owner.me.user.id }, data: { telegramId: '111' } });
  sent.length = 0;
  const r = await request(withBot.app).post('/api/public/astana-stay/bookings').send(await bookingBody({ lang: 'en', name: 'John Smith' }));
  assert.equal(r.status, 201);
  await withBot.events.idle();
  assert.equal(sent.length, 1); assert.equal(sent[0].chatId, '111');
  assert.match(sent[0].text, /Новая заявка №\d+/); assert.match(sent[0].text, /John Smith/);
  assert.equal(sent[0].opts.parse_mode, 'HTML');
  const b = await prisma.booking.findUnique({ where: { token: r.body.token } });
  const logs = await prisma.notificationLog.findMany({ where: { event: 'booking.requested', text: { contains: `№${b.number}` } } });
  assert.equal(logs.find(l => l.recipientType === 'owner').status, 'sent');
  assert.equal(logs.find(l => l.recipientType === 'admin').status, 'logged');
});

test('ошибка Telegram не ломает заявку (статус failed в журнале)', async () => {
  await prisma.user.update({ where: { id: owner.me.user.id }, data: { telegramId: 'broken' } });
  const r = await request(withBot.app).post('/api/public/astana-stay/bookings').send(await bookingBody());
  assert.equal(r.status, 201);
  await withBot.events.idle();
  const b = await prisma.booking.findUnique({ where: { token: r.body.token } });
  const log = await prisma.notificationLog.findFirst({ where: { recipientType: 'owner', event: 'booking.requested', text: { contains: `№${b.number}` } } });
  assert.equal(log.status, 'failed'); assert.match(log.error, /blocked/);
  await prisma.user.update({ where: { id: owner.me.user.id }, data: { telegramId: '111' } });
});

test('гость привязывает Telegram по ссылке из брони и получает подтверждение на своём языке', async () => {
  const r = await request(withBot.app).post('/api/public/astana-stay/bookings').send(await bookingBody({ lang: 'en', name: 'Anna Lee' }));
  const link = await linkByStartPayload({ prisma, payload: 'b_' + r.body.token, chatId: 555, languageCode: 'en' });
  assert.ok(link.ok); assert.match(link.text, /linked to booking #\d+/);
  const b = await prisma.booking.findUnique({ where: { token: r.body.token } });
  sent.length = 0;
  const c = await request(withBot.app).post(`/api/admin/bookings/${b.id}/confirm`).set(admin.auth);
  assert.equal(c.status, 200); assert.equal(c.body.status, 'confirmed');
  await withBot.events.idle();
  const g = sent.find(s => s.chatId === '555');
  assert.ok(g, 'гость получил сообщение'); assert.match(g.text, /Booking #\d+ is confirmed/);
  assert.ok(await prisma.cleaningTask.findFirst({ where: { bookingId: b.id } }), 'создана уборка в день выезда');
  const bad = await linkByStartPayload({ prisma, payload: 'b_wrongtoken', chatId: 1 });
  assert.equal(bad.ok, false);
});

test('гость без Telegram — подтверждение помечается «пропущено»', async () => {
  const r = await request(noBot.app).post('/api/public/astana-stay/bookings').send(await bookingBody());
  const b = await prisma.booking.findUnique({ where: { token: r.body.token } });
  await request(noBot.app).post(`/api/admin/bookings/${b.id}/confirm`).set(owner.auth);
  await noBot.events.idle();
  const log = await prisma.notificationLog.findFirst({ where: { event: 'booking.confirmed', recipientId: b.guestId } });
  assert.equal(log.status, 'skipped');
});

test('сотрудник привязывает Telegram по коду приглашения (одноразовому)', async () => {
  const inv = await request(noBot.app).post(`/api/admin/team/${master.me.user.id}/telegram-invite`).set(admin.auth);
  assert.equal(inv.status, 201); assert.match(inv.body.payload, /^i_[A-Z2-9]{8}$/);
  const r = await linkByStartPayload({ prisma, payload: inv.body.payload, chatId: 777, languageCode: 'ru' });
  assert.ok(r.ok); assert.match(r.text, /Telegram подключён/);
  assert.equal((await prisma.user.findUnique({ where: { id: master.me.user.id } })).telegramId, '777');
  assert.equal((await linkByStartPayload({ prisma, payload: inv.body.payload, chatId: 778 })).ok, false, 'код одноразовый');
});

test('grammY-бот (подменный API): /start b_<token> привязывает чат и отвечает', async () => {
  const r = await request(noBot.app).post('/api/public/astana-stay/bookings').send(await bookingBody({ name: 'Бот Тестов' }));
  const bot = createTelegramBot({ token: '123456:TEST', prisma, logger: { log() {}, error() {} } });
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'astana_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
  const calls = [];
  bot.api.config.use(async (_prev, method, payload) => { calls.push({ method, payload }); return { ok: true, result: { message_id: 1, date: 0, chat: { id: payload.chat_id, type: 'private' } } }; });
  await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 4242, type: 'private' }, from: { id: 4242, is_bot: false, first_name: 'Б', language_code: 'ru' }, text: `/start b_${r.body.token}`, entities: [{ type: 'bot_command', offset: 0, length: 6 }] } });
  assert.equal(calls[0].method, 'sendMessage'); assert.match(calls[0].payload.text, /Чат привязан к брони №\d+/);
  const g = await prisma.guest.findFirst({ where: { bookings: { some: { token: r.body.token } } } });
  assert.equal(g.telegramChatId, '4242');
});

test('трансфер, отчёт мастера и смета — уведомления владельцу', async () => {
  sent.length = 0;
  const t = await request(withBot.app).post('/api/public/astana-stay/transfers').send({ direction: 'in', place: 'airport', date: '2030-05-01', time: '23:40', flight: 'KC 852', pax: 2, childSeats: 1, name: 'Трансфер Тестов', phone: '+7 701 000 00 00' });
  assert.equal(t.status, 201); assert.equal(t.body.priceKzt, 8000 + 2000 + 1500);
  const task = (await request(withBot.app).post('/api/admin/repairs').set(owner.auth).send({ apartmentId: apt.id, title: 'Течёт бачок', type: 'plumb', assigneeId: master.me.user.id })).body;
  assert.equal(task.status, 'NEW');
  const est = await request(withBot.app).post(`/api/staff/repairs/${task.id}/estimate`).set(master.auth).send({ method: 'REMOTE', labourKzt: 6000, materialsIncluded: true, materialsKzt: 3500, items: 'Арматура' });
  assert.equal(est.status, 201);
  const estId = est.body.estimates.at(-1).id;
  await withBot.events.idle();
  const toOwner = sent.filter(s => s.chatId === '111').map(s => s.text);
  assert.ok(toOwner.some(x => /Заказ трансфера/.test(x) && /KC 852/.test(x)));
  assert.ok(toOwner.some(x => /Смета ждёт одобрения/.test(x) && /9 500 ₸/.test(x)));
  sent.length = 0;
  const ap = await request(withBot.app).post(`/api/admin/estimates/${estId}/approve`).set(owner.auth);
  assert.equal(ap.status, 200); assert.equal(ap.body.status, 'APPROVED');
  assert.equal((await request(withBot.app).post(`/api/admin/estimates/${estId}/approve`).set(owner.auth)).status, 409);
  await withBot.events.idle();
  assert.ok(sent.some(s => s.chatId === '777' && /Смета одобрена/.test(s.text)), 'мастер (Telegram привязан выше) получил решение');
  assert.equal((await request(withBot.app).post(`/api/staff/repairs/${task.id}/start`).set(master.auth)).status, 200);
  const done = await request(withBot.app).post(`/api/staff/repairs/${task.id}/complete`).set(master.auth).send({ finalCostKzt: 9500, report: 'Заменил арматуру, протечки нет' });
  assert.equal(done.body.status, 'DONE');
  await withBot.events.idle();
  assert.ok(sent.some(s => s.chatId === '111' && /Заявка:/.test(s.text) && /протечки нет/.test(s.text)));
});

test('клининг: отчёт об уборке → уведомление', async () => {
  const cl = await login(noBot.app, 'aigerim@astanastay.example');
  const tasks = (await request(noBot.app).get('/api/staff/tasks').set(cl.auth)).body.cleaning;
  const t = tasks.find(x => x.status !== 'done') || tasks[0];
  const r = await request(noBot.app).post(`/api/staff/cleaning/${t.id}/status`).set(cl.auth).send({ status: 'done', report: 'Всё чисто, забыли зарядку' });
  assert.equal(r.status, 200);
  await noBot.events.idle();
  const log = await prisma.notificationLog.findFirst({ where: { event: 'cleaning.reported', text: { contains: 'забыли зарядку' } } });
  assert.ok(log);
});

test('напоминания о заезде: команде и гостю, без повторов', async () => {
  const n1 = await runReminders({ prisma, events: withBot.events });
  await withBot.events.idle();
  assert.ok(n1 > 0);
  const c1 = await prisma.notificationLog.count({ where: { event: { in: ['checkin.upcoming', 'guest.checkin_instructions'] } } });
  await runReminders({ prisma, events: withBot.events }); await withBot.events.idle();
  const c2 = await prisma.notificationLog.count({ where: { event: { in: ['checkin.upcoming', 'guest.checkin_instructions'] } } });
  assert.equal(c1, c2, 'повторный запуск не дублирует');
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'checkin.upcoming', recipientType: 'owner' } }));
});

test('шаблоны есть на русском и английском для всех событий', () => {
  const d = { booking: { number: 1, source: 'site', checkIn: new Date(), checkOut: new Date(), checkInTime: '14:00', checkOutTime: '12:00', guestsCount: 2, totalKzt: 1000, paymentStatus: 'paid' }, apartment: { title: 'Кв', address: 'Адрес', lockCode: '1234' }, guest: { name: 'Г' }, nights: 1,
    transfer: { direction: 'in', place: 'airport', date: new Date(), time: '10:00', pax: 1, priceKzt: 8000, sign: 'Г', guestPhone: '+7' }, job: { driverName: 'В', payoutKzt: 1, freeWaitMin: 60 }, trip: { from: 'А', to: 'Б' }, task: { title: 'Т', status: 'DONE', occupancy: 'EMPTY', accessInstructions: 'Ключ у консьержа', finalCostKzt: 5 }, estimate: { workKzt: 1, partsKzt: 2, method: 'PHOTOS', status: 'approved', materialsIncluded: true }, extra: { amountKzt: 3, description: 'Д', reason: 'П', status: 'APPROVED' }, payment: { amountKzt: 1, provider: 'x' }, when: 'today', problem: { text: 'Течёт кран', byName: 'Гульнара', photoIds: [] }, payout: { kind: 'cleaning', name: 'Гульнара', amountKzt: 5000, title: 'Подготовка кв. 1' }, hours: 3, by: 'М', reason: 'Далеко' };
  for (const ev of EVENTS) {
    assert.ok(render(ev, 'ru', d).length > 10, ev); assert.ok(render(ev, 'en', d).length > 10, ev);
    assert.notEqual(render(ev, 'ru', d), render(ev, 'en', d), ev);
  }
  assert.match(render('booking.requested', 'ru', { ...d, guest: { name: '<b>x</b>' } }), /&lt;b&gt;x/, 'HTML экранируется');
});
