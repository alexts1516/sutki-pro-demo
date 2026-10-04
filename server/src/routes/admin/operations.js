// Брони, уборки, журнал уведомлений (владелец и администратор). Заявки мастерам — workRequests.js, трансферы — transfers.js.
// Финансы, платежи и курсы валют — только владелец.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireRole } from '../../auth/middleware.js';
import { notFound, badRequest, HttpError, parse } from '../../lib/errors.js';
import { bookingOut } from '../../lib/serialize.js';
import { parseDay, isoDay, addDays, todayIn } from '../../lib/dates.js';
import { cancelBooking, confirmBooking, isAvailable, withApartmentTx } from '../../services/bookings.js';
import { loadCurrency } from '../../site/config.js';
import { cleaningReport } from '../../services/cleaning.js';
import { linkOut, releaseExpiredLinks } from '../../services/bookingLinks.js';
import { logDatesChangedInTx } from '../../services/linkPrice.js';

export default function operationsRouter({ events, dispatch, cleaning }) {
  const r = Router();
  const actorOf = (req) => ({ type: req.role, id: req.user.id, name: req.user.name });
  const day = (s, fallback) => (s ? parseDay(s) : null) || fallback;

  // ---------- брони ----------
  r.get('/bookings', async (req, res) => {
    await releaseExpiredLinks(req.accountId);
    const today = todayIn(req.account.timezone);
    const from = day(req.query.from, addDays(today, -7)), to = day(req.query.to, addDays(today, 60));
    const where = { accountId: req.accountId, checkIn: { lt: to }, checkOut: { gt: from } };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.source === 'link') { where.source = 'link'; delete where.checkIn; delete where.checkOut; }
    if (req.query.status === 'request') { delete where.checkIn; delete where.checkOut; }
    const list = await prisma.booking.findMany({ where, include: { apartment: true, guest: true, link: true }, orderBy: req.query.source === 'link' ? { createdAt: 'desc' } : { checkIn: 'asc' }, take: 1000 });
    res.json(list.map(b => ({ ...bookingOut(b), ...(b.source === 'link' ? { link: b.link ? linkOut(b.link, b) : null } : {}) })));
  });
  r.get('/bookings/:id', async (req, res) => {
    await releaseExpiredLinks(req.accountId);
    const b = await prisma.booking.findFirst({ where: { id: req.params.id, accountId: req.accountId }, include: { apartment: true, guest: true, link: true, transfers: { include: { job: { select: { id: true, status: true, driverName: true } } } }, cleanings: { include: { assignee: { select: { name: true } } } } } });
    if (!b) throw notFound('Бронь не найдена');
    res.json({
      ...bookingOut(b), apartmentId: b.apartmentId, ...(b.source === 'link' ? { link: b.link ? linkOut(b.link, b) : null } : {}),
      transfers: b.transfers.map(t => ({ id: t.id, direction: t.direction, place: t.place, date: isoDay(t.date), time: t.time, flight: t.flight, pax: t.pax, priceKzt: t.priceKzt, status: t.status, driverName: t.driverName, job: t.job })),
      cleanings: b.cleanings.map(c => ({ id: c.id, date: isoDay(c.date), status: c.status, assignee: c.assignee?.name || null })),
    });
  });
  r.post('/bookings/:id/confirm', async (req, res) => {
    const b = await confirmBooking({ accountId: req.accountId, bookingId: req.params.id, events, dispatch, actor: actorOf(req) });
    res.json(bookingOut(b));
  });
  r.post('/bookings/:id/cancel', async (req, res) => {
    // единая отмена (проход 4, шаг 3): транзакция квартиры + журнал отложенных действий для водителей
    const u = await cancelBooking({ accountId: req.accountId, bookingId: req.params.id, today: todayIn(req.account.timezone), events, dispatch, actor: actorOf(req) });
    res.json(bookingOut(u));
  });
  r.patch('/bookings/:id', async (req, res) => {
    const data = parse(z.object({
      paymentStatus: z.enum(['unpaid', 'prepaid', 'paid', 'refunded']).optional(), note: z.string().max(2000).optional().nullable(),
      checkInTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), req.body);
    const b = await prisma.booking.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!b) throw notFound('Бронь не найдена');
    if (!data.checkIn && !data.checkOut) {   // без смены дат занятость не меняется
      const u = await prisma.booking.update({ where: { id: b.id }, data, include: { apartment: true, guest: true } });
      return res.json(bookingOut(u));
    }
    // смена дат: проверка свободы, пересчёт суммы, запись и сдвиг подготовки — одной транзакцией квартиры (проход 4, шаг 2)
    const today = todayIn(req.account.timezone);
    const u = await withApartmentTx(b.apartmentId, async (tx) => {
      const cur = await tx.booking.findFirst({ where: { id: b.id, accountId: req.accountId } });
      if (!cur) throw notFound('Бронь не найдена');
      if (!['request', 'confirmed'].includes(cur.status)) throw new HttpError(409, 'Даты закрытой брони не меняются');
      const ci = data.checkIn ? parseDay(data.checkIn) : cur.checkIn, co = data.checkOut ? parseDay(data.checkOut) : cur.checkOut;
      if (!ci || !co || co <= ci) throw badRequest('Проверьте даты заезда и выезда');
      if (+ci !== +cur.checkIn && cur.checkIn <= today) throw new HttpError(409, 'Гость уже заехал — можно менять только дату выезда');
      if (co < today) throw badRequest('Дата выезда уже прошла');
      if (!(await isAvailable(req.accountId, cur.apartmentId, ci, co, cur.id, tx))) throw new HttpError(409, 'Эти даты уже заняты');
      const n = Math.round((co - ci) / 86400000);
      const upd = await tx.booking.update({ where: { id: cur.id }, data: { ...data, checkIn: ci, checkOut: co, totalKzt: cur.nightlyKzt * n + cur.petFeeKzt }, include: { apartment: true, guest: true } });
      await tx.cleaningTask.updateMany({ where: { bookingId: cur.id, status: { in: ['assigned', 'enroute'] } }, data: { date: upd.checkOut } });   // идущую подготовку не двигаем
      await logDatesChangedInTx(tx, { old: cur, upd, actor: actorOf(req) });   // бронь по ссылке: сумма изменилась → журнал цены (проход 4, шаг 6); новый termsHash — гость соглашается заново
      return upd;
    });
    await dispatch.syncBookingDates({ accountId: req.accountId, booking: u, actor: actorOf(req) });   // водители и уведомления — после записи
    res.json(bookingOut(u));
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

  // ---------- уборки ----------
  r.get('/cleaning-tasks', async (req, res) => {
    const d = day(req.query.date, todayIn(req.account.timezone));
    res.json(await prisma.cleaningTask.findMany({ where: { accountId: req.accountId, date: d }, include: { apartment: { select: { id: true, title: true } }, assignee: { select: { id: true, name: true } } }, orderBy: { fromTime: 'asc' } }));
  });
  r.patch('/cleaning-tasks/:id', async (req, res) => {
    const { assigneeId } = parse(z.object({ assigneeId: z.string().nullable() }), req.body);
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!t) throw notFound('Уборка не найдена');
    if (t.status === 'done') throw new HttpError(409, 'Подготовка уже закончена — исполнителя не поменять');
    if (t.status === 'progress' && assigneeId !== t.assigneeId) throw new HttpError(409, 'Подготовка уже идёт — сначала свяжитесь со специалистом');
    if (assigneeId) {
      const m = await prisma.membership.findFirst({ where: { accountId: req.accountId, userId: assigneeId, role: 'cleaning', active: true } });
      if (!m) throw badRequest('Исполнитель должен быть специалистом по подготовке этого аккаунта');
    }
    // сменили исполнителя у «В пути» — новый начинает с начала (иначе задача «в пути» без человека)
    res.json(await prisma.cleaningTask.update({ where: { id: t.id }, data: { assigneeId, ...(t.status === 'enroute' && assigneeId !== t.assigneeId ? { status: 'assigned' } : {}) } }));
  });

  // полный отчёт о подготовке: кто, начало/окончание, чек-лист, фото, проблемы, комментарии (+ выплата — владельцу)
  r.get('/cleaning-tasks/:id', async (req, res) => {
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId }, include: { apartment: true, photos: true, assignee: { select: { id: true, name: true } }, payout: true, defects: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw notFound('Подготовка не найдена');
    res.json(cleaningReport(t, { payout: req.role === 'owner' ? t.payout : null }));
  });
  // проблема с подготовки → заявка мастеру одним нажатием (без исполнителя — владелец выберет мастера)
  r.post('/cleaning-tasks/:id/problems/:pid/repair', async (req, res) => {
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!t) throw notFound('Подготовка не найдена');
    const rt = await cleaning.problemToRepair(t, req.params.pid, actorOf(req));
    res.status(201).json({ repairTaskId: rt.id, title: rt.title });
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
    const [bookings, repairs, aptCount, transferJobs, cleaningPayouts, unpaidAll] = await Promise.all([
      prisma.booking.findMany({ where: { accountId: req.accountId, status: { in: ['confirmed', 'completed'] }, checkIn: { lt: to }, checkOut: { gt: from } } }),
      prisma.repairTask.findMany({ where: { accountId: req.accountId, date: { gte: from, lt: to }, costKzt: { gt: 0 }, status: { not: 'CANCELLED' } } }),
      prisma.apartment.count({ where: { accountId: req.accountId, active: true } }),
      prisma.transferJob.findMany({ where: { accountId: req.accountId, status: 'DONE', pickupAt: { gte: from, lt: to } }, include: { transfer: { select: { priceKzt: true, guestPaymentStatus: true } }, payoutRecord: true } }),
      prisma.payout.findMany({ where: { accountId: req.accountId, kind: 'cleaning', cleaningTask: { date: { gte: from, lt: to } } } }),
      prisma.payout.findMany({ where: { accountId: req.accountId, status: 'PENDING' } }),
    ]);
    let revenue = 0, nights = 0;
    for (const b of bookings) {
      const s = Math.max(+b.checkIn, +from), e = Math.min(+b.checkOut, +to); const n = Math.round((e - s) / 86400000);
      if (n > 0) { nights += n; revenue += n * b.nightlyKzt; }
    }
    const days = Math.round((to - from) / 86400000);
    const repairsKzt = repairs.reduce((s, x) => s + (x.costKzt || 0), 0);
    // трансферы (выполненные за месяц): вся цена — выручка бизнеса (гость платит бизнесу),
    // выплаты водителям — долги DriverPayout (есть только если выплата > 0; везёт владелец — долга нет, маржа 100%)
    const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
    const price = (j) => j.transfer?.priceKzt;
    const recs = transferJobs.map(j => j.payoutRecord).filter(Boolean);
    const transfersKzt = sum(recs, r => r.amountKzt);
    const transfersPaidOutKzt = sum(recs.filter(r => r.status === 'PAID'), r => r.amountKzt);
    const transfersUnpaidKzt = transfersKzt - transfersPaidOutKzt;   // должны водителям
    const transfersRevenueKzt = sum(transferJobs, price);
    const transfersGuestPaidKzt = sum(transferJobs.filter(j => j.transfer?.guestPaymentStatus === 'PAID'), price);
    const transfersMarginKzt = transfersRevenueKzt - transfersKzt;   // осталось бизнесу (комиссия + поездки владельца целиком)
    const own = transferJobs.filter(j => ['owner', 'business'].includes(j.payoutRule));
    const cleaningKzt = sum(cleaningPayouts, p => p.amountKzt);   // подготовка квартир (выплаты специалистам)
    const cleaningUnpaidKzt = sum(cleaningPayouts.filter(p => p.status !== 'PAID'), p => p.amountKzt);
    const repairsUnpaidKzt = repairs.filter(x => !x.paid).reduce((s, x) => s + (x.costKzt || 0), 0);
    res.json({
      month: m, revenueKzt: revenue, nights, occupancy: aptCount ? nights / (aptCount * days) : 0, adrKzt: nights ? Math.round(revenue / nights) : 0,
      repairsKzt, repairsUnpaidKzt, repairs: repairs.length,
      transfersRevenueKzt, transfersGuestPaidKzt, transfersGuestUnpaidKzt: transfersRevenueKzt - transfersGuestPaidKzt,
      transfersKzt, transfersPayoutKzt: transfersKzt, transfersPaidOutKzt, transfersUnpaidKzt, transfersMarginKzt, transfers: transferJobs.length,
      transfersOwnTrips: own.length, transfersOwnKzt: sum(own, price),
      cleaningKzt, cleaningUnpaidKzt, cleanings: cleaningPayouts.length,
      payoutsUnpaidKzt: sum(unpaidAll, p => p.amountKzt), payoutsUnpaid: unpaidAll.length,   // всего должны исполнителям (за все месяцы)
      netKzt: revenue + transfersRevenueKzt - repairsKzt - transfersKzt - cleaningKzt, bookings: bookings.length,
    });
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
