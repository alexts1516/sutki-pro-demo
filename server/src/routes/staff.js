// Приложение команды: каждый видит только свои задачи.
//   GET  /api/staff/tasks                         — мои уборки (клининг) / мои заявки (мастер, подрядчик); владелец/админ — все
//   GET  /api/staff/cleaning/:id                  — карточка уборки с доступом в квартиру (только исполнителю и менеджерам)
//   POST /api/staff/cleaning/:id/status           — { status: enroute|progress|done, report }
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
import { loadTask, isExecutor, executorWhere, taskListItem, taskForManager } from '../services/workRequests.js';

export default function staffRouter({ events, workflow, storage, config }) {
  const r = Router();
  const isManager = (req) => MANAGERS.includes(req.role);

  async function ownCleaning(req) {
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId }, include: { apartment: true } });
    if (!t) throw notFound('Уборка не найдена');
    if (!isManager(req) && t.assigneeId !== req.user.id) throw forbidden('Это не ваша задача');
    return t;
  }

  r.get('/tasks', async (req, res) => {
    const today = todayIn(req.account.timezone);
    const from = (req.query.date && parseDay(req.query.date)) || addDays(today, -1);
    const to = addDays(from, req.query.date ? 1 : 3);
    const mine = isManager(req) ? {} : { assigneeId: req.user.id };
    const aptSel = { select: { id: true, title: true, address: true } };
    const cleaning = req.role === 'master' ? [] : await prisma.cleaningTask.findMany({ where: { accountId: req.accountId, date: { gte: from, lt: to }, ...mine }, include: { apartment: aptSel }, orderBy: [{ date: 'asc' }, { fromTime: 'asc' }] });
    const repairs = req.role === 'cleaning' ? [] : await prisma.repairTask.findMany({
      where: { accountId: req.accountId, status: { notIn: ['DONE', 'CANCELLED'] }, ...(isManager(req) ? {} : executorWhere(req.user.id)) },
      include: { apartment: { select: { id: true, title: true } }, estimates: true, extras: true, contractor: true, assignee: { select: { id: true, name: true } } }, orderBy: { date: 'asc' },
    });
    // мастеру — без денег владельца; адрес и «как попасть» — в карточке заявки
    res.json({ cleaning, repairs: repairs.map(t => taskListItem(t, isManager(req))) });
  });

  r.get('/cleaning/:id', async (req, res) => {
    const t = await ownCleaning(req);
    res.json({ ...t, apartment: { id: t.apartment.id, title: t.apartment.title }, access: accessInfo(t.apartment) });
  });
  r.post('/cleaning/:id/status', async (req, res) => {
    const t = await ownCleaning(req);
    const d = parse(z.object({ status: z.enum(['assigned', 'enroute', 'progress', 'done']), report: z.string().max(2000).optional(), checklist: z.array(z.object({ label: z.string(), done: z.boolean() })).optional() }), req.body);
    const u = await prisma.cleaningTask.update({ where: { id: t.id }, data: { status: d.status, report: d.report ?? t.report, checklist: d.checklist ?? undefined, doneAt: d.status === 'done' ? new Date() : null } });
    if (d.status === 'done' || d.report) events.emit('cleaning.reported', { accountId: req.accountId, taskId: t.id });
    res.json(u);
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
