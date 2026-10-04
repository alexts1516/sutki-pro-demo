// Заявки мастерам и подрядчикам (сантехник, электрик, строитель, маляр… — правила одни для всех).
// Здесь вся «машина состояний»: какие шаги разрешены в каком статусе и кем. Маршруты API только вызывают эти функции,
// поэтому правило «без одобренной сметы работу не начать» нельзя обойти ни из админки, ни из приложения мастера, ни по ссылке.
//
//  NEW ─┬─ смета без выезда (REMOTE) или по фото (PHOTOS) ─────────────────────────► AWAITING_OWNER_APPROVAL
//       └─ «нужен выезд» / «приехал» ─► VISIT_INSPECTION ─ осмотр, смета (VISIT) ─► AWAITING_OWNER_APPROVAL
//  AWAITING_OWNER_APPROVAL ─ одобрено ─► APPROVED ─ мастер начал ─► IN_PROGRESS ─ итог + отчёт (+ фото) ─► DONE
//  AWAITING_OWNER_APPROVAL ─ отклонено ─► REJECTED ─┬ «Исправить смету» ─► AWAITING_OWNER_APPROVAL (или «нужен выезд» ─► VISIT_INSPECTION)
//                                                   └ «Отказаться от заявки» (с причиной) ─► NEW без исполнителя (владелец выберет другого)
//  «Я приехал» — по желанию, одно нажатие (обязателен только для сметы после осмотра и простой работы).
//  quickJob (простая работа): VISIT_INSPECTION + отмечен приезд ─► IN_PROGRESS без сметы; итоговая цена обязательна.
//  Любой незавершённый статус ─ отмена владельцем/админом ─► CANCELLED.
//  Доп. расходы (не по вине мастера) — только в IN_PROGRESS; решает владелец/админ, одобренные прибавляются к сумме.
//  Нерешённые доп. расходы не мешают завершить работу, но отметить «оплачено» нельзя, пока они не решены.
import { prisma } from '../db.js';
import { HttpError, badRequest, forbidden } from '../lib/errors.js';
import { randomToken } from '../lib/tokens.js';

export const STATUSES = ['NEW', 'VISIT_INSPECTION', 'AWAITING_OWNER_APPROVAL', 'REJECTED', 'APPROVED', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
export const STATUS_RU = {
  NEW: 'Новая', VISIT_INSPECTION: 'Выезд / осмотр', AWAITING_OWNER_APPROVAL: 'Ждёт одобрения сметы', REJECTED: 'Смета отклонена',
  APPROVED: 'Смета одобрена', IN_PROGRESS: 'В работе', DONE: 'Выполнена', CANCELLED: 'Отменена',
};
export const METHODS = ['REMOTE', 'PHOTOS', 'VISIT'];
export const METHOD_RU = { REMOTE: 'без выезда, по описанию', PHOTOS: 'по фото', VISIT: 'после осмотра на месте' };
export const OCCUPANCY = ['OWNER_PRESENT', 'EMPTY', 'UNKNOWN'];
export const OCCUPANCY_RU = { OWNER_PRESENT: 'Владелец будет', EMPTY: 'Квартира пустая', UNKNOWN: 'Пока неизвестно' };
/** Пока заявка в этих статусах, назначенный мастер видит адрес, номер квартиры и «Как попасть» */
export const ACTIVE = ['NEW', 'VISIT_INSPECTION', 'AWAITING_OWNER_APPROVAL', 'REJECTED', 'APPROVED', 'IN_PROGRESS'];
export const MASTER_PHOTO_KINDS = ['arrival', 'inspection', 'after', 'receipt'];
const MANAGER_TYPES = ['owner', 'admin'];

const conflict = (msg) => new HttpError(409, msg);
const need = (task, list, msg) => { if (!list.includes(task.status)) throw conflict(msg || `Действие недоступно в статусе «${STATUS_RU[task.status]}»`); };

export const fullInclude = {
  apartment: true, contractor: true, assignee: { select: { id: true, name: true } }, occupancyUpdatedBy: { select: { id: true, name: true } },
  estimates: { orderBy: { createdAt: 'asc' } }, extras: { orderBy: { createdAt: 'asc' }, include: { photos: true } },
  photos: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { createdAt: 'asc' } },
};
export const loadTask = (where) => prisma.repairTask.findFirst({ where, include: fullInclude });

/** Исполнитель заявки — мастер из команды (assigneeId) или пользователь подрядчика (contractor.userId) */
export const isExecutor = (task, userId) => !!userId && (task.assigneeId === userId || task.contractor?.userId === userId);
export const executorWhere = (userId) => ({ OR: [{ assigneeId: userId }, { contractor: { userId } }] });

export const estimateTotal = (e) => (e ? e.workKzt + (e.partsKzt || 0) : 0);
export const approvedEstimate = (task) => [...(task.estimates || [])].reverse().find(e => e.status === 'approved') || null;
export const pendingExtras = (task) => (task.extras || []).filter(x => x.status === 'PENDING');
export const approvedExtrasKzt = (task) => (task.extras || []).filter(x => x.status === 'APPROVED').reduce((s, x) => s + x.amountKzt, 0);
/** К оплате: итог мастера (до завершения — одобренная смета) + одобренные доп. расходы */
export function payable(task) {
  const est = approvedEstimate(task);
  const base = task.finalCostKzt ?? (est ? estimateTotal(est) : null);
  const extras = approvedExtrasKzt(task);
  return base == null && !extras ? null : (base || 0) + extras;
}

/** Какие шаги сейчас доступны исполнителю (для кнопок в приложении мастера) */
export function masterActions(task) {
  const s = task.status, a = [];
  // после отказа владельца — ровно два действия: исправить смету или отказаться (+ маленькая ссылка «нужен выезд»)
  if (s === 'REJECTED') return ['revise', 'decline', 'request-visit'];
  if (s === 'NEW') a.push('estimate:REMOTE', ...(task.photos?.some(p => p.kind === 'problem') ? ['estimate:PHOTOS'] : []), 'request-visit');
  if (['NEW', 'VISIT_INSPECTION', 'APPROVED'].includes(s) && !task.arrivedAt) a.push('arrive');
  if (s === 'VISIT_INSPECTION' && task.arrivedAt) a.push('inspect', 'estimate:VISIT');
  if (s === 'APPROVED' || (s === 'VISIT_INSPECTION' && task.quickJob && task.arrivedAt)) a.push('start');
  if (s === 'IN_PROGRESS') a.push('extra', 'complete');
  return [...new Set(a)];
}

async function log(task, actor, type, note = null, data = null) {
  return prisma.repairEvent.create({ data: { accountId: task.accountId, repairTaskId: task.id, type, actorType: actor.type, actorId: actor.id || null, actorName: actor.name || null, note: note || null, data: data || undefined } });
}
async function attachPhotos(task, ids, kinds, extraId = null) {
  if (!ids?.length) return [];
  const list = await prisma.repairPhoto.findMany({ where: { id: { in: ids }, repairTaskId: task.id } });
  if (list.length !== new Set(ids).size) throw badRequest('Фото не найдено в этой заявке');
  if (list.some(p => !kinds.includes(p.kind))) throw badRequest(`Здесь можно прикрепить только фото типа: ${kinds.join(', ')}`);
  if (extraId) await prisma.repairPhoto.updateMany({ where: { id: { in: ids } }, data: { extraId } });
  return ids;
}
async function recalc(taskId) {
  const t = await prisma.repairTask.findUnique({ where: { id: taskId }, include: { estimates: true, extras: true } });
  return prisma.repairTask.update({ where: { id: taskId }, data: { costKzt: t.status === 'CANCELLED' ? null : payable(t) } });
}
const setStatus = (task, status, extra = {}) => prisma.repairTask.update({ where: { id: task.id }, data: { status, ...extra } });

/** Последняя смета (для «Исправить смету» — тем же способом) */
export const lastEstimate = (task) => [...(task.estimates || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).at(-1) || null;

export function createWorkflow({ events, payouts = null }) {
  const emit = (name, payload) => events?.emit(name, payload);

  const wf = {
    /** Владелец/админ создаёт заявку (сразу можно указать, кто будет в квартире, и «Как попасть») */
    async create({ accountId, actor, data }) {
      const { occupancy = 'UNKNOWN', accessInstructions = null, ...rest } = data;
      const t = await prisma.repairTask.create({
        data: {
          ...rest, accountId, status: 'NEW', linkToken: randomToken(18), createdById: actor.id || null, occupancy, accessInstructions,
          occupancyUpdatedById: actor.id || null, occupancyUpdatedAt: new Date(),
        },
      });
      await log(t, actor, 'created', null, { quickJob: t.quickJob });
      await log(t, actor, 'occupancy_changed', null, { from: null, to: occupancy, instructions: !!accessInstructions });
      emit('repair.assigned', { accountId, taskId: t.id });
      return t;
    },

    /** Кто будет в квартире + «Как попасть». Меняют владелец и админ; последнее изменение побеждает. */
    async setOccupancy(task, actor, { occupancy, accessInstructions }) {
      if (!MANAGER_TYPES.includes(actor.type)) throw forbidden('Менять это поле могут только владелец и администратор');
      const data = { occupancyUpdatedById: actor.id, occupancyUpdatedAt: new Date() };
      if (occupancy !== undefined) data.occupancy = occupancy;
      if (accessInstructions !== undefined) data.accessInstructions = accessInstructions || null;
      const u = await prisma.repairTask.update({ where: { id: task.id }, data });
      await log(task, actor, 'occupancy_changed', null, { from: task.occupancy, to: u.occupancy, instructions: accessInstructions !== undefined });
      emit('repair.occupancy_changed', { accountId: task.accountId, taskId: task.id });
      return u;
    },

    /** Мастер: не может оценить удалённо/по фото — нужен выезд */
    async requestVisit(task, actor, { note } = {}) {
      need(task, ['NEW', 'REJECTED'], 'Запросить выезд можно у новой заявки или после отклонённой сметы');
      await setStatus(task, 'VISIT_INSPECTION', { visitRequestedAt: new Date() });
      await log(task, actor, 'visit_requested', note);
      emit('repair.visit_requested', { accountId: task.accountId, taskId: task.id });
    },

    /** Мастер приехал (время, заметка, фото). Из NEW/REJECTED заявка переходит в «Выезд / осмотр» */
    async arrive(task, actor, { note, photoIds } = {}) {
      need(task, ['NEW', 'VISIT_INSPECTION', 'REJECTED', 'APPROVED'], 'Отметить приезд можно до начала работ');
      await attachPhotos(task, photoIds, ['arrival']);
      await setStatus(task, task.status === 'APPROVED' ? 'APPROVED' : 'VISIT_INSPECTION', { arrivedAt: new Date() });
      await log(task, actor, 'arrived', note, photoIds?.length ? { photoIds } : null);
    },

    async inspect(task, actor, { notes, photoIds } = {}) {
      need(task, ['VISIT_INSPECTION', 'REJECTED'], 'Осмотр записывается во время выезда');
      if (!task.arrivedAt) throw conflict('Сначала отметьте приезд');
      await attachPhotos(task, photoIds, ['inspection', 'arrival']);
      await prisma.repairTask.update({ where: { id: task.id }, data: { inspectionNotes: notes } });
      await log(task, actor, 'inspected', notes, photoIds?.length ? { photoIds } : null);
    },

    /** Смета: REMOTE (по описанию), PHOTOS (по фото от владельца), VISIT (после осмотра). Материалы — по желанию. */
    async submitEstimate(task, actor, d) {
      if (d.method === 'VISIT') {
        need(task, ['VISIT_INSPECTION', 'REJECTED'], 'Смета после осмотра — во время выезда');
        if (!task.arrivedAt) throw conflict('Смета после осмотра: сначала отметьте приезд');
      } else {
        need(task, ['NEW', 'REJECTED'], 'Смета без выезда или по фото — для новой заявки или после отклонения');
        if (d.method === 'PHOTOS' && !task.photos.some(p => p.kind === 'problem')) throw conflict('К заявке не приложены фото проблемы — оцените по описанию или запросите выезд');
      }
      if (!d.materialsIncluded && d.materialsKzt) throw badRequest('Указана сумма материалов, но не отмечено «материалы входят в цену»');
      const parts = d.materialsIncluded ? (d.materialsKzt ?? 0) : 0;
      const total = d.labourKzt + parts;
      if (d.maxKzt != null && d.maxKzt < total) throw badRequest('Верхняя граница цены меньше нижней');
      const est = await prisma.repairEstimate.create({
        data: {
          accountId: task.accountId, repairTaskId: task.id, method: d.method, workKzt: d.labourKzt, partsKzt: parts, materialsIncluded: !!d.materialsIncluded,
          maxKzt: d.maxKzt ?? null, preliminary: true, items: d.items || null, comment: d.comment || null, byName: actor.name, byUserId: actor.id || null,
        },
      });
      await setStatus(task, 'AWAITING_OWNER_APPROVAL');
      await log(task, actor, 'estimate_submitted', d.comment, { estimateId: est.id, method: d.method, totalKzt: total, maxKzt: d.maxKzt ?? null, materialsIncluded: !!d.materialsIncluded });
      emit('estimate.submitted', { accountId: task.accountId, estimateId: est.id });
      return est;
    },

    /** Владелец/админ одобряет или отклоняет смету */
    async decideEstimate(est, task, actor, approve, reason) {
      if (est.status !== 'pending') throw conflict('Смета уже рассмотрена');
      need(task, ['AWAITING_OWNER_APPROVAL'], 'Заявка не ждёт решения по смете');
      if (!approve && !reason?.trim()) throw badRequest('Напишите мастеру, почему смета отклонена');
      const u = await prisma.repairEstimate.update({ where: { id: est.id }, data: { status: approve ? 'approved' : 'rejected', rejectReason: approve ? null : reason, decidedAt: new Date(), decidedById: actor.id } });
      await setStatus(task, approve ? 'APPROVED' : 'REJECTED');
      await log(task, actor, approve ? 'approved' : 'rejected', approve ? null : reason, { estimateId: est.id, totalKzt: estimateTotal(est) });
      await recalc(task.id);
      emit('estimate.decided', { accountId: task.accountId, estimateId: est.id });
      return u;
    },

    /** Начать работу: только после одобренной сметы; исключение — quickJob с отмеченным приездом */
    async start(task, actor) {
      const quick = task.quickJob && task.status === 'VISIT_INSPECTION';
      if (task.quickJob && task.status === 'NEW') throw conflict('Простая работа: сначала отметьте приезд, потом начинайте');
      if (!quick && (task.status !== 'APPROVED' || !approvedEstimate(task))) throw conflict('Нельзя начать работу без одобренной хозяином сметы');
      if (quick && !task.arrivedAt) throw conflict('Простая работа: сначала отметьте приезд, потом начинайте');
      // приезд не обязателен (смета без выезда / по фото): время начала — отдельно, приезд не подставляем
      await setStatus(task, 'IN_PROGRESS', { startedAt: new Date() });
      await log(task, actor, 'started', null, quick ? { quickJob: true } : { estimateId: approvedEstimate(task).id });
    },

    /** Доп. расход во время работ (не по вине мастера) */
    async addExtra(task, actor, d) {
      need(task, ['IN_PROGRESS'], 'Доп. расходы добавляются во время работ');
      if (d.photoIds?.length) await attachPhotos(task, d.photoIds, ['receipt', 'inspection', 'after']);
      const x = await prisma.extraExpense.create({ data: { accountId: task.accountId, repairTaskId: task.id, amountKzt: d.amountKzt, description: d.description, reason: d.reason, byName: actor.name, byUserId: actor.id || null } });
      await attachPhotos(task, d.photoIds, ['receipt', 'inspection', 'after'], x.id);
      await log(task, actor, 'extra_submitted', d.description, { extraId: x.id, amountKzt: d.amountKzt, reason: d.reason });
      emit('extra.submitted', { accountId: task.accountId, extraId: x.id });
      return x;
    },

    async decideExtra(extra, task, actor, approve, note) {
      if (extra.status !== 'PENDING') throw conflict('Расход уже рассмотрен');
      if (task.status === 'CANCELLED') throw conflict('Заявка отменена');
      if (task.paid) throw conflict('Заявка уже оплачена');
      if (!approve && !note?.trim()) throw badRequest('Напишите мастеру, почему расход отклонён');
      const u = await prisma.extraExpense.update({ where: { id: extra.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decisionNote: note || null, decidedAt: new Date(), decidedById: actor.id } });
      await log(task, actor, approve ? 'extra_approved' : 'extra_rejected', note, { extraId: extra.id, amountKzt: extra.amountKzt });
      await recalc(task.id);
      if (task.status === 'DONE') await payouts?.forRepair(task.id);   // итог изменился — пересчитать «к оплате»
      emit('extra.decided', { accountId: task.accountId, extraId: extra.id });
      return u;
    },

    /** Завершение: итоговая цена основной работы и отчёт обязательны, фото «после» — по желанию */
    async complete(task, actor, { finalCostKzt, report, photoIds }) {
      need(task, ['IN_PROGRESS'], 'Завершить можно только работу в статусе «В работе»');
      await attachPhotos(task, photoIds, ['after']);
      await setStatus(task, 'DONE', { finalCostKzt, report, doneAt: new Date() });
      await log(task, actor, 'completed', report, { finalCostKzt, photoIds: photoIds || [], pendingExtras: pendingExtras(task).length });
      const t = await recalc(task.id);
      await payouts?.forRepair(task.id);   // сразу «к оплате» мастеру (если работу делал не владелец)
      emit('repair.reported', { accountId: task.accountId, taskId: task.id });
      return t;
    },

    async cancel(task, actor, reason) {
      need(task, ACTIVE, 'Заявка уже закрыта');
      await setStatus(task, 'CANCELLED', { cancelReason: reason || null });
      await log(task, actor, 'cancelled', reason);
      await recalc(task.id);
      emit('repair.cancelled', { accountId: task.accountId, taskId: task.id });
    },

    /** «Оплачено мастеру»: только выполненная заявка без нерешённых доп. расходов */
    async markPaid(task, actor) {
      need(task, ['DONE'], 'Оплатить можно только выполненную заявку');
      if (pendingExtras(task).length) throw conflict('Сначала одобрите или отклоните доп. расходы — потом отмечайте оплату');
      if (task.paid) throw conflict('Уже отмечено как оплаченное');
      const now = new Date();
      await prisma.repairTask.update({ where: { id: task.id }, data: { paid: true, paidAt: now } });
      await prisma.payout.updateMany({ where: { repairTaskId: task.id, status: 'PENDING' }, data: { status: 'PAID', method: 'cash', paidAt: now, paidById: actor.id || null, paidByName: actor.name || null } });
      await log(task, actor, 'paid', null, { amountKzt: payable(task) });
    },

    /** Мастер отказался от заявки после отклонённой сметы: заявка возвращается владельцу без исполнителя */
    async decline(task, actor, { reason }) {
      need(task, ['REJECTED'], 'Отказаться можно после отклонённой сметы');
      if (!reason?.trim()) throw badRequest('Напишите причину отказа');
      await setStatus(task, 'NEW', { assigneeId: null, contractorId: null, assigneeLabel: null, declinedAt: new Date(), arrivedAt: null, visitRequestedAt: null, linkToken: randomToken(18) });
      await log(task, actor, 'declined', reason.trim());
      emit('repair.declined', { accountId: task.accountId, taskId: task.id, by: actor.name, reason: reason.trim() });
    },

    /** Владелец/админ выбирает мастера (или подрядчика) для заявки без исполнителя / меняет до начала работ */
    async assign(task, actor, { assigneeId = null, contractorId = null }) {
      need(task, ['NEW', 'VISIT_INSPECTION', 'REJECTED'], 'Сменить мастера можно до одобрения сметы');
      if (!assigneeId && !contractorId) throw badRequest('Выберите мастера');
      await setStatus(task, 'NEW', { assigneeId, contractorId, assigneeLabel: null, arrivedAt: null, visitRequestedAt: null, linkToken: randomToken(18) });
      await log(task, actor, 'assigned');
      emit('repair.assigned', { accountId: task.accountId, taskId: task.id });
    },

    /** Фото к заявке. problem — только владелец/админ; остальные типы — исполнитель */
    async addPhotos(task, actor, { storage, files, kind, captions = [], makeKey, looksLikeImage }) {
      const isManager = MANAGER_TYPES.includes(actor.type);
      if (kind === 'problem' ? !isManager : (isManager || !MASTER_PHOTO_KINDS.includes(kind))) throw forbidden(kind === 'problem' ? 'Фото проблемы добавляет владелец или админ' : 'Неверный тип фото');
      if (!ACTIVE.includes(task.status)) throw conflict('Заявка закрыта');
      if (!files?.length) throw badRequest('Выберите хотя бы одно фото (поле photos)');
      const out = [];
      for (const [i, f] of files.entries()) {
        if (!looksLikeImage(f.buffer)) throw badRequest(`Файл «${f.originalname}» не похож на картинку`);
        const saved = await storage.save(makeKey(task.accountId, `repairs/${task.id}`, f.mimetype, f.originalname), f.buffer, f.mimetype);
        out.push(await prisma.repairPhoto.create({ data: { accountId: task.accountId, repairTaskId: task.id, kind, url: saved.url, storageKey: saved.key, caption: String(captions[i] ?? '').slice(0, 120), uploadedBy: actor.type, mimeType: f.mimetype } }));
      }
      return out;
    },
  };
  return wf;
}

// ---------- что отдаём наружу ----------
const photoOut = (p) => ({ id: p.id, kind: p.kind, url: p.url, caption: p.caption, extraId: p.extraId, createdAt: p.createdAt });
export const estimateOut = (e) => ({
  id: e.id, method: e.method, methodLabel: METHOD_RU[e.method], labourKzt: e.workKzt, materialsKzt: e.materialsIncluded ? e.partsKzt : null, materialsIncluded: e.materialsIncluded,
  totalKzt: estimateTotal(e), maxKzt: e.maxKzt, preliminary: e.preliminary, items: e.items, comment: e.comment, byName: e.byName,
  status: e.status, rejectReason: e.rejectReason, decidedAt: e.decidedAt, createdAt: e.createdAt,
});
export const extraOut = (x) => ({ id: x.id, amountKzt: x.amountKzt, description: x.description, reason: x.reason, status: x.status, byName: x.byName, decisionNote: x.decisionNote, decidedAt: x.decidedAt, createdAt: x.createdAt, photos: (x.photos || []).map(photoOut) });
const eventOut = (ev) => ({ id: ev.id, type: ev.type, actorType: ev.actorType, actorName: ev.actorName, note: ev.note, data: ev.data, createdAt: ev.createdAt });
const executorOut = (t) => (t.contractor ? { kind: 'contractor', id: t.contractor.id, name: t.contractor.name, phone: t.contractor.phone, hasLogin: !!t.contractor.userId }
  : t.assignee ? { kind: 'master', id: t.assignee.id, name: t.assignee.name } : (t.assigneeLabel ? { kind: 'label', name: t.assigneeLabel } : null));
const occupancyOut = (t, showInstructions) => ({
  status: t.occupancy, label: OCCUPANCY_RU[t.occupancy], updatedAt: t.occupancyUpdatedAt,
  updatedBy: t.occupancyUpdatedBy ? { id: t.occupancyUpdatedBy.id, name: t.occupancyUpdatedBy.name } : null,
  ...(showInstructions ? { accessInstructions: t.accessInstructions || null } : {}),
});

/** Для мастера: ТОЛЬКО адрес и номер квартиры, «Как попасть» — только при «квартира пустая»; всё — пока заявка активна */
export function masterAccess(t) {
  if (!ACTIVE.includes(t.status)) return null;
  return { address: t.apartment.address, apartmentNumber: t.apartment.code || null };
}

function common(t) {
  return {
    id: t.id, title: t.title, description: t.description, type: t.type, priority: t.priority, status: t.status, statusLabel: STATUS_RU[t.status],
    quickJob: t.quickJob, date: t.date, timeWindow: t.timeWindow, visitRequestedAt: t.visitRequestedAt, arrivedAt: t.arrivedAt, inspectionNotes: t.inspectionNotes,
    startedAt: t.startedAt, declinedAt: t.declinedAt, finalCostKzt: t.finalCostKzt, report: t.report, doneAt: t.doneAt, cancelReason: t.cancelReason,
    estimates: (t.estimates || []).map(estimateOut), extras: (t.extras || []).map(extraOut), photos: (t.photos || []).map(photoOut),
    events: (t.events || []).map(eventOut), executor: executorOut(t), createdAt: t.createdAt,
  };
}
/** Для мастера/подрядчика (только своя заявка): без финансов владельца и без кодов, Wi‑Fi и прочих полей квартиры */
export function taskForMaster(t) {
  const active = ACTIVE.includes(t.status);
  return {
    ...common(t), apartment: { id: t.apartment.id, title: t.apartment.title, complex: t.apartment.complex }, access: masterAccess(t),
    occupancy: occupancyOut(t, active && t.occupancy === 'EMPTY'),
    payableKzt: t.status === 'DONE' ? payable(t) : null, actions: active ? masterActions(t) : [],
  };
}
/** Для владельца/админа */
export function taskForManager(t, { publicUrl = '' } = {}) {
  return {
    ...common(t), apartment: { id: t.apartment.id, title: t.apartment.title, address: t.apartment.address, apartmentNumber: t.apartment.code },
    occupancy: occupancyOut(t, true), accessMode: t.accessMode, accessNote: t.accessNote,
    costKzt: t.costKzt, payableKzt: payable(t), paid: t.paid, paidAt: t.paidAt,
    pendingEstimate: (t.estimates || []).some(e => e.status === 'pending'), pendingExtras: pendingExtras(t).length,
    link: t.linkToken ? { token: t.linkToken, url: `${publicUrl}/link/${t.linkToken}`, api: `${publicUrl}/api/task-link/${t.linkToken}` } : null,
  };
}
/** Короткая строка для списков */
export function taskListItem(t, forManager) {
  return {
    id: t.id, title: t.title, type: t.type, priority: t.priority, status: t.status, statusLabel: STATUS_RU[t.status], quickJob: t.quickJob, date: t.date,
    apartment: { id: t.apartment.id, title: t.apartment.title }, executor: executorOut(t), occupancy: t.occupancy,
    pendingEstimate: (t.estimates || []).some(e => e.status === 'pending'), pendingExtras: pendingExtras(t).length,
    ...(forManager ? { costKzt: t.costKzt, paid: t.paid } : {}),
  };
}
