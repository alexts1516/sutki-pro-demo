// Брони, трансферы, уборки, журнал уведомлений (владелец и администратор). Заявки мастерам — workRequests.js.
// Финансы, платежи и курсы валют — только владелец.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireRole } from '../../auth/middleware.js';
import { notFound, badRequest, HttpError, parse } from '../../lib/errors.js';
import { bookingOut } from '../../lib/serialize.js';
import { parseDay, isoDay, addDays, todayIn } from '../../lib/dates.js';
import { confirmBooking } from '../../services/bookings.js';
import { loadCurrency } from '../../site/config.js';

export default function operationsRouter({ events }) {
  const r = Router();
  const day = (s, fallback) => (s ? parseDay(s) : null) || fallback;

  // ---------- брони ----------
  r.get('/bookings', async (req, res) => {
    const today = todayIn(req.account.timezone);
    const from = day(req.query.from, addDays(today, -7)), to = day(req.query.to, addDays(today, 60));
    const where = { accountId: req.accountId, checkIn: { lt: to }, checkOut: { gt: from } };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.status === 'request') { delete where.checkIn; delete where.checkOut; }
    const list = await prisma.booking.findMany({ where, include: { apartment: true, guest: true }, orderBy: { checkIn: 'asc' }, take: 1000 });
    res.json(list.map(bookingOut));
  });
  r.get('/bookings/:id', async (req, res) => {
    const b = await prisma.booking.findFirst({ where: { id: req.params.id, accountId: req.accountId }, include: { apartment: true, guest: true, transfers: true } });
    if (!b) throw notFound('Бронь не найдена');
    res.json({ ...bookingOut(b), transfers: b.transfers });
  });
  r.post('/bookings/:id/confirm', async (req, res) => {
    const b = await confirmBooking({ accountId: req.accountId, bookingId: req.params.id, events });
    res.json(bookingOut(b));
  });
  r.post('/bookings/:id/cancel', async (req, res) => {
    const b = await prisma.booking.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!b) throw notFound('Бронь не найдена');
    const u = await prisma.booking.update({ where: { id: b.id }, data: { status: 'cancelled' }, include: { apartment: true, guest: true } });
    res.json(bookingOut(u));
  });
  r.patch('/bookings/:id', async (req, res) => {
    const data = parse(z.object({
      paymentStatus: z.enum(['unpaid', 'prepaid', 'paid', 'refunded']).optional(), note: z.string().max(2000).optional().nullable(),
      checkInTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    }), req.body);
    const b = await prisma.booking.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!b) throw notFound('Бронь не найдена');
    res.json(bookingOut(await prisma.booking.update({ where: { id: b.id }, data, include: { apartment: true, guest: true } })));
  });

  // ---------- день: заезды / выезды / уборки (как в прототипе) ----------
  r.get('/day/:date', async (req, res) => {
    const d = parseDay(req.params.date); if (!d) throw badRequest('Дата в формате ГГГГ-ММ-ДД');
    const inc = { apartment: true, guest: true, transfers: true };
    const [arrivals, departures, cleanings] = await Promise.all([
      prisma.booking.findMany({ where: { accountId: req.accountId, status: 'confirmed', checkIn: d }, include: inc, orderBy: { checkInTime: 'asc' } }),
      prisma.booking.findMany({ where: { accountId: req.accountId, status: { in: ['confirmed', 'completed'] }, checkOut: d }, include: inc, orderBy: { checkOutTime: 'asc' } }),
      prisma.cleaningTask.findMany({ where: { accountId: req.accountId, date: d }, include: { apartment: true, assignee: true }, orderBy: { fromTime: 'asc' } }),
    ]);
    const sum = (l) => l.reduce((s, b) => s + b.guestsCount, 0);
    res.json({
      date: isoDay(d),
      arrivals: { count: arrivals.length, guests: sum(arrivals), items: arrivals.map(b => ({ ...bookingOut(b), transfer: b.transfers.find(t => t.direction === 'in') || null })) },
      departures: { count: departures.length, guests: sum(departures), items: departures.map(bookingOut) },
      cleanings: { count: cleanings.length, done: cleanings.filter(c => c.status === 'done').length, items: cleanings.map(c => ({ id: c.id, apartment: c.apartment.title, assignee: c.assignee?.name || null, status: c.status, fromTime: c.fromTime, toTime: c.toTime })) },
    });
  });

  // ---------- трансферы ----------
  r.get('/transfers', async (req, res) => {
    const today = todayIn(req.account.timezone);
    const list = await prisma.transfer.findMany({ where: { accountId: req.accountId, date: { gte: day(req.query.from, addDays(today, -3)) } }, include: { booking: { select: { number: true } } }, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 500 });
    res.json(list);
  });
  r.patch('/transfers/:id', async (req, res) => {
    const data = parse(z.object({ status: z.enum(['requested', 'planned', 'driver', 'done', 'cancelled']).optional(), driverName: z.string().max(80).optional().nullable() }), req.body);
    const t = await prisma.transfer.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!t) throw notFound('Трансфер не найден');
    if (data.driverName && !data.status) data.status = 'driver';
    const u = await prisma.transfer.update({ where: { id: t.id }, data });
    if (u.status === 'driver' && u.driverName && u.driverName !== t.driverName) events.emit('transfer.assigned', { accountId: req.accountId, transferId: u.id });
    res.json(u);
  });

  // ---------- уборки ----------
  r.get('/cleaning-tasks', async (req, res) => {
    const d = day(req.query.date, todayIn(req.account.timezone));
    res.json(await prisma.cleaningTask.findMany({ where: { accountId: req.accountId, date: d }, include: { apartment: { select: { id: true, title: true } }, assignee: { select: { id: true, name: true } } }, orderBy: { fromTime: 'asc' } }));
  });
  r.patch('/cleaning-tasks/:id', async (req, res) => {
    const { assigneeId } = parse(z.object({ assigneeId: z.string().nullable() }), req.body);
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!t) throw notFound('Уборка не найдена');
    if (assigneeId) {
      const m = await prisma.membership.findFirst({ where: { accountId: req.accountId, userId: assigneeId, role: 'cleaning', active: true } });
      if (!m) throw badRequest('Исполнитель должен быть специалистом по клинингу этого аккаунта');
    }
    res.json(await prisma.cleaningTask.update({ where: { id: t.id }, data: { assigneeId } }));
  });

  // ремонты, сметы, доп. расходы и подрядчики — в workRequests.js

  // ---------- журнал уведомлений ----------
  r.get('/notifications', async (req, res) => {
    res.json(await prisma.notificationLog.findMany({ where: { accountId: req.accountId }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit) || 100, 500) }));
  });

  // ---------- только владелец: финансы, платежи, валюты, тариф ----------
  r.get('/finance', requireRole('owner'), async (req, res) => {
    const m = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : isoDay(todayIn(req.account.timezone)).slice(0, 7);
    const from = parseDay(m + '-01'); const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const [bookings, repairs, aptCount] = await Promise.all([
      prisma.booking.findMany({ where: { accountId: req.accountId, status: { in: ['confirmed', 'completed'] }, checkIn: { lt: to }, checkOut: { gt: from } } }),
      prisma.repairTask.findMany({ where: { accountId: req.accountId, date: { gte: from, lt: to }, costKzt: { gt: 0 } } }),
      prisma.apartment.count({ where: { accountId: req.accountId, active: true } }),
    ]);
    let revenue = 0, nights = 0;
    for (const b of bookings) {
      const s = Math.max(+b.checkIn, +from), e = Math.min(+b.checkOut, +to); const n = Math.round((e - s) / 86400000);
      if (n > 0) { nights += n; revenue += n * b.nightlyKzt; }
    }
    const days = Math.round((to - from) / 86400000);
    const repairsKzt = repairs.reduce((s, x) => s + (x.costKzt || 0), 0);
    res.json({ month: m, revenueKzt: revenue, nights, occupancy: aptCount ? nights / (aptCount * days) : 0, adrKzt: nights ? Math.round(revenue / nights) : 0, repairsKzt, bookings: bookings.length });
  });
  r.get('/payments', requireRole('owner'), async (req, res) => {
    res.json(await prisma.payment.findMany({ where: { accountId: req.accountId }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, bookingId: true, provider: true, providerPaymentId: true, amountKzt: true, currency: true, amount: true, status: true, createdAt: true } }));
  });
  r.get('/currency', async (req, res) => res.json(await loadCurrency(prisma, req.accountId)));
  r.put('/currency', requireRole('owner'), async (req, res) => {
    const data = parse(z.object({
      rates: z.record(z.enum(['RUB', 'USD', 'EUR']), z.number().positive().max(100000)).optional(),
      shown: z.array(z.enum(['KZT', 'RUB', 'USD', 'EUR'])).min(1).optional(),
      roundMode: z.enum(['nearest', 'up', 'none']).optional(),
    }), req.body);
    const ops = Object.entries(data.rates || {}).map(([code, rateKzt]) => prisma.exchangeRate.upsert({ where: { accountId_code: { accountId: req.accountId, code } }, update: { rateKzt }, create: { accountId: req.accountId, code, rateKzt } }));
    if (data.shown || data.roundMode) {
      const shown = data.shown ? (data.shown.includes('KZT') ? data.shown : ['KZT', ...data.shown]) : undefined;
      ops.push(prisma.currencySettings.upsert({ where: { accountId: req.accountId }, update: { ...(shown && { shown }), ...(data.roundMode && { roundMode: data.roundMode }) }, create: { accountId: req.accountId, shown: shown || ['KZT'], roundMode: data.roundMode || 'nearest' } }));
    }
    await prisma.$transaction(ops);
    res.json(await loadCurrency(prisma, req.accountId));
  });
  r.get('/account', async (req, res) => {
    const a = req.account;
    res.json({ id: a.id, name: a.name, slug: a.slug, plan: a.plan, status: a.status, trialEndsAt: a.trialEndsAt, timezone: a.timezone });
  });
  return r;
}
