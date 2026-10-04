// Точка входа: npm run dev (с автоперезапуском) или npm start.
import { config } from './config.js';
import { prisma } from './db.js';
import { createApp } from './app.js';
import { createEventBus } from './notifications/events.js';
import { createNotificationService } from './notifications/service.js';
import { telegramTransport } from './notifications/transports.js';
import { startScheduler } from './notifications/scheduler.js';
import { createStorage } from './storage/index.js';
import { createPaymentProvider } from './payments/index.js';
import { createFlightTracker } from './flights/index.js';

const events = createEventBus();
const storage = createStorage(config.storage);
const payments = createPaymentProvider(config.payments, { publicUrl: config.publicUrl });
const flights = createFlightTracker(config.flights);   // null без AERODATABOX_API_KEY

let bot = null, transport = null, telegramWebhook = null;
if (config.telegram.token) {
  const { createTelegramBot, telegramWebhookHandler } = await import('./telegram/bot.js');
  bot = createTelegramBot({ token: config.telegram.token, prisma });
  transport = telegramTransport(bot.api);
  if (config.telegram.mode === 'webhook') telegramWebhook = telegramWebhookHandler(bot);
}
createNotificationService({ prisma, transport }).register(events);

const app = createApp({ config, events, storage, payments, telegramWebhook, flights });
if (bot) {
  const { registerTransferButtons } = await import('./telegram/transferButtons.js');
  registerTransferButtons(bot, { prisma, dispatch: app.locals.dispatch, publicUrl: config.publicUrl });   // кнопка «Беру» под предложением трансфера
  const { registerPayoutButtons } = await import('./telegram/payoutButtons.js');
  registerPayoutButtons(bot, { prisma, payouts: app.locals.payouts });   // «Оплатить» под уведомлением «к оплате»
}
const server = app.listen(config.port, async () => {
  console.log(`\n  Сервер запущен: http://localhost:${config.port}`);
  console.log(`  Админка:        http://localhost:${config.port}/admin/`);
  console.log(`  Проверка:       http://localhost:${config.port}/api/health`);
  console.log(`  Telegram-бот:   ${bot ? 'включён (' + config.telegram.mode + ')' : 'выключен — уведомления пишутся в консоль и журнал'}`);
  console.log(`  Онлайн-оплата:  ${payments ? payments.name : 'выключена'}`);
  console.log(`  Фото:           ${storage.driver === 's3' ? 'S3-хранилище' : 'папка uploads/'}`);
  console.log(`  Рейсы:          ${flights ? 'слежение через ' + flights.name : 'без слежения (время подачи меняют вручную)'}`);
  console.log(`  Приложение команды: http://localhost:${config.port}/app/\n`);
  if (bot) {
    const { startTelegram } = await import('./telegram/bot.js');
    startTelegram({ bot, mode: config.telegram.mode, publicUrl: config.publicUrl }).catch(e => console.error('[telegram] не удалось запустить:', e.message));
  }
});
const stopScheduler = startScheduler({ prisma, events, dispatch: app.locals.dispatch, payouts: app.locals.payouts });

const shutdown = async () => {
  stopScheduler(); if (bot && config.telegram.mode === 'polling') await bot.stop().catch(() => {});
  server.close(); await prisma.$disconnect(); process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
