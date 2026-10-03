// Кнопка «Беру» под сообщением о новом трансфере (callback_data = tj:acc:<id заказа>).
// Нажатие делает то же атомарное «Беру», что и приложение: первый получает заказ, остальным — «Уже взял другой водитель».
// Кто нажал — узнаём по Telegram: User.telegramId (привязка по ссылке-приглашению из админки: t.me/<бот>?start=i_<код>).
import { route } from '../services/transferJobs.js';

const e = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Логика без grammY — её и тестируем. Возвращает { ok, taken, text (всплывающий ответ), details (сообщение водителю) } */
export async function handleTransferAccept({ prisma, dispatch, telegramUserId, jobId, publicUrl = '' }) {
  const user = await prisma.user.findUnique({ where: { telegramId: String(telegramUserId) } });
  if (!user) return { ok: false, text: 'Этот Telegram не привязан к сотруднику. Попросите ссылку-приглашение в админке: «Команда» → «Ссылка для Telegram».' };
  const job = await prisma.transferJob.findUnique({ where: { id: jobId }, select: { accountId: true } });
  if (!job) return { ok: false, taken: true, text: 'Заказ не найден' };
  try {
    const j = await dispatch.accept({ accountId: job.accountId, jobId, user });
    const t = j.transfer, r = route(j), d = new Date(t.date);
    const details = `✅ <b>Заказ ваш</b>\n${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${t.time}${t.flight ? ` · рейс ${e(t.flight)}` : ''}\n📍 ${e(r.from)} → ${e(r.to)}` +
      `${t.guestPhone ? `\n📞 Гость: ${e(t.guestPhone)}` : ''}${t.sign || t.guestName ? `\n🪧 Табличка: ${e(t.sign || t.guestName)}` : ''}` +
      `${['owner', 'business'].includes(j.payoutRule) ? '\n💵 Без выплаты — вся сумма бизнесу' : j.payoutKzt != null ? `\n💵 Вам: ${String(j.payoutKzt).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸` : ''}\n\nШаги «выехал → на месте → гость в машине → завершить» — в приложении команды: ${publicUrl ? `${publicUrl}/app/` : '/app/'}`;
    return { ok: true, text: 'Заказ ваш ✅', details };
  } catch (err) {
    if (err.status === 409) return { ok: false, taken: true, text: err.message === 'Заказ отменён' ? 'Заказ отменён' : 'Уже взял другой водитель' };
    if (err.status === 403) return { ok: false, text: 'Вы не в списке водителей этого бизнеса' };
    if (err.status === 404) return { ok: false, taken: true, text: 'Заказ не найден' };
    throw err;
  }
}

export function registerTransferButtons(bot, { prisma, dispatch, publicUrl = '', logger = console }) {
  bot.callbackQuery(/^tj:acc:([A-Za-z0-9_-]{8,40})$/, async (ctx) => {
    const r = await handleTransferAccept({ prisma, dispatch, telegramUserId: ctx.from.id, jobId: ctx.match[1], publicUrl });
    await ctx.answerCallbackQuery({ text: r.text, show_alert: !r.ok });
    if (r.ok || r.taken) {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});   // кнопка больше не нужна
      if (r.details) await ctx.reply(r.details, { parse_mode: 'HTML' }).catch(err => logger.warn('[telegram] ответ водителю:', err.message));
    }
  });
}
