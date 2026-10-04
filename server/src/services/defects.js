// Недочёты в квартире: нашли при подготовке (или владелец/админ добавил сам) — висят, пока не решены.
//   open ─ «Заявка мастеру» ─► open + repairTaskId (закроется сам, когда мастер завершит работу; отменят заявку — снова просто open)
//   open ─ «Сделаю сам» ─► open + кто взялся ─ «Решено» ─► resolved
//   open ─ «Решено» ─► resolved
// Срочный (urgent) открытый недочёт — квартира «не готова» (см. services/ops.js).
import { prisma } from '../db.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';

export const PRIORITIES = ['urgent', 'later'];
export const PRIORITY_RU = { urgent: 'срочно', later: 'можно позже' };
const conflict = (m) => new HttpError(409, m);
const DUP_MS = 10 * 60000;   // тот же текст по той же квартире за 10 минут — это повтор (двойное нажатие, повторная отправка формы)
const ACTIVE_REPAIR = ['NEW', 'VISIT_INSPECTION', 'AWAITING_OWNER_APPROVAL', 'APPROVED', 'REJECTED', 'IN_PROGRESS'];
// «Заявка мастеру» по одному недочёту — строго по очереди (двойное нажатие не создаёт вторую заявку)
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release; const cur = new Promise(r => { release = r; });
  const chain = prev.then(() => cur);
  locks.set(key, chain);
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === chain) locks.delete(key); }
}
const aptLabel = (a) => (a?.code ? `кв. ${a.code}` : a?.title || '');

export function defectOut(d, photos = []) {
  return {
    id: d.id, apartmentId: d.apartmentId, cleaningTaskId: d.cleaningTaskId, repairTaskId: d.repairTaskId, text: d.text,
    priority: d.priority, priorityLabel: PRIORITY_RU[d.priority] || d.priority, status: d.status,
    byName: d.reportedByName, at: d.createdAt, takenByName: d.takenByName, resolvedAt: d.resolvedAt, resolvedByName: d.resolvedByName, resolution: d.resolution, note: d.note,
    photoIds: d.photoIds || [], photos: photos.filter(p => (d.photoIds || []).includes(p.id)).map(p => ({ id: p.id, url: p.url })),
    repairStatus: d.repairTask?.status || null,
  };
}

export function createDefects({ events, workflow }) {
  const emit = (n, p) => events?.emit(n, p);
  async function get(accountId, id) {
    const d = await prisma.defect.findFirst({ where: { id, accountId }, include: { apartment: true } });
    if (!d) throw notFound('Недочёт не найден');
    return d;
  }
  async function create(o) {
    if (!o.text?.trim()) throw badRequest('Опишите, что не так');
    if (!PRIORITIES.includes(o.priority || 'later')) throw badRequest('Срочность: срочно или можно позже');
    return withLock(`new:${o.apartmentId}:${o.text.trim()}`, () => createNow(o));   // одновременная повторная отправка — одна запись
  }
  async function createNow({ accountId, apartmentId, cleaningTaskId = null, text, priority = 'later', photoIds = [], actor }) {
    const dup = await prisma.defect.findFirst({ where: { accountId, apartmentId, status: 'open', text: text.trim(), createdAt: { gte: new Date(Date.now() - DUP_MS) } } });
    if (dup) {   // повтор: не плодим копию; срочность можно только повысить, новые фото добавляем
      const ids = [...new Set([...(dup.photoIds || []), ...photoIds])];
      return prisma.defect.update({ where: { id: dup.id }, data: { photoIds: ids, ...(priority === 'urgent' ? { priority } : {}) } });
    }
    const d = await prisma.defect.create({ data: { accountId, apartmentId, cleaningTaskId, text: text.trim(), priority, photoIds, reportedById: actor?.id || null, reportedByName: actor?.name || null } });
    emit('cleaning.problem', { accountId, taskId: cleaningTaskId, defectId: d.id, problemId: d.id });
    return d;
  }
  /** «Заявка мастеру»: заявка без исполнителя (владелец/админ выберет мастера), фото недочёта копируются как «фото проблемы» */
  function toRepair(accountId, id, actor) { return withLock(`defect:${id}`, () => toRepairNow(accountId, id, actor)); }
  async function toRepairNow(accountId, id, actor) {
    const d = await get(accountId, id);
    if (d.status !== 'open') throw conflict('Недочёт уже решён');
    if (d.repairTaskId) return prisma.repairTask.findUnique({ where: { id: d.repairTaskId } });
    const r = await workflow.create({ accountId, actor, data: {
      apartmentId: d.apartmentId, title: d.text.split('\n')[0].slice(0, 80),
      description: `${d.text}\n\nНедочёт: ${aptLabel(d.apartment)}, ${PRIORITY_RU[d.priority]}${d.reportedByName ? ` (сообщил(а) ${d.reportedByName})` : ''}.`,
      date: new Date(), priority: d.priority === 'urgent' ? 'high' : 'medium', type: 'other',
    } });
    const photos = await prisma.cleaningPhoto.findMany({ where: { id: { in: d.photoIds || [] }, accountId } });
    for (const ph of photos) await prisma.repairPhoto.create({ data: { accountId, repairTaskId: r.id, kind: 'problem', url: ph.url, storageKey: ph.storageKey || '', caption: 'недочёт', uploadedBy: actor.type, mimeType: ph.mimeType } });
    await prisma.defect.update({ where: { id: d.id }, data: { repairTaskId: r.id } });
    return r;
  }
  async function take(accountId, id, actor) {
    const d = await get(accountId, id);
    if (d.status !== 'open') throw conflict('Недочёт уже решён');
    return prisma.defect.update({ where: { id: d.id }, data: { takenById: actor.id || null, takenByName: actor.name || null } });
  }
  async function resolve(accountId, id, actor, { note } = {}) {
    const d = await get(accountId, id);
    if (d.status !== 'open') return d;   // уже решён — повтор ничего не меняет
    if (d.repairTaskId) {
      const r = await prisma.repairTask.findUnique({ where: { id: d.repairTaskId }, select: { status: true } });
      if (r && ACTIVE_REPAIR.includes(r.status)) throw conflict('По недочёту есть заявка мастеру — он закроется сам, когда мастер завершит работу. Если мастер не нужен — отмените заявку');
    }
    return prisma.defect.update({ where: { id: d.id }, data: { status: 'resolved', resolvedAt: new Date(), resolvedByName: actor?.name || null, resolution: d.takenById ? 'self' : 'resolved', note: note || null } });
  }
  async function setPriority(accountId, id, priority) {
    if (!PRIORITIES.includes(priority)) throw badRequest('Срочность: срочно или можно позже');
    const d = await get(accountId, id);
    if (d.status !== 'open') throw conflict('Недочёт уже решён');
    return prisma.defect.update({ where: { id: d.id }, data: { priority } });
  }
  return { get, create, toRepair, take, resolve, setPriority };
}

/** Заявка мастеру завершена → её недочёты решены; отменена → недочёты снова просто открыты (без заявки) */
export async function syncDefectsWithRepair(repairTaskId, status, actorName = null) {
  if (status === 'DONE') return prisma.defect.updateMany({ where: { repairTaskId, status: 'open' }, data: { status: 'resolved', resolvedAt: new Date(), resolution: 'repair', resolvedByName: actorName } });
  if (status === 'CANCELLED') return prisma.defect.updateMany({ where: { repairTaskId, status: 'open' }, data: { repairTaskId: null } });
  return null;
}
