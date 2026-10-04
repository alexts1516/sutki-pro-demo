// Кнопки «Оплатить» под уведомлением «… закончила подготовку — к оплате 5 000 ₸» (callback_data = po:cash|transfer:<id выплаты>).
// Нажать может только владелец этого бизнеса (узнаём по User.telegramId).
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export async function handlePayoutButton({ prisma, payouts, telegramUserId, method, payoutId }) {
  const user = await prisma.user.findUnique({ where: { telegramId: String(telegramUserId) } });
  if (!user) return { ok: false, text: 'Этот Telegram не привязан к аккаунту' };
  const p = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!p) return { ok: false, done: true, text: 'Выплата не найдена' };
  const m = await prisma.membership.findFirst({ where: { accountId: p.accountId, userId: user.id, role: 'owner', active: true } });
  if (!m) return { ok: false, text: 'Выплаты отмечает владелец' };
  if (p.status === 'PAID') return { ok: true, done: true, text: 'Уже выплачено' };
  try {
    await payouts.pay({ accountId: p.accountId, id: p.id, actor: { type: 'owner', id: user.id, name: user.name }, method });
  } catch (err) { if (err.status === 409 || err.status === 400) return { ok: false, text: err.message }; throw err; }
  return { ok: true, done: true, text: `Выплачено ${method === 'cash' ? 'наличными' : 'переводом'} ✅`, details: `✅ Выплачено: ${p.name || ''} — ${fmt(p.amountKzt)} ₸ (${method === 'cash' ? 'наличными' : 'переводом'})` };
}

export const payoutButtons = (id) => [[{ text: '💵 Оплатить наличными', data: `po:cash:${id}` }, { text: '💳 Оплатить переводом', data: `po:transfer:${id}` }]];

export function registerPayoutButtons(bot, { prisma, payouts, logger = console }) {
  bot.callbackQuery(/^po:(cash|transfer):([A-Za-z0-9_-]{8,40})$/, async (ctx) => {
    const r = await handlePayoutButton({ prisma, payouts, telegramUserId: ctx.from.id, method: ctx.match[1], payoutId: ctx.match[2] });
    await ctx.answerCallbackQuery({ text: r.text, show_alert: !r.ok });
    if (r.done) await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (r.details) await ctx.reply(r.details).catch(err => logger.warn('[telegram] выплата:', err.message));
  });
}
