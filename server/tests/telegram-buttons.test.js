// Кнопка «Беру» в Telegram: grammY с подменённым API (без сети), то же атомарное «Беру», что и в приложении.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, freeDates, guestBooking, guestTransfer } from './helpers.js';
import { createTelegramBot } from '../src/telegram/bot.js';
import { registerTransferButtons, handleTransferAccept } from '../src/telegram/transferButtons.js';
import { telegramTransport } from '../src/notifications/transports.js';

const sent = [];
const transport = { name: 'mock', async send(chatId, text, opts) { sent.push({ chatId, text, opts }); } };
const { app, events } = makeApp({ transport });
const BOT_INFO = { id: 42, is_bot: true, first_name: 'Сутки', username: 'sutki_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
let acc, apt, owner, ruslan, kanat, bot, calls = [];
let start = 600, upd = 1;
const TG = { ruslan: '700000101', kanat: '700000102', stranger: '700000199' };

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false } });
  [owner, ruslan, kanat] = await Promise.all(['azamat@astanastay.example', 'ruslan@astanastay.example', 'kanat@astanastay.example'].map(e => login(app, e)));
  await prisma.user.update({ where: { id: ruslan.me.user.id }, data: { telegramId: TG.ruslan } });
  await prisma.user.update({ where: { id: kanat.me.user.id }, data: { telegramId: TG.kanat } });
  bot = createTelegramBot({ token: '123456:TEST-TOKEN', prisma, botInfo: BOT_INFO, logger: { log() {}, warn() {}, error() {} } });
  bot.api.config.use(async (_prev, method, payload) => { calls.push({ method, payload }); return { ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } : true }; });
  registerTransferButtons(bot, { prisma, dispatch: app.locals.dispatch, logger: { warn() {} } });
});
after(async () => {
  await prisma.user.updateMany({ where: { telegramId: { in: Object.values(TG) } }, data: { telegramId: null } });
  await prisma.$disconnect();
});

async function offeredJob() {
  const dates = await freeDates(acc.id, apt.id, 2, start); start += 5;
  const b = await request(app).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 1, name: 'Ким Ён', phone: '+7 702 111 22 33', paymentMethod: 'card' });
  const t = await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '09:10', flight: 'KC 920' });
  const booking = await guestBooking(b.body.token);
  await request(app).post(`/api/admin/bookings/${booking.id}/confirm`).set(owner.auth);
  await events.idle();
  return prisma.transferJob.findUnique({ where: { transferId: (await guestTransfer(t.body.ref)).id } });
}
const press = (tgId, jobId) => bot.handleUpdate({
  update_id: upd++,
  callback_query: { id: 'cb' + upd, from: { id: Number(tgId), is_bot: false, first_name: 'Водитель' }, chat_instance: 'ci', data: `tj:acc:${jobId}`,
    message: { message_id: 77, date: 0, chat: { id: Number(tgId), type: 'private', first_name: 'Водитель' }, text: 'Новый заказ' } },
});
const answers = () => calls.filter(c => c.method === 'answerCallbackQuery').map(c => c.payload);

test('предложение уходит в Telegram с кнопкой «Беру» (callback tj:acc:<id>), без номера квартиры', async () => {
  sent.length = 0;
  const job = await offeredJob();
  const toRuslan = sent.find(s => s.chatId === TG.ruslan && s.text.includes('Новый заказ'));
  assert.ok(toRuslan, 'Руслан получил предложение');
  assert.deepEqual(toRuslan.opts.buttons, [[{ text: '✋ Беру', data: `tj:acc:${job.id}` }]]);
  assert.doesNotMatch(toRuslan.text, new RegExp(`кв\\.?\\s*${apt.code}\\b`));
  // транспорт превращает кнопки в inline_keyboard Telegram
  const api = { last: null, async sendMessage(chatId, text, extra) { this.last = { chatId, text, extra }; } };
  await telegramTransport(api).send('1', 'x', { buttons: toRuslan.opts.buttons });
  assert.deepEqual(api.last.extra.reply_markup, { inline_keyboard: [[{ text: '✋ Беру', callback_data: `tj:acc:${job.id}` }]] });
});

test('два водителя жмут «Беру» одновременно — заказ получает один, второму «Уже взял другой водитель»', async () => {
  const job = await offeredJob();
  calls = [];
  await Promise.all([press(TG.ruslan, job.id), press(TG.kanat, job.id)]);
  const a = answers();
  assert.equal(a.length, 2);
  assert.equal(a.filter(x => x.text === 'Заказ ваш ✅').length, 1, JSON.stringify(a));
  assert.equal(a.filter(x => x.text === 'Уже взял другой водитель').length, 1, JSON.stringify(a));
  const db = await prisma.transferJob.findUnique({ where: { id: job.id } });
  assert.equal(db.status, 'ACCEPTED'); assert.ok([ruslan.me.user.id, kanat.me.user.id].includes(db.driverUserId));
  // победителю — сообщение с телефоном гостя и номером квартиры; кнопки убраны
  const details = calls.find(c => c.method === 'sendMessage' && c.payload.text.includes('Заказ ваш'));
  assert.ok(details.payload.text.includes('702 111 22 33')); assert.ok(details.payload.text.includes(`кв. ${apt.code}`));
  assert.ok(calls.some(c => c.method === 'editMessageReplyMarkup'));
  // журнал заказа: принял через Telegram — тот же «accepted»
  assert.equal((await prisma.transferEvent.count({ where: { jobId: job.id, type: 'accepted' } })), 1);
});

test('чужой Telegram или не водитель — «Беру» не срабатывает', async () => {
  const job = await offeredJob();
  calls = [];
  await press(TG.stranger, job.id);
  assert.match(answers()[0].text, /не привязан/); assert.equal(answers()[0].show_alert, true);
  // мастер с привязанным Telegram, но без «Водит»
  const master = await prisma.user.findFirst({ where: { email: 'marat@astanastay.example' } });
  await prisma.user.update({ where: { id: master.id }, data: { telegramId: '700000150' } });
  const r = await handleTransferAccept({ prisma, dispatch: app.locals.dispatch, telegramUserId: '700000150', jobId: job.id });
  assert.equal(r.ok, false); assert.match(r.text, /не в списке водителей/);
  await prisma.user.update({ where: { id: master.id }, data: { telegramId: null } });
  assert.equal((await prisma.transferJob.findUnique({ where: { id: job.id } })).status, 'OFFERED');
});
