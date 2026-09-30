import crypto from 'node:crypto';
/** Случайный токен для ссылок (без спецсимволов, подходит для Telegram deep link: A-Z a-z 0-9 _ -) */
export const randomToken = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');
/** Короткий код приглашения из цифр и букв без похожих символов */
export const inviteCode = () => Array.from(crypto.randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
/** Сравнение строк без утечки по времени */
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
