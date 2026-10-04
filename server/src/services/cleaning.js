// Подготовка квартиры (уборка) — «Специалист по подготовке» (внутренняя роль cleaning).
//   assigned ─ «Выхожу» ─► enroute ─ «Начать» (время начала, снимок чек-листа) ─► progress ─ «Закончить» (время окончания) ─► done
// Чек-лист = шаблон аккаунта (владелец меняет в настройках) + доп. пункты квартиры. Пункт может требовать фото.
// Закончить с неотмеченными пунктами или без обязательных фото можно только с комментарием «почему».
// Проблема (текст + фото) → владелец/админ одним нажатием делает из неё заявку мастеру.
import { prisma } from '../db.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { randomToken } from '../lib/tokens.js';
import { getSettings } from './settings.js';
import { aptShort } from './performerPayouts.js';

export const DEFAULT_CHECKLIST = ['Смена белья', 'Полотенца', 'Ванная и туалет', 'Кухня и посуда', 'Полы', 'Мусор', 'Расходники'].map(label => ({ label, photo: false }));
export const STATUS_RU = { assigned: 'Назначена', enroute: 'В пути', progress: 'Идёт подготовка', done: 'Готово' };
const conflict = (m) => new HttpError(409, m);

/** Нормализуем пункты: строки или {label, photo} */
export function normItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map(x => (typeof x === 'string' ? { label: x, photo: false } : { label: String(x?.label || '').trim(), photo: !!x?.photo })).filter(x => x.label).slice(0, 40);
}
export const templateOf = (settings) => { const t = normItems(settings?.cleaningChecklist); return t.length ? t : DEFAULT_CHECKLIST; };
export const buildChecklist = (settings, apartment) => [...templateOf(settings), ...normItems(apartment?.cleaningExtraItems)].map(x => ({ ...x, done: false, doneAt: null }));

/** Что мешает закончить: неотмеченные пункты и пункты без обязательного фото */
export function missingItems(task, photos = task.photos || []) {
  return (task.checklist || []).map((x, i) => ({ ...x, i })).filter(x => !x.done || (x.photo && !photos.some(p => p.itemIndex === x.i)))
    .map(x => (x.done ? `${x.label} — нужно фото` : x.label));
}

export function createCleaning({ events, payouts, workflow }) {
  const emit = (n, p) => events?.emit(n, p);
  const load = (id) => prisma.cleaningTask.findUnique({ where: { id }, include: { apartment: true, photos: true, assignee: { select: { id: true, name: true } } } });

  async function setStatus(task, status, { report, checklist } = {}) {
    if (status === 'progress') return start(task);
    if (status === 'done') return finish(task, { report, checklist });
    return prisma.cleaningTask.update({ where: { id: task.id }, data: { status, ...(report !== undefined ? { report } : {}) } });
  }
  async function start(task) {
    if (task.status === 'done') throw conflict('Подготовка уже закончена');
    let checklist = task.checklist;
    const fresh = !Array.isArray(checklist) || !checklist.length || checklist.every(x => !x.done);
    if (fresh) checklist = buildChecklist(await getSettings(task.accountId), task.apartment || await prisma.apartment.findUnique({ where: { id: task.apartmentId } }));
    return prisma.cleaningTask.update({ where: { id: task.id }, data: { status: 'progress', startedAt: task.startedAt || new Date(), checklist } });
  }
  async function check(task, index, done) {
    if (task.status === 'done') throw conflict('Подготовка уже закончена');
    if (task.status !== 'progress') task = await start(task);
    const list = [...(task.checklist || [])];
    if (!list[index]) throw badRequest('Нет такого пункта');
    list[index] = { ...list[index], done: !!done, doneAt: done ? new Date().toISOString() : null };
    return prisma.cleaningTask.update({ where: { id: task.id }, data: { checklist: list } });
  }
  async function addPhotos(task, { storage, files, itemIndex = null, kind = 'item', makeKey, looksLikeImage }) {
    if (!files?.length) throw badRequest('Выберите фото');
    const out = [];
    for (const f of files) {
      if (!looksLikeImage(f.buffer)) throw badRequest(`Файл «${f.originalname}» не похож на картинку`);
      const saved = await storage.save(makeKey(task.accountId, `cleaning/${task.id}`, f.mimetype, f.originalname), f.buffer, f.mimetype);
      out.push(await prisma.cleaningPhoto.create({ data: { accountId: task.accountId, cleaningTaskId: task.id, kind: itemIndex != null ? 'item' : kind, itemIndex: itemIndex != null ? itemIndex : null, url: saved.url, storageKey: saved.key, mimeType: f.mimetype } }));
    }
    return out;
  }
  async function reportProblem(task, actor, { text, photoIds = [] }) {
    if (!text?.trim()) throw badRequest('Опишите проблему');
    const problems = [...(task.problems || []), { id: randomToken(6), text: text.trim(), photoIds, at: new Date().toISOString(), byName: actor.name, repairTaskId: null }];
    if (photoIds.length) await prisma.cleaningPhoto.updateMany({ where: { id: { in: photoIds }, cleaningTaskId: task.id }, data: { kind: 'problem', itemIndex: null } });
    const u = await prisma.cleaningTask.update({ where: { id: task.id }, data: { problems } });
    emit('cleaning.problem', { accountId: task.accountId, taskId: task.id, problemId: problems.at(-1).id });
    return u;
  }
  async function finish(task, { report, note, checklist } = {}) {
    if (task.status === 'done') return task;
    if (checklist && !(task.checklist || []).length) task = await prisma.cleaningTask.update({ where: { id: task.id }, data: { checklist }, include: { photos: true } });
    if (!task.photos) task = await load(task.id);
    const missing = missingItems(task);
    const why = (note || report || '').trim();
    if (missing.length && !why) throw conflict(`Не отмечено: ${missing.join(', ')}. Отметьте или напишите почему`);
    const now = new Date();
    const u = await prisma.cleaningTask.update({ where: { id: task.id }, data: { status: 'done', startedAt: task.startedAt || now, doneAt: now, report: report ?? task.report, finishNote: missing.length ? why : null } });
    await payouts?.forCleaning(task.id);
    emit('cleaning.reported', { accountId: task.accountId, taskId: task.id });
    return u;
  }
  /** Проблема → заявка мастеру (без исполнителя: владелец выберет мастера). Фото копируются как «фото проблемы». */
  async function problemToRepair(task, problemId, actor) {
    const list = [...(task.problems || [])];
    const i = list.findIndex(p => p.id === problemId);
    if (i < 0) throw notFound('Проблема не найдена');
    if (list[i].repairTaskId) return prisma.repairTask.findUnique({ where: { id: list[i].repairTaskId } });
    const p = list[i];
    const r = await workflow.create({ accountId: task.accountId, actor, data: {
      apartmentId: task.apartmentId, title: p.text.split('\n')[0].slice(0, 80), description: `${p.text}\n\nНашли при подготовке ${task.date.toISOString().slice(0, 10)} (${p.byName || 'специалист'}).`,
      date: new Date(), priority: 'medium', type: 'other',
    } });
    const photos = await prisma.cleaningPhoto.findMany({ where: { id: { in: p.photoIds || [] } } });
    for (const ph of photos) await prisma.repairPhoto.create({ data: { accountId: task.accountId, repairTaskId: r.id, kind: 'problem', url: ph.url, storageKey: ph.storageKey || '', caption: 'с подготовки', uploadedBy: actor.type, mimeType: ph.mimeType } });
    list[i] = { ...p, repairTaskId: r.id };
    await prisma.cleaningTask.update({ where: { id: task.id }, data: { problems: list } });
    return r;
  }
  return { load, setStatus, start, check, addPhotos, reportProblem, finish, problemToRepair };
}

const photoOut = (p) => ({ id: p.id, url: p.url, kind: p.kind, itemIndex: p.itemIndex });
/** Полный отчёт: кто, начало/окончание, чек-лист, фото, проблемы, комментарии (+ выплата для владельца) */
export function cleaningReport(t, { payout = null } = {}) {
  const photos = t.photos || [];
  return {
    id: t.id, date: t.date, fromTime: t.fromTime, toTime: t.toTime, status: t.status, statusLabel: STATUS_RU[t.status] || t.status,
    title: `Подготовка ${aptShort(t.apartment)}${t.assignee ? ` — ${t.assignee.name}` : ''}`,
    apartment: t.apartment ? { id: t.apartment.id, title: t.apartment.title, code: t.apartment.code } : null,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null, bookingId: t.bookingId,
    startedAt: t.startedAt, doneAt: t.doneAt, report: t.report, finishNote: t.finishNote,
    checklist: (t.checklist || []).map((x, i) => ({ ...x, photos: photos.filter(p => p.itemIndex === i).map(photoOut) })),
    photos: photos.filter(p => p.itemIndex == null && p.kind !== 'problem').map(photoOut),
    problems: (t.problems || []).map(p => ({ ...p, photos: photos.filter(ph => (p.photoIds || []).includes(ph.id)).map(photoOut) })),
    missing: t.status === 'done' ? [] : missingItems(t, photos),
    payout: payout ? { id: payout.id, amountKzt: payout.amountKzt, status: payout.status, paidAt: payout.paidAt, method: payout.method } : null,
  };
}
