// Подготовка квартиры (уборка) — «Специалист по подготовке» (внутренняя роль cleaning).
//   assigned ─ «Выхожу» ─► enroute ─ «Начать» (время начала, снимок чек-листа) ─► progress ─ «Закончить» (время окончания) ─► done
// Чек-лист = шаблон аккаунта (владелец меняет в настройках) + доп. пункты квартиры. Пункт может требовать фото.
// Закончить с неотмеченными пунктами или без обязательных фото можно только с комментарием «почему».
// Проблема (текст + фото + срочность) → недочёт квартиры (services/defects.js): висит, пока не решён; срочный — квартира не готова.
// Порядок и время: начать можно только в день подготовки (по времени аккаунта), закончить — только после «Начать»;
// после «Готово» шаги, отметки и фото чек-листа не меняются (сообщить о проблеме — можно).
import { prisma } from '../db.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { getSettings } from './settings.js';
import { aptShort } from './performerPayouts.js';
import { todayIn, isoDay } from '../lib/dates.js';
import { defectOut } from './defects.js';

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

const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayRu = (d) => { const x = new Date(d); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
/** Можно ли начинать: только в день подготовки или позже (по времени аккаунта) */
export async function canStartCleaning(task, now = new Date()) {
  const acc = await prisma.account.findUnique({ where: { id: task.accountId }, select: { timezone: true } });
  return isoDay(todayIn(acc?.timezone || 'Asia/Almaty', now)) >= isoDay(task.date);
}

export function createCleaning({ events, payouts, workflow, defects }) {
  const emit = (n, p) => events?.emit(n, p);
  const load = (id) => prisma.cleaningTask.findUnique({ where: { id }, include: { apartment: true, photos: true, assignee: { select: { id: true, name: true } }, defects: { orderBy: { createdAt: 'asc' } } } });
  const notDone = (task) => { if (task.status === 'done') throw conflict('Подготовка уже закончена — изменить нельзя'); };
  async function notEarly(task) {
    if (!(await canStartCleaning(task))) throw conflict(`Подготовка запланирована на ${dayRu(task.date)} — начать можно в этот день`);
  }

  async function setStatus(task, status, { report, checklist } = {}) {
    if (status === 'progress') return start(task);
    if (status === 'done') return finish(task, { report, checklist });   // только из «Идёт подготовка» — шаги не перепрыгиваем
    notDone(task);
    if (status === 'assigned' && task.status !== 'enroute') throw conflict('Вернуть назад можно только из «В пути»');
    if (status === 'enroute') { if (task.status === 'progress') throw conflict('Подготовка уже идёт'); await notEarly(task); }
    return prisma.cleaningTask.update({ where: { id: task.id }, data: { status, ...(report !== undefined ? { report } : {}) } });
  }
  async function start(task) {
    notDone(task);
    if (task.status === 'progress') return task;   // повторное нажатие
    await notEarly(task);
    let checklist = task.checklist;
    const fresh = !Array.isArray(checklist) || !checklist.length || checklist.every(x => !x.done);
    if (fresh) checklist = buildChecklist(await getSettings(task.accountId), task.apartment || await prisma.apartment.findUnique({ where: { id: task.apartmentId } }));
    return prisma.cleaningTask.update({ where: { id: task.id }, data: { status: 'progress', startedAt: task.startedAt || new Date(), checklist } });
  }
  async function check(task, index, done) {
    notDone(task);
    if (task.status !== 'progress') task = await start(task);
    const list = [...(task.checklist || [])];
    if (!list[index]) throw badRequest('Нет такого пункта');
    list[index] = { ...list[index], done: !!done, doneAt: done ? new Date().toISOString() : null };
    return prisma.cleaningTask.update({ where: { id: task.id }, data: { checklist: list } });
  }
  async function addPhotos(task, { storage, files, itemIndex = null, kind = 'item', makeKey, looksLikeImage }) {
    if (!files?.length) throw badRequest('Выберите фото');
    if (kind !== 'problem' || itemIndex != null) {
      notDone(task);
      if (task.status !== 'progress') throw conflict('Сначала нажмите «Начать подготовку»');
    }
    const out = [];
    for (const f of files) {
      if (!looksLikeImage(f.buffer)) throw badRequest(`Файл «${f.originalname}» не похож на картинку`);
      const saved = await storage.save(makeKey(task.accountId, `cleaning/${task.id}`, f.mimetype, f.originalname), f.buffer, f.mimetype);
      out.push(await prisma.cleaningPhoto.create({ data: { accountId: task.accountId, cleaningTaskId: task.id, kind: itemIndex != null ? 'item' : kind, itemIndex: itemIndex != null ? itemIndex : null, url: saved.url, storageKey: saved.key, mimeType: f.mimetype } }));
    }
    return out;
  }
  /** Проблема → недочёт квартиры (висит, пока не решён). priority: urgent — срочно (квартира не готова) | later */
  async function reportProblem(task, actor, { text, photoIds = [], priority = 'later' }) {
    if (!text?.trim()) throw badRequest('Опишите проблему');
    if (photoIds.length) await prisma.cleaningPhoto.updateMany({ where: { id: { in: photoIds }, cleaningTaskId: task.id }, data: { kind: 'problem', itemIndex: null } });
    return defects.create({ accountId: task.accountId, apartmentId: task.apartmentId, cleaningTaskId: task.id, text, priority, photoIds, actor });
  }
  async function finish(task, { report, note, checklist } = {}) {
    if (task.status === 'done') return task;   // повторное нажатие — ничего не меняем
    if (task.status !== 'progress') throw conflict('Сначала нажмите «Начать подготовку»');
    if (checklist && !(task.checklist || []).length) task = await prisma.cleaningTask.update({ where: { id: task.id }, data: { checklist }, include: { photos: true } });
    if (!task.photos) task = await load(task.id);
    const missing = missingItems(task);
    const why = (note || report || '').trim();
    if (missing.length && !why) throw conflict(`Не отмечено: ${missing.join(', ')}. Отметьте или напишите почему`);
    const now = new Date();
    // условная запись: двойное нажатие «Закончить» не создаст вторую выплату и второе уведомление
    const won = await prisma.cleaningTask.updateMany({ where: { id: task.id, status: 'progress' }, data: { status: 'done', startedAt: task.startedAt || now, doneAt: now, report: report ?? task.report, finishNote: missing.length ? why : null } });
    const u = await prisma.cleaningTask.findUnique({ where: { id: task.id } });
    if (!won.count) { if (u.status === 'done') return u; throw conflict('Сначала нажмите «Начать подготовку»'); }
    await payouts?.forCleaning(task.id);
    emit('cleaning.reported', { accountId: task.accountId, taskId: task.id });
    return u;
  }
  /** Проблема с подготовки → заявка мастеру (то же, что «Заявка мастеру» у недочёта) */
  async function problemToRepair(task, problemId, actor) {
    const d = await defects.get(task.accountId, problemId);
    return defects.toRepair(task.accountId, d.id, actor);
  }
  /** Закончили не полностью → владелец/админ принимает отчёт (без этого квартира «не готова») */
  async function review(task, actor) {
    if (task.status !== 'done') throw conflict('Подготовка ещё не закончена');
    return prisma.cleaningTask.update({ where: { id: task.id }, data: { reviewedAt: new Date(), reviewedBy: actor?.name || null } });
  }
  return { load, setStatus, start, check, addPhotos, reportProblem, finish, problemToRepair, review };
}

const photoOut = (p) => ({ id: p.id, url: p.url, kind: p.kind, itemIndex: p.itemIndex });
/** Полный отчёт: кто, начало/окончание, чек-лист, фото, проблемы, комментарии (+ выплата для владельца) */
export function cleaningReport(t, { payout = null } = {}) {
  const photos = t.photos || [];
  return {
    id: t.id, date: t.date, fromTime: t.fromTime, toTime: t.toTime, status: t.status, statusLabel: STATUS_RU[t.status] || t.status,
    title: `Подготовка ${aptShort(t.apartment)}${t.assignee ? ` — ${t.assignee.name}` : ''}`,
    apartment: t.apartment ? { id: t.apartment.id, title: t.apartment.title, code: t.apartment.code } : null,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name, phone: t.assignee.phone || null } : null, bookingId: t.bookingId,
    startedAt: t.startedAt, doneAt: t.doneAt, report: t.report, finishNote: t.finishNote,
    checklist: (t.checklist || []).map((x, i) => ({ ...x, photos: photos.filter(p => p.itemIndex === i).map(photoOut) })),
    photos: photos.filter(p => p.itemIndex == null && p.kind !== 'problem').map(photoOut),
    problems: (t.defects || []).map(d => defectOut(d, photos)), reviewedAt: t.reviewedAt, reviewedBy: t.reviewedBy,
    missing: t.status === 'done' ? [] : missingItems(t, photos),
    payout: payout ? { id: payout.id, amountKzt: payout.amountKzt, status: payout.status, paidAt: payout.paidAt, method: payout.method } : null,
  };
}
