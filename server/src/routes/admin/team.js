// Команда: сотрудники аккаунта и привязка их Telegram.
//   GET  /api/admin/team                         — список
//   POST /api/admin/team                         — добавить сотрудника { name, email|phone, password, role }
//   PATCH /api/admin/team/:userId                — { active } — включить/отключить доступ
//   POST /api/admin/team/:userId/telegram-invite — ссылка t.me/<бот>?start=i_<код> (действует 7 дней)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { hashPassword } from '../../auth/password.js';
import { forbidden, notFound, badRequest, HttpError, parse } from '../../lib/errors.js';
import { inviteCode } from '../../lib/tokens.js';
import { deepLink } from '../../telegram/linking.js';

export default function teamRouter({ config }) {
  const r = Router();
  // админ может управлять только клинингом и мастерами; владелец — всеми, кроме других владельцев
  const canManage = (actorRole, targetRole) => actorRole === 'owner' ? targetRole !== 'owner' : ['cleaning', 'master'].includes(targetRole);

  r.get('/team', async (req, res) => {
    const list = await prisma.membership.findMany({ where: { accountId: req.accountId }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    res.json(list.map(m => ({ userId: m.userId, name: m.user.name, email: m.user.email, phone: m.user.phone, role: m.role, active: m.active, telegramLinked: !!m.user.telegramId })));
  });
  r.post('/team', async (req, res) => {
    const d = parse(z.object({
      name: z.string().min(2).max(80), email: z.string().email().optional(), phone: z.string().min(6).max(20).optional(),
      password: z.string().min(8, 'Пароль — минимум 8 символов'), role: z.enum(['admin', 'cleaning', 'master']), locale: z.enum(['ru', 'en']).default('ru'),
    }).refine(x => x.email || x.phone, { message: 'Укажите email или телефон' }), req.body);
    if (!canManage(req.role, d.role)) throw forbidden('Эту роль может добавить только владелец');
    const email = d.email?.toLowerCase(), phone = d.phone?.replace(/[^\d+]/g, '');
    let user = await prisma.user.findFirst({ where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
    if (!user) user = await prisma.user.create({ data: { name: d.name, email, phone, locale: d.locale, passwordHash: await hashPassword(d.password) } });
    const exists = await prisma.membership.findUnique({ where: { userId_accountId: { userId: user.id, accountId: req.accountId } } });
    if (exists) throw new HttpError(409, 'Этот человек уже в команде');
    await prisma.membership.create({ data: { userId: user.id, accountId: req.accountId, role: d.role } });
    res.status(201).json({ userId: user.id, name: user.name, email: user.email, phone: user.phone, role: d.role, active: true });
  });
  r.patch('/team/:userId', async (req, res) => {
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const m = await prisma.membership.findUnique({ where: { userId_accountId: { userId: req.params.userId, accountId: req.accountId } } });
    if (!m) throw notFound('Сотрудник не найден');
    if (m.userId === req.user.id) throw badRequest('Нельзя отключить самого себя');
    if (!canManage(req.role, m.role)) throw forbidden();
    await prisma.membership.update({ where: { id: m.id }, data: { active } });
    res.json({ ok: true, active });
  });
  r.post('/team/:userId/telegram-invite', async (req, res) => {
    const m = await prisma.membership.findUnique({ where: { userId_accountId: { userId: req.params.userId, accountId: req.accountId } } });
    if (!m) throw notFound('Сотрудник не найден');
    if (m.userId !== req.user.id && !canManage(req.role, m.role)) throw forbidden();
    const inv = await prisma.invite.create({ data: { accountId: req.accountId, userId: m.userId, code: inviteCode(), expiresAt: new Date(Date.now() + 7 * 86400000) } });
    res.status(201).json({ code: inv.code, payload: `i_${inv.code}`, link: deepLink(config.telegram.username, `i_${inv.code}`), expiresAt: inv.expiresAt, botConfigured: !!config.telegram.token });
  });
  return r;
}
