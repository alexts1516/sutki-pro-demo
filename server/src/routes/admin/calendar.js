// Календарь-шахматка для админки: одна выборка на период — брони, уборки, заявки мастерам, трансферы.
//   GET /api/admin/calendar?from=ГГГГ-ММ-ДД&days=14
import { Router } from 'express';
import { prisma } from '../../db.js';
import { parseDay, isoDay, addDays, todayIn } from '../../lib/dates.js';
import { route } from '../../services/transferJobs.js';
import { readinessMap, READY_RU } from '../../services/ops.js';

export default function calendarRouter() {
  const r = Router();
  r.get('/calendar', async (req, res) => {
    const today = todayIn(req.account.timezone);
    const from = (req.query.from && parseDay(req.query.from)) || addDays(today, -1);
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 62);
    const to = addDays(from, days);
    const acc = req.accountId;
    const [apartments, bookings, cleanings, repairs, transfers] = await Promise.all([
      prisma.apartment.findMany({ where: { accountId: acc, active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, code: true, floor: true } }),
      prisma.booking.findMany({ where: { accountId: acc, status: { in: ['request', 'confirmed', 'completed'] }, NOT: { status: 'request', holdUntil: { lte: new Date() } }, checkIn: { lt: to }, checkOut: { gt: from } }, include: { guest: { select: { name: true } } }, orderBy: { checkIn: 'asc' } }),
      prisma.cleaningTask.findMany({ where: { accountId: acc, date: { gte: from, lt: to } }, include: { assignee: { select: { name: true } } } }),
      prisma.repairTask.findMany({ where: { accountId: acc, status: { not: 'CANCELLED' }, date: { gte: from, lt: to } }, select: { id: true, apartmentId: true, date: true, title: true, status: true, priority: true } }),
      prisma.transfer.findMany({ where: { accountId: acc, status: { not: 'cancelled' }, date: { gte: from, lt: to } }, include: { job: true, apartment: true, booking: { select: { number: true, status: true } } }, orderBy: [{ date: 'asc' }, { time: 'asc' }] }),
    ]);
    const ready = await readinessMap(acc);   // готовность квартир и открытые недочёты (⚠N на плитках)
    res.json({
      from: isoDay(from), days, today: isoDay(today),
      apartments: apartments.map(a => { const x = ready[a.id] || {}; return { id: a.id, title: a.title, number: a.code, floor: a.floor, state: x.state || null, stateLabel: READY_RU[x.state] || null, defects: x.defects || 0, urgentDefects: x.urgent || 0 }; }),
      bookings: bookings.map(b => ({ id: b.id, apartmentId: b.apartmentId, number: b.number, status: b.status, guestName: b.guest?.name || null, guestsCount: b.guestsCount, checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut), checkInTime: b.checkInTime, checkOutTime: b.checkOutTime, paymentStatus: b.paymentStatus, source: b.source })),
      cleanings: cleanings.map(c => ({ id: c.id, apartmentId: c.apartmentId, date: isoDay(c.date), status: c.status, assignee: c.assignee?.name || null, fromTime: c.fromTime, defects: ready[c.apartmentId]?.byCleaning?.[c.id] || 0 })),
      repairs: repairs.map(x => ({ id: x.id, apartmentId: x.apartmentId, date: isoDay(x.date), title: x.title, status: x.status, priority: x.priority })),
      transfers: transfers.map(t => ({
        transferId: t.id, jobId: t.job?.id || null, apartmentId: t.apartmentId, date: isoDay(t.date), time: t.time, direction: t.direction, place: t.place, flight: t.flight,
        guestName: t.guestName, pax: t.pax, bookingNumber: t.booking?.number || null, bookingStatus: t.booking?.status || null,
        status: t.job?.status || (t.status === 'done' ? 'DONE' : 'REQUESTED'), driverName: t.job?.driverName || t.driverName || null,
        ...(t.job ? route({ ...t.job, transfer: t, apartment: t.apartment }) : {}),
      })),
    });
  });
  return r;
}
