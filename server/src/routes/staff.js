// Приложение команды: каждый видит только свои задачи.
//   GET  /api/staff/tasks                         — мои уборки (клининг) / мои ремонты (мастер); владелец/админ — все на сегодня
//   GET  /api/staff/cleaning/:id                  — карточка уборки с доступом в квартиру (только исполнителю и менеджерам)
//   POST /api/staff/cleaning/:id/status           — { status: enroute|progress|done, report }
//   POST /api/staff/repairs/:id/status            — { status: progress|done, report }
//   POST /api/staff/repairs/:id/estimate          — { workKzt, partsKzt, items } — смета на одобрение
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { forbidden, notFound, parse } from '../lib/errors.js';
import { accessInfo } from '../lib/serialize.js';
import { todayIn, addDays, parseDay } from '../lib/dates.js';
import { MANAGERS } from '../auth/roles.js';

export default function staffRouter({ events }) {
  const r = Router();
  const isManager = (req) => MANAGERS.includes(req.role);

  async function ownCleaning(req) {
    const t = await prisma.cleaningTask.findFirst({ where: { id: req.params.id, accountId: req.accountId }, include: { apartment: true } });
    if (!t) throw notFound('Уборка не найдена');
    if (!isManager(req) && t.assigneeId !== req.user.id) throw forbidden('Это не ваша задача');
    return t;
  }
  async function ownRepair(req) {
    const t = await prisma.repairTask.findFirst({ where: { id: req.params.id, accountId: req.accountId }, include: { apartment: true } });
    if (!t) throw notFound('Задача не найдена');
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
    const repairs = req.role === 'cleaning' ? [] : await prisma.repairTask.findMany({ where: { accountId: req.accountId, status: { not: 'done' }, ...mine }, include: { apartment: aptSel, estimates: true }, orderBy: { date: 'asc' } });
    // никаких денег, кроме смет по своим задачам
    res.json({ cleaning, repairs: repairs.map(({ costKzt, paid, ...t }) => (isManager(req) ? { ...t, costKzt, paid } : t)) });
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
  r.get('/repairs/:id', async (req, res) => {
    const t = await ownRepair(req);
    res.json({ ...t, apartment: { id: t.apartment.id, title: t.apartment.title }, access: t.accessMode === 'code' ? accessInfo(t.apartment) : { address: t.apartment.address, accessNote: t.accessNote } });
  });
  r.post('/repairs/:id/status', async (req, res) => {
    const t = await ownRepair(req);
    const d = parse(z.object({ status: z.enum(['open', 'progress', 'done']), report: z.string().max(2000).optional() }), req.body);
    const u = await prisma.repairTask.update({ where: { id: t.id }, data: { status: d.status, report: d.report ?? t.report, doneAt: d.status === 'done' ? new Date() : null } });
    events.emit('repair.reported', { accountId: req.accountId, taskId: t.id });
    res.json(u);
  });
  r.post('/repairs/:id/estimate', async (req, res) => {
    const t = await ownRepair(req);
    const d = parse(z.object({ workKzt: z.number().int().min(0).max(100_000_000), partsKzt: z.number().int().min(0).max(100_000_000), items: z.string().max(1000).optional() }), req.body);
    const est = await prisma.repairEstimate.create({ data: { ...d, accountId: req.accountId, repairTaskId: t.id, byName: req.user.name } });
    events.emit('estimate.submitted', { accountId: req.accountId, estimateId: est.id });
    res.status(201).json(est);
  });
  return r;
}
