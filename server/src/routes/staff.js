// Приложение команды: каждый видит только свои задачи.
//   GET  /api/staff/tasks                         — мои уборки (клининг) / мои заявки (мастер, подрядчик); владелец/админ — все
//   GET  /api/staff/cleaning/:id                  — карточка уборки с доступом в квартиру (только исполнителю и менеджерам)
//   POST /api/staff/cleaning/:id/status           — { status: enroute|progress|done, report } (progress = начать, done = закончить)
//   Подготовка квартиры (специалист по подготовке):
//   POST /api/staff/cleaning/:id/start            — начать (время начала, чек-лист из шаблона + пункты квартиры)
//   POST /api/staff/cleaning/:id/check            — { index, done } отметить пункт
//   POST /api/staff/cleaning/:id/photos           — multipart: photos[], itemIndex (к пункту) или kind=general|problem
//   POST /api/staff/cleaning/:id/problem          — { text, photoIds } сообщить о проблеме (владелец сделает заявку мастеру)
//   POST /api/staff/cleaning/:id/finish           — { report, note } закончить (неотмеченные пункты — только с note)
//   GET  /api/staff/payouts                       — мои выплаты: «К оплате» / «Выплачено»
//   Заявки мастеру (только исполнитель заявки; владелец/админ — только чтение):
//   GET  /api/staff/repairs/:id                   — карточка: адрес + номер квартиры, кто будет в квартире, сметы, доп. расходы, журнал
//   POST /api/staff/repairs/:id/request-visit     — { note } нужен выезд (не могу оценить без осмотра)
//   POST /api/staff/repairs/:id/arrive            — { note, photoIds } приехал
//   POST /api/staff/repairs/:id/inspect           — { notes, photoIds } осмотр
//   POST /api/staff/repairs/:id/estimate          — { method: REMOTE|PHOTOS|VISIT, labourKzt, materialsIncluded, materialsKzt, maxKzt, items, comment }
//   POST /api/staff/repairs/:id/start             — начать работу (только после одобрения; quickJob — после приезда)
//   POST /api/staff/repairs/:id/extras            — { amountKzt, description, reason, photoIds } доп. расход не по вине мастера
//   POST /api/staff/repairs/:id/complete          — { finalCostKzt, report, photoIds } выполнено
//   POST /api/staff/repairs/:id/photos            — multipart: photos[], kind = arrival|inspection|after|receipt, captions[]
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { forbidden, notFound, parse } from '../lib/errors.js';
import { accessInfo } from '../lib/serialize.js';
import { todayIn, addDays, parseDay } from '../lib/dates.js';
import { MANAGERS } from '../auth/roles.js';
import { mountWorkActions } from './workActions.js';
import { imageUpload } from '../lib/upload.js';
import { makeKey, looksLikeImage } from '../storage/index.js';
import { cleaningReport, canStartCleaning } from '../services/cleaning.js';
import { cleaningDeadline } from '../services/ops.js';
import { defectOut } from '../services/defects.js';
import { isoDay } from '../lib/dates.js';
import { payoutOut } from '../services/performerPayouts.js';
import { loadTask, isExecutor, executorWhere, taskListItem, taskForManager } from '../services/workRequests.js';

export default function staffRouter({ events, workflow, storage, config, cleaning }) {
  const r = Router();
  const upload = imageUpload({ maxMb: config.storage.maxUploadMb, maxFiles: 10 });
  const isManager = (req) => MANAGERS.includes(req.role);

  async function ownCleaning(req) {
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId }, include: { apartment: true, photos: true, assignee: { select: { id: true, name: true } } } });
    if (!t) throw notFound('Уборка не найдена');
    if (!isManager(req) && t.assigneeId !== req.user.id) throw forbidden('Это не ваша задача');
    return t;
  }

  r.get('/tasks', async (req, res) => {
    const today = todayIn(req.account.timezone);
    const from = (req.query.date && parseDay(req.query.date)) || addDays(today, -1);
    const to = addDays(from, req.query.date ? 1 : 3);
    const mine = isManager(req) ? {} : { assigneeId: req.user.id };
    const aptSel = { select: { id: true, title: true, address: true, code: true } };
    const cleaning = req.role === 'master' ? [] : await prisma.cleaningTask.findMany({ where: { accountId: req.accountId, date: { gte: from, lt: to }, ...mine }, include: { apartment: aptSel }, orderBy: [{ date: 'asc' }, { fromTime: 'asc' }] });
    const repairs = req.role === 'cleaning' ? [] : await prisma.repairTask.findMany({
      where: { accountId: req.accountId, status: { notIn: ['DONE', 'CANCELLED'] }, ...(isManager(req) ? {} : executorWhere(req.user.id)) },
      include: { apartment: { select: { id: true, title: true } }, estimates: true, extras: true, contractor: true, assignee: { select: { id: true, name: true } } }, orderBy: { date: 'asc' },
    });
    // срок подготовки (заезд следующего гостя или конец окна) и можно ли начинать (только в день подготовки)
    const bks = cleaning.length ? await prisma.booking.findMany({ where: { accountId: req.accountId, status: 'confirmed', apartmentId: { in: [...new Set(cleaning.map(c => c.apartmentId))] }, checkIn: { gte: from } }, select: { id: true, apartmentId: true, status: true, checkIn: true, checkInTime: true } }) : [];
    const todayIso = isoDay(today);
    const cl = cleaning.map(c => ({ ...c, deadline: cleaningDeadline(c, bks, req.account.timezone), canStart: isoDay(c.date) <= todayIso, day: isoDay(c.date) }));
    // мастеру — без денег владельца; адрес и «как попасть» — в карточке заявки
    res.json({ today: todayIso, cleaning: cl, repairs: repairs.map(t => taskListItem(t, isManager(req))) });
  });

  const cleaningOut = async (id) => {
    const t = await cleaning.load(id);
    const acc = await prisma.account.findUnique({ where: { id: t.accountId }, select: { timezone: true } });
    const bks = await prisma.booking.findMany({ where: { accountId: t.accountId, apartmentId: t.apartmentId, status: 'confirmed', checkIn: { gte: t.date } }, select: { id: true, apartmentId: true, status: true, checkIn: true, checkInTime: true } });
    // уже известные недочёты квартиры — чтобы не сообщать повторно
    const known = await prisma.defect.findMany({ where: { apartmentId: t.apartmentId, status: 'open', NOT: { cleaningTaskId: t.id } }, orderBy: { createdAt: 'asc' } });
    return {
      ...cleaningReport(t), access: accessInfo(t.apartment), apartment: { id: t.apartment.id, title: t.apartment.title, code: t.apartment.code },
      deadline: cleaningDeadline(t, bks, acc?.timezone || 'Asia/Almaty'), canStart: await canStartCleaning(t), knownDefects: known.map(d => defectOut(d)),
    };
  };
  r.get('/cleaning/:id', async (req, res) => { const t = await ownCleaning(req); res.json(await cleaningOut(t.id)); });
  r.post('/cleaning/:id/status', async (req, res) => {
    const t = await ownCleaning(req);
    const d = parse(z.object({ status: z.enum(['assigned', 'enroute', 'progress', 'done']), report: z.string().max(2000).optional(), checklist: z.array(z.object({ label: z.string(), done: z.boolean() })).optional() }), req.body);
    await cleaning.setStatus(t, d.status, d);
    res.json(await cleaningOut(t.id));
  });
  r.post('/cleaning/:id/start', async (req, res) => { const t = await ownCleaning(req); await cleaning.start(t); res.json(await cleaningOut(t.id)); });
  r.post('/cleaning/:id/check', async (req, res) => {
    const t = await ownCleaning(req);
    const d = parse(z.object({ index: z.number().int().min(0).max(60), done: z.boolean().default(true) }), req.body);
    await cleaning.check(t, d.index, d.done);
    res.json(await cleaningOut(t.id));
  });
  r.post('/cleaning/:id/photos', upload.array('photos', 10), async (req, res) => {
    const t = await ownCleaning(req);
    const d = parse(z.object({ itemIndex: z.coerce.number().int().min(0).max(60).optional(), kind: z.enum(['item', 'general', 'problem']).optional() }), req.body || {});
    const photos = await cleaning.addPhotos(t, { storage, files: req.files, itemIndex: d.itemIndex ?? null, kind: d.kind || 'general', makeKey, looksLikeImage });
    res.status(201).json(photos.map(p => ({ id: p.id, url: p.url, itemIndex: p.itemIndex, kind: p.kind })));
  });
  r.post('/cleaning/:id/problem', async (req, res) => {
    const t = await ownCleaning(req);
    const d = parse(z.object({ text: z.string().trim().min(3, 'Опишите проблему').max(2000), photoIds: z.array(z.string()).max(10).optional(), priority: z.enum(['urgent', 'later']).default('later') }), req.body);
    await cleaning.reportProblem(t, { type: req.role, id: req.user.id, name: req.user.name }, d);
    res.status(201).json(await cleaningOut(t.id));
  });
  r.post('/cleaning/:id/finish', async (req, res) => {
    const t = await ownCleaning(req);
    const d = parse(z.object({ report: z.string().max(2000).optional(), note: z.string().max(1000).optional() }), req.body || {});
    await cleaning.finish(t, d);
    res.json(await cleaningOut(t.id));
  });
  // мои выплаты (любой исполнитель): к оплате / выплачено
  r.get('/payouts', async (req, res) => {
    const contractors = await prisma.contractor.findMany({ where: { accountId: req.accountId, userId: req.user.id }, select: { id: true } });
    const list = await prisma.payout.findMany({ where: { accountId: req.accountId, OR: [{ userId: req.user.id }, ...(contractors.length ? [{ contractorId: { in: contractors.map(c => c.id) } }] : [])] }, orderBy: { createdAt: 'desc' }, take: 200 });
    const out = list.map(p => { const o = payoutOut(p, 0); delete o.overdue; return o; });
    const sum = (st) => out.filter(p => p.status === st).reduce((s, p) => s + p.amountKzt, 0);
    res.json({ pendingKzt: sum('PENDING'), paidKzt: sum('PAID'), items: out });
  });
  // ---------- заявки мастеру ----------
  async function resolve(req, { read = false } = {}) {
    const task = await loadTask({ id: req.params.id, accountId: req.accountId });
    if (!task) throw notFound('Заявка не найдена');
    if (!isExecutor(task, req.user.id)) {
      if (read && isManager(req)) return { task, actor: null, manager: true };
      throw forbidden('Это не ваша заявка');
    }
    return { task, actor: { type: 'master', id: req.user.id, name: task.contractor?.userId === req.user.id ? task.contractor.name : req.user.name } };
  }
  r.get('/repairs/:id', async (req, res, next) => {
    const x = await resolve(req, { read: true });
    if (x.manager) return res.json(taskForManager(x.task, { publicUrl: config.publicUrl }));
    next();
  });
  mountWorkActions(r, { prefix: '/repairs/:id', resolve, workflow, storage, config });
  return r;
}
