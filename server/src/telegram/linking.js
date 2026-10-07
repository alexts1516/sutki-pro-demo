import { digest } from '../lib/publicDtos.js';
// Привязка Telegram по ссылке t.me/<бот>?start=<payload>
//   b_<token>  — гость из подтверждения брони (token есть у каждой брони)
//   i_<code>   — сотрудник или владелец по одноразовому коду из админки («Команда» → «Подключить Telegram»)
// Логика отдельно от grammY, чтобы её можно было тестировать без Telegram.
import { render } from '../notifications/templates.js';

export function deepLink(botUsername, payload) {
  return botUsername ? `https://t.me/${botUsername}?start=${payload}` : null;
}

export async function linkByStartPayload({ prisma, payload, chatId, languageCode }) {
  const lang = String(languageCode || '').startsWith('ru') || !languageCode ? 'ru' : 'en';
  const p = String(payload || '').trim();
  chatId = String(chatId);

  if (p.startsWith('b_')) {
    const booking = await prisma.booking.findFirst({ where: { OR:[{guestAccessHash:digest(p.slice(2))},{token:p.slice(2)}] }, include: { guest: true, apartment: true, account: true } });
    if (!booking || !booking.guest) return { ok: false, kind: 'guest', text: lang === 'en' ? 'Booking link is invalid or expired.' : 'Ссылка на бронь недействительна.' };
    await prisma.guest.update({ where: { id: booking.guest.id }, data: { telegramChatId: chatId, locale: booking.guest.locale || lang } });
    const L = booking.guest.locale || lang;
    const text = L === 'en'
      ? `👋 Hello, ${booking.guest.name}! This chat is now linked to booking #${booking.number} (${booking.apartment.titleEn || booking.apartment.title}). We will send confirmation, check-in instructions and transfer details here.`
      : `👋 Здравствуйте, ${booking.guest.name}! Чат привязан к брони №${booking.number} (${booking.apartment.title}). Сюда придут подтверждение, инструкция по заселению и детали трансфера.`;
    return { ok: true, kind: 'guest', bookingId: booking.id, accountId: booking.accountId, text };
  }

  if (p.startsWith('i_')) {
    const inv = await prisma.invite.findUnique({ where: { code: p.slice(2) }, include: { user: true, account: true } });
    if (!inv || inv.usedAt || inv.expiresAt < new Date()) return { ok: false, kind: 'staff', text: lang === 'en' ? 'Invite code is invalid or expired. Ask the owner for a new one.' : 'Код приглашения недействителен или устарел. Попросите новый у владельца.' };
    // один Telegram — один пользователь: снимаем привязку с другого пользователя, если была
    await prisma.$transaction([
      prisma.user.updateMany({ where: { telegramId: chatId, NOT: { id: inv.userId } }, data: { telegramId: null } }),
      prisma.user.update({ where: { id: inv.userId }, data: { telegramId: chatId } }),
      prisma.invite.update({ where: { id: inv.id }, data: { usedAt: new Date() } }),
    ]);
    return { ok: true, kind: 'staff', userId: inv.userId, accountId: inv.accountId, text: render('telegram.linked', inv.user.locale, { accountName: inv.account.name }) };
  }

  return {
    ok: false, kind: 'unknown',
    text: lang === 'en'
      ? 'Hi! Open the link from your booking confirmation to receive updates here. Staff: use the invite link from the admin panel.'
      : 'Здравствуйте! Чтобы получать уведомления, откройте ссылку из подтверждения брони. Сотрудникам — ссылку-приглашение из админки.',
  };
}

/** /stop — отписаться: гость или сотрудник перестаёт получать сообщения в этот чат */
export async function unlinkChat({ prisma, chatId }) {
  chatId = String(chatId);
  const g = await prisma.guest.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
  const u = await prisma.user.updateMany({ where: { telegramId: chatId }, data: { telegramId: null } });
  return g.count + u.count;
}
