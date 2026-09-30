// Telegram-бот на grammY. Запускается, только если задан TELEGRAM_BOT_TOKEN.
// Режим polling — бот сам спрашивает Telegram о новых сообщениях (просто, работает на любом компьютере).
// Режим webhook — Telegram присылает сообщения на PUBLIC_URL/api/telegram/webhook (для хостинга).
import crypto from 'node:crypto';
import { Bot, webhookCallback } from 'grammy';
import { linkByStartPayload, unlinkChat } from './linking.js';

export function createTelegramBot({ token, prisma, logger = console }) {
  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    const r = await linkByStartPayload({ prisma, payload: ctx.match, chatId: ctx.chat.id, languageCode: ctx.from?.language_code });
    if (r.ok) logger.log(`[telegram] привязан чат ${ctx.chat.id} (${r.kind})`);
    await ctx.reply(r.text);
  });
  bot.command('stop', async (ctx) => {
    const n = await unlinkChat({ prisma, chatId: ctx.chat.id });
    await ctx.reply(n ? 'Уведомления отключены. Чтобы включить снова — откройте ссылку ещё раз.' : 'Этот чат не был подключён.');
  });
  bot.command('help', (ctx) => ctx.reply('Бот присылает уведомления о бронях, заездах, трансферах и задачах команды.\n/stop — отключить уведомления'));
  bot.catch((err) => logger.error('[telegram]', err.error?.message || err.message));
  return bot;
}

/** Секрет вебхука (Telegram присылает его в заголовке X-Telegram-Bot-Api-Secret-Token) */
export const webhookSecret = (token) => crypto.createHash('sha256').update('tg-webhook:' + token).digest('hex').slice(0, 32);
export const telegramWebhookHandler = (bot) => webhookCallback(bot, 'express', { secretToken: webhookSecret(bot.token) });

export async function startTelegram({ bot, mode, publicUrl, logger = console }) {
  if (mode === 'webhook') {
    // маршрут POST /api/telegram/webhook подключается в app.js
    await bot.api.setWebhook(`${publicUrl}/api/telegram/webhook`, { secret_token: webhookSecret(bot.token) });
    logger.log('[telegram] webhook установлен: ' + publicUrl + '/api/telegram/webhook');
  } else {
    await bot.api.deleteWebhook().catch(() => {});
    bot.start({ onStart: (me) => logger.log(`[telegram] бот @${me.username} запущен (polling)`) });
  }
}
