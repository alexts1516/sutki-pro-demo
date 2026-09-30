// Вход по JWT: токен лежит в httpOnly-cookie «sp_token» (для админки в браузере)
// или приходит в заголовке Authorization: Bearer <token> (для мобильных приложений и тестов).
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError, forbidden } from '../lib/errors.js';

export const COOKIE = 'sp_token';
const TTL_DAYS = 14;

export function signToken(userId, accountId) {
  return jwt.sign({ sub: userId, acc: accountId }, config.jwtSecret, { expiresIn: `${TTL_DAYS}d` });
}
export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https://'),
    maxAge: TTL_DAYS * 86400000, path: '/',
  });
}

/** Проверяет токен и загружает участника аккаунта. Роль берётся из базы при каждом запросе —
 *  если владелец отключил сотрудника, доступ пропадает сразу. */
export async function authenticate(req, _res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'Нужно войти');
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, 'Сессия истекла, войдите снова'); }
  const m = await prisma.membership.findUnique({
    where: { userId_accountId: { userId: payload.sub, accountId: payload.acc } },
    include: { user: true, account: true },
  });
  if (!m || !m.active) throw new HttpError(401, 'Доступ отключён');
  if (m.account.status === 'suspended' || m.account.status === 'cancelled') throw new HttpError(403, 'Аккаунт приостановлен');
  req.user = m.user; req.account = m.account; req.accountId = m.accountId; req.role = m.role; req.membership = m;
  next();
}

/** requireRole('owner','admin') — пропускает только эти роли */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.role)) throw forbidden();
  next();
};
