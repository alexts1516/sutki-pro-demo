// Выплаты исполнителям (только владелец): кто сколько должен получить, «Оплатить» по одной или всё человеку.
//   GET  /api/admin/payouts?status=PENDING|PAID   — список + итог по людям (просроченные — overdue: true)
//   POST /api/admin/payouts/:id/pay               — { method: cash|transfer, paid: true|false }
//   POST /api/admin/payouts/pay-all               — { userId | contractorId | name, method } всё «к оплате» одному человеку
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireRole } from '../../auth/middleware.js';
import { badRequest, parse } from '../../lib/errors.js';
import { getSettings } from '../../services/settings.js';
import { payoutOut, PAY_METHODS } from '../../services/performerPayouts.js';

export default function payoutsRouter({ payouts }) {
  const r = Router();
  const actorOf = (req) => ({ type: req.role, id: req.user.id, name: req.user.name });
  const personKey = (p) => p.userId || p.contractorId || p.name || '—';

  r.get('/payouts', requireRole('owner'), async (req, res) => {
    const { payoutReminderHours: hours } = await getSettings(req.accountId);
    const where = { accountId: req.accountId };
    if (['PENDING', 'PAID'].includes(String(req.query.status))) where.status = String(req.query.status);
    const list = (await prisma.payout.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 })).map(p => payoutOut(p, hours));
    const people = {};
    for (const p of list.filter(x => x.status === 'PENDING')) {
      const k = personKey(p.performer);
      const x = people[k] ||= { key: k, ...p.performer, pendingKzt: 0, count: 0, overdue: false };
      x.pendingKzt += p.amountKzt; x.count++; x.overdue ||= p.overdue;
    }
    res.json({ reminderHours: hours, pendingKzt: list.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.amountKzt, 0), people: Object.values(people).sort((a, b) => b.pendingKzt - a.pendingKzt), items: list });
  });
  r.post('/payouts/pay-all', requireRole('owner'), async (req, res) => {
    const d = parse(z.object({ userId: z.string().optional(), contractorId: z.string().optional(), name: z.string().optional(), method: z.enum(PAY_METHODS).default('cash') }), req.body || {});
    const who = d.userId ? { userId: d.userId } : d.contractorId ? { contractorId: d.contractorId } : d.name ? { name: d.name, userId: null, contractorId: null } : null;
    if (!who) throw badRequest('Кому выплатить?');
    const list = await prisma.payout.findMany({ where: { accountId: req.accountId, status: 'PENDING', ...who } });
    let total = 0, paid = 0;
    for (const p of list) {
      try { await payouts.pay({ accountId: req.accountId, id: p.id, actor: actorOf(req), method: d.method }); total += p.amountKzt; paid++; } catch { /* например, нерешённые доп. расходы — пропускаем */ }
    }
    res.json({ paid, skipped: list.length - paid, totalKzt: total });
  });
  r.post('/payouts/:id/pay', requireRole('owner'), async (req, res) => {
    const d = parse(z.object({ method: z.enum(PAY_METHODS).default('cash'), paid: z.boolean().default(true) }), req.body || {});
    const p = await payouts.pay({ accountId: req.accountId, id: req.params.id, actor: actorOf(req), method: d.method, paid: d.paid });
    res.json(payoutOut(p, (await getSettings(req.accountId)).payoutReminderHours));
  });
  return r;
}
