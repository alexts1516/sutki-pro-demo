// Команда: сотрудники аккаунта и привязка их Telegram.
//   GET  /api/admin/team                         — список
//   POST /api/admin/team                         — добавить сотрудника { name, email|phone, password, role }
//   PATCH /api/admin/team/:userId                — { active, canDrive, vehicle, vehicleSeats, vehicleBags, vehicleClass: sedan|minivan|bus } — доступ; «Водит» (получает заказы на трансфер) и машина;
//                                                  { payoutPercent, payoutFixedKzt } — своя ставка водителя, { paidAsDriver } — платим ли как водителю (только владелец)
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
  const canManage = (actorRole, targetRole) => actorRole === 'owner' ? targetRole !== 'owner' : ['cleaning', 'master', 'driver'].includes(targetRole);

  r.get('/team', async (req, res) => {
    const list = await prisma.membership.findMany({ where: { accountId: req.accountId }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    res.json(list.map(m => ({ userId: m.userId, name: m.user.name, email: m.user.email, phone: m.user.phone, role: m.role, active: m.active, canDrive: m.canDrive || m.role === 'driver', vehicle: m.vehicle, vehicleSeats: m.vehicleSeats, vehicleBags: m.vehicleBags, vehicleClass: m.vehicleClass, telegramLinked: !!m.user.telegramId, ...(req.role === 'owner' ? { payoutPercent: m.payoutPercent, payoutFixedKzt: m.payoutFixedKzt, paidAsDriver: m.paidAsDriver } : {}) })));
  });
  r.post('/team', async (req, res) => {
    const d = parse(z.object({
      name: z.string().min(2).max(80), email: z.string().email().optional(), phone: z.string().min(6).max(20).optional(),
      password: z.string().min(8, 'Пароль — минимум 8 символов'), role: z.enum(['admin', 'cleaning', 'master', 'driver']), canDrive: z.boolean().optional(), vehicle: z.string().max(120).optional(), locale: z.enum(['ru', 'en']).default('ru'),
    }).refine(x => x.email || x.phone, { message: 'Укажите email или телефон' }), req.body);
    if (!canManage(req.role, d.role)) throw forbidden('Эту роль может добавить только владелец');
    const email = d.email?.toLowerCase(), phone = d.phone?.replace(/[^\d+]/g, '');
    let user = await prisma.user.findFirst({ where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
    if (!user) user = await prisma.user.create({ data: { name: d.name, email, phone, locale: d.locale, passwordHash: await hashPassword(d.password) } });
    const exists = await prisma.membership.findUnique({ where: { userId_accountId: { userId: user.id, accountId: req.accountId } } });
    if (exists) throw new HttpError(409, 'Этот человек уже в команде');
    const canDrive = d.canDrive ?? ['admin', 'driver'].includes(d.role);   // админ и водитель — в списке водителей по умолчанию
    await prisma.membership.create({ data: { userId: user.id, accountId: req.accountId, role: d.role, canDrive, vehicle: d.vehicle } });
    res.status(201).json({ userId: user.id, name: user.name, email: user.email, phone: user.phone, role: d.role, active: true, canDrive, vehicle: d.vehicle || null });
  });
  r.patch('/team/:userId', async (req, res) => {
    const d = parse(z.object({ active: z.boolean().optional(), canDrive: z.boolean().optional(), vehicle: z.string().max(120).nullable().optional(),
      vehicleSeats: z.number().int().min(1).max(60).nullable().optional(), vehicleBags: z.number().int().min(0).max(60).nullable().optional(), vehicleClass: z.enum(['sedan', 'minivan', 'bus']).nullable().optional(),
      payoutPercent: z.number().min(0).max(100).nullable().optional(), payoutFixedKzt: z.number().int().min(0).max(10000000).nullable().optional(), paidAsDriver: z.boolean().optional() }), req.body);
    const m = await prisma.membership.findUnique({ where: { userId_accountId: { userId: req.params.userId, accountId: req.accountId } } });
    if (!m) throw notFound('Сотрудник не найден');
    const self = m.userId === req.user.id;
    if (self && d.active === false) throw badRequest('Нельзя отключить самого себя');
    if (d.active !== undefined && !canManage(req.role, m.role)) throw forbidden();
    if ((d.canDrive !== undefined || d.vehicle !== undefined || d.vehicleSeats !== undefined || d.vehicleBags !== undefined || d.vehicleClass !== undefined) && !self && !canManage(req.role, m.role)) throw forbidden();   // себя в водители — можно всегда
    if ((d.payoutPercent !== undefined || d.payoutFixedKzt !== undefined || d.paidAsDriver !== undefined) && req.role !== 'owner') throw forbidden('Ставку водителя меняет только владелец');
    if (d.paidAsDriver !== undefined && m.role === 'owner') throw badRequest('Для владельца — настройка «Везёт сам владелец» в разделе «Настройки»');
    if (m.role === 'driver' && d.canDrive === false) throw badRequest('У роли «Водитель» флаг «Водит» всегда включён');
    const u = await prisma.membership.update({ where: { id: m.id }, data: d });
    res.json({ ok: true, active: u.active, canDrive: u.canDrive || u.role === 'driver', vehicle: u.vehicle, vehicleSeats: u.vehicleSeats, vehicleBags: u.vehicleBags, vehicleClass: u.vehicleClass, ...(req.role === 'owner' ? { payoutPercent: u.payoutPercent, payoutFixedKzt: u.payoutFixedKzt, paidAsDriver: u.paidAsDriver } : {}) });
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
