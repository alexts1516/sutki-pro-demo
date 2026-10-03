// Трансферы в приложении команды — для всех, кто может водить (владелец/админ/сотрудник с «Водит», роль driver).
//   GET  /api/staff/transfers                 — { eligible, offers: открытые заказы, mine: мои, taken: взятые другими (без данных гостя) }
//   GET  /api/staff/transfers/:id             — карточка; телефон гостя — только водителю заказа после «Беру»
//   POST /api/staff/transfers/:id/accept      — { vehicle? } «Беру»: первый успевший получает заказ, остальным 409
//   POST /api/staff/transfers/:id/release     — { reason } отказаться (только до выезда) — заказ снова всем
//   POST /api/staff/transfers/:id/en-route    — { etaMinutes? } выехал
//   POST /api/staff/transfers/:id/arrived     — я на месте (пошло бесплатное ожидание)
//   POST /api/staff/transfers/:id/picked-up   — гость в машине
//   POST /api/staff/transfers/:id/done        — { note? } завершить
//   POST /api/staff/transfers/:id/time        — { time, date?, note } рейс задержался — новое время подачи (хозяину/админу — уведомление)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { forbidden, notFound, parse } from '../lib/errors.js';
import { loadJob, jobForDriver, jobInclude, driverMembership, isJobDriver, OPEN } from '../services/transferJobs.js';
import { getSettings } from '../services/settings.js';

export default function staffTransfersRouter({ dispatch }) {
  const r = Router();
  const actor = (req) => ({ type: 'driver', id: req.user.id, name: req.user.name });

  async function ctx(req) {
    const [job, m] = await Promise.all([loadJob({ id: req.params.id, accountId: req.accountId }), driverMembership(req.accountId, req.user.id)]);
    if (!job) throw notFound('Заказ не найден');
    if (!m && !isJobDriver(job, req.user.id)) throw forbidden('Вы не в списке водителей');
    return { job, eligible: !!m, viewer: { membership: m, settings: await getSettings(req.accountId) } };
  }
  const mineOnly = (req, job) => { if (!isJobDriver(job, req.user.id)) throw forbidden('Это не ваш заказ'); };
  const view = async (req, id, eligible, viewer) => jobForDriver(await loadJob({ id }), req.user.id, { eligible, viewer });

  r.get('/', async (req, res) => {
    const m = await driverMembership(req.accountId, req.user.id);
    const viewer = { membership: m, settings: await getSettings(req.accountId) };
    const since = new Date(Date.now() - 3600000), recent = new Date(Date.now() - 86400000);
    const [offers, mine, taken] = await Promise.all([
      m ? prisma.transferJob.findMany({ where: { accountId: req.accountId, status: { in: OPEN }, pickupAt: { gt: since } }, include: jobInclude, orderBy: { pickupAt: 'asc' } }) : [],
      prisma.transferJob.findMany({ where: { accountId: req.accountId, driverUserId: req.user.id, status: { not: 'CANCELLED' }, pickupAt: { gt: recent } }, include: jobInclude, orderBy: { pickupAt: 'asc' } }),
      m ? prisma.transferJob.findMany({ where: { accountId: req.accountId, status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP'] }, NOT: { driverUserId: req.user.id }, pickupAt: { gt: since } }, include: jobInclude, orderBy: { pickupAt: 'asc' }, take: 20 }) : [],
    ]);
    res.json({ eligible: !!m, offers: offers.map(j => jobForDriver(j, req.user.id, { eligible: true, viewer })), mine: mine.map(j => jobForDriver(j, req.user.id, { eligible: !!m })), taken: taken.map(j => jobForDriver(j, req.user.id, { eligible: true })) });
  });
  r.get('/:id', async (req, res) => { const { job, eligible, viewer } = await ctx(req); res.json(jobForDriver(job, req.user.id, { eligible, viewer })); });
  r.post('/:id/accept', async (req, res) => {
    const { vehicle } = parse(z.object({ vehicle: z.string().max(120).optional() }), req.body || {});
    const j = await dispatch.accept({ accountId: req.accountId, jobId: req.params.id, user: req.user, vehicle });
    res.json(jobForDriver(j, req.user.id, { eligible: true }));
  });
  r.post('/:id/release', async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().max(500).optional() }), req.body || {});
    const { job, eligible, viewer } = await ctx(req);
    await dispatch.release({ job, user: req.user, reason });
    res.json(await view(req, job.id, eligible, viewer));
  });
  for (const action of ['en-route', 'arrived', 'picked-up', 'done']) {
    r.post(`/:id/${action}`, async (req, res) => {
      const d = parse(z.object({ etaMinutes: z.number().int().min(1).max(600).optional(), note: z.string().max(500).optional() }), req.body || {});
      const { job, eligible } = await ctx(req); mineOnly(req, job);
      await dispatch.step({ job, actor: actor(req), action, ...d });
      res.json(await view(req, job.id, eligible));
    });
  }
  r.post('/:id/time', async (req, res) => {
    const d = parse(z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(300).optional() }), req.body);
    const { job, eligible } = await ctx(req); mineOnly(req, job);
    await dispatch.reschedule({ job, actor: actor(req), ...d });
    res.json(await view(req, job.id, eligible));
  });
  return r;
}
