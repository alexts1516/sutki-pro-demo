// Вход и выход. POST /api/auth/login { login: email или телефон, password, accountId? }
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hasLinkPriceRight } from '../services/linkPrice.js';
import { checkPassword } from '../auth/password.js';
import { authenticate, signToken, setAuthCookie, COOKIE } from '../auth/middleware.js';
import { HttpError, parse } from '../lib/errors.js';
import { createLimiter, tooMany } from '../lib/rateLimit.js';
import { config as defaultConfig } from '../config.js';

const LoginSchema = z.object({ login: z.string().min(3).max(120), password: z.string().min(1).max(200), accountId: z.string().max(40).optional() });

const accountsOf = (userId) => prisma.membership.findMany({ where: { userId, active: true }, include: { account: { select: { id: true, name: true, slug: true, plan: true, status: true } } } });
const me = (user, m, list) => ({
  user: { id: user.id, name: user.name, email: user.email, phone: user.phone, locale: user.locale, telegramLinked: !!user.telegramId },
  account: m.account ? { id: m.account.id, name: m.account.name, slug: m.account.slug, plan: m.account.plan, status: m.account.status, trialEndsAt: m.account.trialEndsAt } : undefined,
  role: m.role, canSetLinkPrice: hasLinkPriceRight(m),
  accounts: list.map(x => ({ id: x.account.id, name: x.account.name, role: x.role })),
});

export default function authRouter({ config = defaultConfig } = {}) {
const r = Router();
// Защита от подбора пароля: неудачные попытки считаются на пару «логин + IP» и на IP целиком
const rl = config.rateLimit || { loginMax: 5, loginWindowMin: 15, ipMax: 30 };
const perLogin = createLimiter({ max: rl.loginMax, windowMs: rl.loginWindowMin * 60000 });
const perIp = createLimiter({ max: rl.ipMax, windowMs: rl.loginWindowMin * 60000 });

r.post('/login', async (req, res) => {
  const { login, password, accountId } = parse(LoginSchema, req.body);
  const l = login.trim().toLowerCase();
  const ip = req.ip || 'unknown', key = `${ip}|${l}`;
  const wait = perLogin.blockedFor(key) || perIp.blockedFor(ip);
  if (wait) throw tooMany(res, wait, 'Слишком много попыток входа.');
  const phone = l.replace(/[^\d+]/g, '');
  const user = await prisma.user.findFirst({ where: { OR: [{ email: l }, ...(phone.length >= 6 ? [{ phone }] : [])] } });
  if (!user || !(await checkPassword(password, user.passwordHash))) {
    perLogin.hit(key); perIp.hit(ip);
    throw new HttpError(401, 'Неверный логин или пароль');
  }
  perLogin.reset(key);
  const list = await accountsOf(user.id);
  if (!list.length) throw new HttpError(403, 'У пользователя нет доступа ни к одному аккаунту');
  const m = (accountId && list.find(x => x.accountId === accountId)) || list.find(x => x.role === 'owner') || list[0];
  const token = signToken(user.id, m.accountId);
  setAuthCookie(res, token);
  res.json({ token, ...me(user, m, list) });
});

r.post('/logout', (_req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

r.get('/me', authenticate, async (req, res) => {
  res.json(me(req.user, req.membership, await accountsOf(req.user.id)));
});

/** Мягкая проверка сессии для админки: без входа отвечает 200 { authenticated: false } вместо 401 */
r.get('/session', async (req, res) => {
  const has = req.cookies?.[COOKIE] || /^Bearer /i.test(req.headers.authorization || '');
  if (!has) return res.json({ authenticated: false });
  try {
    await authenticate(req, res, () => {});
  } catch {
    res.clearCookie(COOKIE, { path: '/' });
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, ...me(req.user, req.membership, await accountsOf(req.user.id)) });
});

/** Переключиться на другой аккаунт (если человек работает у нескольких владельцев) */
r.post('/switch-account', authenticate, async (req, res) => {
  const { accountId } = parse(z.object({ accountId: z.string() }), req.body);
  const m = await prisma.membership.findUnique({ where: { userId_accountId: { userId: req.user.id, accountId } }, include: { account: true } });
  if (!m || !m.active) throw new HttpError(403, 'Нет доступа к этому аккаунту');
  const token = signToken(req.user.id, accountId);
  setAuthCookie(res, token);
  res.json({ token, ...me(req.user, m, await accountsOf(req.user.id)) });
});

return r;
}
