// Трансферы и заказы водителям (владелец и администратор).
//   GET  /api/admin/transfers                     — заявки гостей на трансфер (с заказом водителю, если есть)
//   POST /api/admin/transfers/:id/dispatch        — отправить водителям трансфер без брони / по неподтверждённой брони
//   GET  /api/admin/transfer-jobs                 — заказы ?from=&to=&status=OFFERED,UNASSIGNED
//   GET  /api/admin/transfer-jobs/:id             — карточка: маршрут, гость (с телефоном), водитель, выплата, журнал
//   PATCH /api/admin/transfer-jobs/:id            — { date, time, flight, place, address, pax, bags, childSeats, sign, guestPhone, meetingPoint, notes,
//                                                    priceKzt (цена для гостя), payoutKzt (выплата вручную; null — снова по правилам), payoutAuto: true }
//   POST /api/admin/transfer-jobs/:id/assign      — { driverUserId } или { driverContractorId } назначить / переназначить
//   POST /api/admin/transfer-jobs/:id/offer       — снять водителя и снова предложить всем
//   POST /api/admin/transfer-jobs/:id/status      — { action: en-route|arrived|picked-up|done } за водителя (если он позвонил)
//   POST /api/admin/transfer-jobs/:id/cancel      — { reason }
//   POST /api/admin/transfer-jobs/:id/paid        — { paid } выплата водителю (после DONE; долг DriverPayout PENDING → PAID)
//   POST /api/admin/transfer-jobs/:id/guest-payment — { status: PAID|UNPAID, method: cash|card|online } гость заплатил бизнесу
//   POST /api/admin/transfer-jobs/:id/link        — новая ссылка для внешнего водителя
//   GET  /api/admin/drivers                       — кто может водить: команда (canDrive / роль driver) и внешние водители
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { notFound, badRequest, HttpError, parse } from '../../lib/errors.js';
import { parseDay, isoDay, addDays, todayIn } from '../../lib/dates.js';
import { loadJob, jobForManager, jobListItem, jobInclude, driverWhere, STATUSES, ACTIVE, GUEST_PAY_METHODS, vehicleCapacity, CAR_CLASS_RU } from '../../services/transferJobs.js';

const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время ЧЧ:ММ');
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата ГГГГ-ММ-ДД');

const capOut = (m) => { const c = vehicleCapacity(m); return { vehicleSeats: c.seats, vehicleBags: c.bags, vehicleClass: c.cls, vehicleClassLabel: CAR_CLASS_RU[c.cls] }; };

export default function transfersRouter({ dispatch, config }) {
  const r = Router();
  const actorOf = (req) => ({ type: req.role, id: req.user.id, name: req.user.name });
  const out = (job) => jobForManager(job, { publicUrl: config.publicUrl });
  async function job(req) {
    const j = await loadJob({ id: req.params.id, accountId: req.accountId });
    if (!j) throw notFound('Заказ на трансфер не найден');
    return j;
  }

  r.get('/transfers', async (req, res) => {
    const today = todayIn(req.account.timezone);
    const from = (req.query.from && parseDay(req.query.from)) || addDays(today, -3);
    const list = await prisma.transfer.findMany({ where: { accountId: req.accountId, date: { gte: from } }, include: { booking: { select: { number: true, status: true } }, job: { select: { id: true, status: true, driverName: true } } }, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 500 });
    res.json(list);
  });
  r.post('/transfers/:id/dispatch', async (req, res) => {
    const t = await prisma.transfer.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!t) throw notFound('Трансфер не найден');
    if (t.bookingId) {
      const b = await prisma.booking.findUnique({ where: { id: t.bookingId }, select: { status: true } });
      if (b?.status !== 'confirmed') throw new HttpError(409, 'Бронь ещё не подтверждена (не оплачена) — заказ водителям уйдёт сам после подтверждения');
    }
    const j = await dispatch.createForTransfer({ accountId: req.accountId, transferId: t.id, actor: actorOf(req) });
    res.status(201).json(out(await loadJob({ id: j.id })));
  });

  r.get('/transfer-jobs', async (req, res) => {
    const today = todayIn(req.account.timezone);
    const from = (req.query.from && parseDay(req.query.from)) || addDays(today, -3);
    const to = (req.query.to && parseDay(req.query.to)) || addDays(today, 60);
    const where = { accountId: req.accountId, transfer: { date: { gte: from, lt: to } } };
    const st = String(req.query.status || '').split(',').filter(s => STATUSES.includes(s));
    if (st.length) where.status = { in: st };
    const list = await prisma.transferJob.findMany({ where, include: jobInclude, orderBy: { pickupAt: 'asc' }, take: 500 });
    const counts = await prisma.transferJob.groupBy({ by: ['status'], where: { accountId: req.accountId, pickupAt: { gte: new Date(Date.now() - 6 * 3600000) } }, _count: true });
    res.json({ items: list.map(jobListItem), counts: Object.fromEntries(counts.map(c => [c.status, c._count])) });
  });
  r.get('/transfer-jobs/:id', async (req, res) => res.json(out(await job(req))));
  r.patch('/transfer-jobs/:id', async (req, res) => {
    const data = parse(z.object({
      date: DAY.optional(), time: HM.optional(), flight: z.string().max(20).nullable().optional(), place: z.enum(['airport', 'station']).optional(),
      address: z.string().max(200).nullable().optional(), pax: z.number().int().min(1).max(20).optional(), bags: z.number().int().min(0).max(20).optional(),
      childSeats: z.number().int().min(0).max(4).optional(), sign: z.string().max(80).nullable().optional(), guestPhone: z.string().max(30).nullable().optional(),
      meetingPoint: z.string().max(300).nullable().optional(), notes: z.string().max(1000).nullable().optional(), payoutKzt: z.number().int().min(0).max(10000000).nullable().optional(),
      priceKzt: z.number().int().min(0).max(10000000).optional(), payoutAuto: z.literal(true).optional(),
    }), req.body);
    res.json(out(await dispatch.update({ job: await job(req), actor: actorOf(req), data })));
  });
  r.post('/transfer-jobs/:id/assign', async (req, res) => {
    const d = parse(z.object({ driverUserId: z.string().optional(), driverContractorId: z.string().optional() }), req.body);
    res.json(out(await dispatch.assign({ job: await job(req), actor: actorOf(req), ...d })));
  });
  r.post('/transfer-jobs/:id/offer', async (req, res) => res.json(out(await dispatch.offerAgain({ job: await job(req), actor: actorOf(req) }))));
  r.post('/transfer-jobs/:id/status', async (req, res) => {
    const { action, note } = parse(z.object({ action: z.enum(['en-route', 'arrived', 'picked-up', 'done']), note: z.string().max(500).optional() }), req.body);
    const j = await job(req);
    if (!j.driverUserId && !j.driverContractorId) throw new HttpError(409, 'Сначала назначьте водителя');
    res.json(out(await dispatch.step({ job: j, actor: actorOf(req), action, override: true, note: note || `отмечено за водителя (${req.user.name})` })));
  });
  r.post('/transfer-jobs/:id/cancel', async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().max(500).optional() }), req.body || {});
    res.json(out(await dispatch.cancel({ job: await job(req), actor: actorOf(req), reason })));
  });
  r.post('/transfer-jobs/:id/paid', async (req, res) => {
    const { paid } = parse(z.object({ paid: z.boolean().default(true) }), req.body || {});
    res.json(out(await dispatch.markPaid({ job: await job(req), actor: actorOf(req), paid })));
  });
  r.post('/transfer-jobs/:id/guest-payment', async (req, res) => {
    const d = parse(z.object({ status: z.enum(['PAID', 'UNPAID']), method: z.enum(GUEST_PAY_METHODS).optional() }), req.body || {});
    res.json(out(await dispatch.guestPayment({ job: await job(req), actor: actorOf(req), ...d })));
  });
  r.post('/transfer-jobs/:id/link', async (req, res) => res.json(out(await dispatch.newLink({ job: await job(req), actor: actorOf(req) }))));

  r.get('/drivers', async (req, res) => {
    const [team, external, busy] = await Promise.all([
      prisma.membership.findMany({ where: driverWhere(req.accountId), include: { user: true }, orderBy: { createdAt: 'asc' } }),
      dispatch.cfg.externalDrivers ? prisma.contractor.findMany({ where: { accountId: req.accountId, canDrive: true }, orderBy: { name: 'asc' } }) : [],   // внешние водители выключены
      prisma.transferJob.groupBy({ by: ['driverUserId'], where: { accountId: req.accountId, status: { in: ACTIVE }, driverUserId: { not: null } }, _count: true }),
    ]);
    const load = Object.fromEntries(busy.map(b => [b.driverUserId, b._count]));
    res.json({
      team: team.map(m => ({ userId: m.userId, name: m.user.name, role: m.role, phone: m.user.phone, vehicle: m.vehicle, telegramLinked: !!m.user.telegramId, activeJobs: load[m.userId] || 0, payoutPercent: m.payoutPercent, payoutFixedKzt: m.payoutFixedKzt, ...capOut(m) })),
      external: external.map(c => ({ contractorId: c.id, name: c.name, phone: c.phone, note: c.note, payoutPercent: c.payoutPercent, payoutFixedKzt: c.payoutFixedKzt })),
    });
  });
  return r;
}
