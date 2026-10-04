// Операционный экран и карточка квартиры (владелец и админ):
//   GET  /api/admin/today                         — «Сегодня»: критично → требует действия → план дня → информация
//   GET  /api/admin/apartments/:id/ops            — карточка квартиры: гость, заезд/выезд, готовность (почему не готова), подготовка, фото, недочёты, работы, что сделать
//   GET  /api/admin/defects?apartmentId=&status=  — недочёты
//   POST /api/admin/defects                       — { apartmentId, text, priority: urgent|later } добавить недочёт
//   POST /api/admin/defects/:id/repair            — «Заявка мастеру» (без исполнителя — выберете мастера в заявке)
//   POST /api/admin/defects/:id/take              — «Сделаю сам»
//   POST /api/admin/defects/:id/resolve           — { note? } «Решено»
//   PATCH /api/admin/defects/:id                  — { priority }
//   POST /api/admin/bookings/:id/early-checkin    — { approve: true|false } ранний заезд: согласовать (время заезда сдвигается → срок подготовки тоже) или отказать
//   POST /api/admin/cleaning-tasks/:id/review     — принять отчёт подготовки, законченной не полностью
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { HttpError, notFound, parse } from '../../lib/errors.js';
import { todayView, apartmentOps } from '../../services/ops.js';
import { defectOut, PRIORITIES } from '../../services/defects.js';

/** Минимум времени на подготовку между выездом предыдущего гостя и ранним заездом */
export const PREP_MIN = 120;
const mins = (t) => { const [h, m] = String(t || '00:00').split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function opsRouter({ defects, cleaning, events }) {
  const r = Router();
  const actorOf = (req) => ({ type: req.role, id: req.user.id, name: req.user.name });

  r.get('/today', async (req, res) => res.json(await todayView(req.accountId, { role: req.role })));
  r.get('/apartments/:id/ops', async (req, res) => {
    const x = await apartmentOps(req.accountId, req.params.id, { role: req.role });
    if (!x) throw notFound('Квартира не найдена');
    res.json(x);
  });

  r.get('/defects', async (req, res) => {
    const where = { accountId: req.accountId, status: req.query.status === 'all' ? undefined : (req.query.status || 'open') };
    if (req.query.apartmentId) where.apartmentId = String(req.query.apartmentId);
    const list = await prisma.defect.findMany({ where, include: { repairTask: { select: { status: true } } }, orderBy: { createdAt: 'desc' }, take: 300 });
    const photos = await prisma.cleaningPhoto.findMany({ where: { accountId: req.accountId, id: { in: list.flatMap(d => d.photoIds || []) } } });
    res.json(list.map(d => defectOut(d, photos)));
  });
  r.post('/defects', async (req, res) => {
    const d = parse(z.object({ apartmentId: z.string(), text: z.string().trim().min(3, 'Опишите, что не так').max(1000), priority: z.enum(PRIORITIES).default('later') }), req.body);
    const apt = await prisma.apartment.findFirst({ where: { id: d.apartmentId, accountId: req.accountId } });
    if (!apt) throw notFound('Квартира не найдена');
    res.status(201).json(defectOut(await defects.create({ accountId: req.accountId, ...d, actor: actorOf(req) })));
  });
  r.post('/defects/:id/repair', async (req, res) => { const t = await defects.toRepair(req.accountId, req.params.id, actorOf(req)); res.status(201).json({ repairTaskId: t.id, title: t.title }); });
  r.post('/defects/:id/take', async (req, res) => res.json(defectOut(await defects.take(req.accountId, req.params.id, actorOf(req)))));
  r.post('/defects/:id/resolve', async (req, res) => {
    const { note } = parse(z.object({ note: z.string().max(500).optional() }), req.body || {});
    res.json(defectOut(await defects.resolve(req.accountId, req.params.id, actorOf(req), { note })));
  });
  r.patch('/defects/:id', async (req, res) => {
    const { priority } = parse(z.object({ priority: z.enum(PRIORITIES) }), req.body);
    res.json(defectOut(await defects.setPriority(req.accountId, req.params.id, priority)));
  });

  r.post('/bookings/:id/early-checkin', async (req, res) => {
    const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
    const b = await prisma.booking.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!b) throw notFound('Бронь не найдена');
    if (b.earlyCheckInStatus !== 'requested' || !b.earlyCheckIn) throw new HttpError(409, 'Нет запроса на ранний заезд');
    if (!['request', 'confirmed'].includes(b.status)) throw new HttpError(409, 'Бронь закрыта');
    if (approve) {
      // предыдущий гость выезжает в тот же день: раньше его выезда + время на подготовку заселить нельзя
      const prev = await prisma.booking.findFirst({ where: { accountId: req.accountId, apartmentId: b.apartmentId, id: { not: b.id }, status: { in: ['request', 'confirmed', 'completed'] }, checkOut: b.checkIn }, orderBy: { checkOutTime: 'desc' } });
      if (prev) {
        const earliest = mins(prev.checkOutTime) + PREP_MIN;
        if (mins(b.earlyCheckIn) < earliest) throw new HttpError(409, `В этот день выезжает предыдущий гость (до ${prev.checkOutTime}) + ${PREP_MIN / 60} ч на подготовку — раньше ${hhmm(earliest)} заселить нельзя. Откажите или предложите гостю ${hhmm(earliest)}`);
      }
    }
    const u = await prisma.booking.update({ where: { id: b.id }, data: approve ? { earlyCheckInStatus: 'approved', checkInTime: b.earlyCheckIn, note: [b.note, `Ранний заезд согласован: ${b.earlyCheckIn} (было ${b.checkInTime})`].filter(Boolean).join('\n') } : { earlyCheckInStatus: 'declined' } });
    events?.emit('booking.early_checkin', { accountId: req.accountId, bookingId: b.id, approved: approve });
    res.json({ id: u.id, checkInTime: u.checkInTime, earlyCheckIn: u.earlyCheckIn, earlyCheckInStatus: u.earlyCheckInStatus });
  });

  r.post('/cleaning-tasks/:id/review', async (req, res) => {
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!t) throw notFound('Подготовка не найдена');
    const u = await cleaning.review(t, actorOf(req));
    res.json({ id: u.id, reviewedAt: u.reviewedAt, reviewedBy: u.reviewedBy });
  });
  return r;
}
