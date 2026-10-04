// Заявки мастерам и подрядчикам — сторона владельца и администратора.
//   GET    /api/admin/repairs?status=&apartmentId=   — список (статусы по-русски, флаги «ждёт решения»)
//   POST   /api/admin/repairs                        — создать { apartmentId, title, description, type, priority, assigneeId | contractorId, date, quickJob, occupancy, accessInstructions }
//   GET    /api/admin/repairs/:id                    — карточка: сметы, доп. расходы, фото, журнал шагов, сумма к оплате
//   PATCH  /api/admin/repairs/:id/occupancy          — { occupancy: OWNER_PRESENT|EMPTY|UNKNOWN, accessInstructions } (последнее изменение побеждает)
//   POST   /api/admin/repairs/:id/photos             — фото проблемы (multipart: photos[], captions[]) — для сметы по фото
//   POST   /api/admin/repairs/:id/assign             — { assigneeId | contractorId } выбрать мастера (заявка без исполнителя, например после отказа)
//   POST   /api/admin/repairs/:id/cancel             — { reason }
//   POST   /api/admin/repairs/:id/paid               — отметить «оплачено мастеру» (нельзя при нерешённых доп. расходах)
//   POST   /api/admin/repairs/:id/link               — новая ссылка на задачу без входа (старая перестаёт работать)
//   POST   /api/admin/estimates/:id/approve|reject   — решение по смете { reason } (reason обязателен при отказе)
//   POST   /api/admin/extras/:id/approve|reject      — решение по доп. расходу { note } (note обязателен при отказе)
//   GET    /api/admin/contractors · POST /api/admin/contractors · PATCH /api/admin/contractors/:id  — подрядчики (userId — их вход; canDrive — внешний водитель для трансферов, note — машина)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { notFound, badRequest, forbidden, parse } from '../../lib/errors.js';
import { parseDay, todayIn } from '../../lib/dates.js';
import { randomToken } from '../../lib/tokens.js';
import { imageUpload } from '../../lib/upload.js';
import { makeKey, looksLikeImage } from '../../storage/index.js';
import { canApprove } from '../../services/settings.js';
import { loadTask, taskForManager, taskListItem, STATUSES, OCCUPANCY } from '../../services/workRequests.js';

const TYPES = ['plumb', 'elec', 'appl', 'furn', 'build', 'paint', 'other'];

export default function workRequestsRouter({ workflow, storage, config }) {
  const r = Router();
  const upload = imageUpload({ maxMb: config.storage.maxUploadMb, maxFiles: 20 });
  const actorOf = (req) => ({ type: req.role, id: req.user.id, name: req.user.name });
  const find = async (req, id = req.params.id) => { const t = await loadTask({ id, accountId: req.accountId }); if (!t) throw notFound('Заявка не найдена'); return t; };
  const out = async (res, id, status = 200) => {
    const t = await loadTask({ id });
    res.status(status).json({ ...taskForManager(t, { publicUrl: config.publicUrl }), canDecide: await canApprove(t.accountId, res.req.role) });
  };
  // кто решает по сметам и доп. расходам — настройка владельца (по умолчанию владелец и админ)
  const mayDecide = async (req) => { if (!(await canApprove(req.accountId, req.role))) throw forbidden('Сметы и доп. расходы одобряет только владелец (см. «Настройки»)'); };

  r.get('/repairs', async (req, res) => {
    const where = { accountId: req.accountId };
    if (req.query.status && STATUSES.includes(String(req.query.status))) where.status = String(req.query.status);
    if (req.query.apartmentId) where.apartmentId = String(req.query.apartmentId);
    const list = await prisma.repairTask.findMany({ where, include: { apartment: { select: { id: true, title: true } }, assignee: { select: { id: true, name: true } }, contractor: true, estimates: true, extras: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
    res.json(list.map(t => taskListItem(t, true)));
  });

  r.post('/repairs', async (req, res) => {
    const data = parse(z.object({
      apartmentId: z.string(), title: z.string().min(3).max(160), description: z.string().max(3000).optional(),
      type: z.enum(TYPES).default('other'), priority: z.enum(['low', 'medium', 'high']).default('medium'),
      assigneeId: z.string().optional().nullable(), contractorId: z.string().optional().nullable(), date: z.string().optional(), timeWindow: z.string().max(60).optional(),
      quickJob: z.boolean().default(false), occupancy: z.enum(OCCUPANCY).default('UNKNOWN'), accessInstructions: z.string().max(2000).optional().nullable(),
      blockDays: z.number().int().min(0).max(60).optional(),
    }), req.body);
    if (!(await prisma.apartment.findFirst({ where: { id: data.apartmentId, accountId: req.accountId } }))) throw notFound('Квартира не найдена');
    if (data.assigneeId && data.contractorId) throw badRequest('Назначьте либо мастера из команды, либо подрядчика');
    if (data.assigneeId && !(await prisma.membership.findFirst({ where: { accountId: req.accountId, userId: data.assigneeId, role: 'master', active: true } }))) throw badRequest('Мастер не найден в команде');
    if (data.contractorId && !(await prisma.contractor.findFirst({ where: { id: data.contractorId, accountId: req.accountId } }))) throw badRequest('Подрядчик не найден');
    const t = await workflow.create({ accountId: req.accountId, actor: actorOf(req), data: { ...data, date: (data.date && parseDay(data.date)) || todayIn(req.account.timezone) } });
    await out(res, t.id, 201);
  });

  r.get('/repairs/:id', async (req, res) => { const t = await find(req); await out(res, t.id); });

  r.patch('/repairs/:id/occupancy', async (req, res) => {
    const d = parse(z.object({ occupancy: z.enum(OCCUPANCY).optional(), accessInstructions: z.string().max(2000).optional().nullable() }), req.body);
    if (d.occupancy === undefined && d.accessInstructions === undefined) throw badRequest('Укажите occupancy и/или accessInstructions');
    const t = await find(req);
    await workflow.setOccupancy(t, actorOf(req), d);
    await out(res, t.id);
  });

  r.post('/repairs/:id/photos', upload.array('photos', 20), async (req, res) => {
    const t = await find(req);
    await workflow.addPhotos(t, actorOf(req), { storage, files: req.files, kind: 'problem', captions: [].concat(req.body.captions ?? []), makeKey, looksLikeImage });
    await out(res, t.id, 201);
  });
  r.post('/repairs/:id/assign', async (req, res) => {
    const d = parse(z.object({ assigneeId: z.string().optional().nullable(), contractorId: z.string().optional().nullable() }), req.body || {});
    if (d.assigneeId && d.contractorId) throw badRequest('Назначьте либо мастера из команды, либо подрядчика');
    if (d.assigneeId && !(await prisma.membership.findFirst({ where: { accountId: req.accountId, userId: d.assigneeId, role: { in: ['master', 'owner', 'admin'] }, active: true } }))) throw badRequest('Мастер не найден в команде');
    if (d.contractorId && !(await prisma.contractor.findFirst({ where: { id: d.contractorId, accountId: req.accountId } }))) throw badRequest('Подрядчик не найден');
    const t = await find(req);
    await workflow.assign(t, actorOf(req), d);
    await out(res, t.id);
  });
  r.post('/repairs/:id/cancel', async (req, res) => {
    const t = await find(req);
    await workflow.cancel(t, actorOf(req), parse(z.object({ reason: z.string().max(500).optional() }), req.body || {}).reason);
    await out(res, t.id);
  });
  r.post('/repairs/:id/paid', async (req, res) => { const t = await find(req); await workflow.markPaid(t, actorOf(req)); await out(res, t.id); });
  r.post('/repairs/:id/link', async (req, res) => {
    const t = await find(req);
    await prisma.repairTask.update({ where: { id: t.id }, data: { linkToken: randomToken(18) } });
    await out(res, t.id);
  });

  r.post('/estimates/:id/:decision', async (req, res) => {
    if (!['approve', 'reject'].includes(req.params.decision)) throw notFound('Нет такого действия');
    await mayDecide(req);
    const est = await prisma.repairEstimate.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!est) throw notFound('Смета не найдена');
    const t = await find(req, est.repairTaskId);
    const { reason } = parse(z.object({ reason: z.string().max(1000).optional() }), req.body || {});
    await workflow.decideEstimate(est, t, actorOf(req), req.params.decision === 'approve', reason);
    await out(res, t.id);
  });
  r.post('/extras/:id/:decision', async (req, res) => {
    if (!['approve', 'reject'].includes(req.params.decision)) throw notFound('Нет такого действия');
    await mayDecide(req);
    const x = await prisma.extraExpense.findFirst({ where: { id: req.params.id, accountId: req.accountId } });
    if (!x) throw notFound('Расход не найден');
    const t = await find(req, x.repairTaskId);
    const { note } = parse(z.object({ note: z.string().max(1000).optional() }), req.body || {});
    await workflow.decideExtra(x, t, actorOf(req), req.params.decision === 'approve', note);
    await out(res, t.id);
  });

  // ---------- подрядчики ----------
  const ContractorSchema = z.object({ name: z.string().min(2).max(100), type: z.enum(TYPES), phone: z.string().max(40).optional().nullable(), note: z.string().max(500).optional().nullable(), regular: z.boolean().optional(), canDrive: z.boolean().optional(), userId: z.string().optional().nullable(),
    payoutPercent: z.number().min(0).max(100).nullable().optional(), payoutFixedKzt: z.number().int().min(0).max(10000000).nullable().optional() });
  const ownerMoney = (req, d) => { if ((d.payoutPercent !== undefined || d.payoutFixedKzt !== undefined) && req.role !== 'owner') throw forbidden('Ставку водителя меняет только владелец'); };
  const checkUser = async (req, userId) => {
    if (userId && !(await prisma.membership.findFirst({ where: { accountId: req.accountId, userId, role: 'master', active: true } }))) throw badRequest('Вход подрядчика: нужен пользователь с ролью «Мастер» в этом аккаунте');
  };
  r.get('/contractors', async (req, res) => res.json(await prisma.contractor.findMany({ where: { accountId: req.accountId }, orderBy: { name: 'asc' } })));
  r.post('/contractors', async (req, res) => {
    const data = parse(ContractorSchema, req.body); ownerMoney(req, data); await checkUser(req, data.userId);
    res.status(201).json(await prisma.contractor.create({ data: { ...data, accountId: req.accountId } }));
  });
  r.patch('/contractors/:id', async (req, res) => {
    const c = await prisma.contractor.findFirst({ where: { id: req.params.id, accountId: req.accountId } }); if (!c) throw notFound('Подрядчик не найден');
    const data = parse(ContractorSchema.partial(), req.body); ownerMoney(req, data); await checkUser(req, data.userId);
    res.json(await prisma.contractor.update({ where: { id: c.id }, data }));
  });
  return r;
}
