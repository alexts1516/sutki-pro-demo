// Единые выплаты исполнителям: специалистам по подготовке, мастерам, водителям (модель Payout, таблица DriverPayout).
// Запись «К оплате» (PENDING) создаётся сразу после завершения работы; владелец отмечает «Выплачено» (наличные / перевод).
//   подготовка — ставка квартиры → ставка по размеру (настройки) → общая ставка (настройки); 0 или не задано — выплаты нет
//   мастер     — одобренная смета + одобренные доп. расходы (или итог мастера); пересчитывается, пока не выплачено
//   водитель   — правила комиссии (transferJobs.syncPayoutRecord)
// Работу делал сам владелец — выплаты нет.
import { prisma } from '../db.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { getSettings } from './settings.js';
import { payable, pendingExtras } from './workRequests.js';

export const PAY_METHODS = ['cash', 'transfer'];
export const METHOD_RU = { cash: 'наличными', transfer: 'переводом' };
export const KIND_RU = { cleaning: 'Подготовка', repair: 'Мастер', transfer: 'Трансфер' };
const conflict = (m) => new HttpError(409, m);

export const aptShort = (a) => (a?.code ? `кв. ${a.code}` : a?.title || '');

/** Сколько платить за подготовку этой квартиры */
export function cleaningRate(apartment, settings) {
  if (apartment?.cleaningRateKzt != null) return apartment.cleaningRateKzt;
  const bySize = settings?.cleaningRates && typeof settings.cleaningRates === 'object' ? settings.cleaningRates[apartment?.rooms] : null;
  if (bySize != null && bySize !== '') return Number(bySize) || 0;
  return settings?.cleaningRateKzt ?? 0;
}

async function isOwner(accountId, userId) {
  if (!userId) return false;
  const m = await prisma.membership.findFirst({ where: { accountId, userId }, select: { role: true } });
  return m?.role === 'owner';
}

export function createPayouts({ events } = {}) {
  const emit = (n, p) => events?.emit(n, p);

  /** Создать/обновить запись. Выплаченную не трогаем. amount 0 → неоплаченную запись удаляем. */
  async function upsert(where, rec, base) {
    const cur = await prisma.payout.findFirst({ where });
    if (cur?.status === 'PAID') return cur;
    if (!base.amountKzt) { if (cur) await prisma.payout.delete({ where: { id: cur.id } }); return null; }
    if (cur) return prisma.payout.update({ where: { id: cur.id }, data: base });
    const p = await prisma.payout.create({ data: { ...rec, ...base, status: 'PENDING' } });
    emit('payout.created', { accountId: p.accountId, payoutId: p.id });
    return p;
  }

  async function forCleaning(taskId) {
    const t = await prisma.cleaningTask.findUnique({ where: { id: taskId }, include: { apartment: true, assignee: true } });
    if (!t || t.status !== 'done' || !t.assigneeId || await isOwner(t.accountId, t.assigneeId)) return null;
    const amount = cleaningRate(t.apartment, await getSettings(t.accountId));
    return upsert({ cleaningTaskId: t.id }, { accountId: t.accountId, kind: 'cleaning', cleaningTaskId: t.id },
      { amountKzt: amount, userId: t.assigneeId, name: t.assignee?.name || null, title: `Подготовка ${aptShort(t.apartment)}` });
  }

  async function forRepair(taskId) {
    const t = await prisma.repairTask.findUnique({ where: { id: taskId }, include: { apartment: true, assignee: true, contractor: true, estimates: true, extras: true } });
    if (!t || t.status !== 'DONE' || (!t.assigneeId && !t.contractorId)) return null;
    if (t.assigneeId && await isOwner(t.accountId, t.assigneeId)) return null;
    return upsert({ repairTaskId: t.id }, { accountId: t.accountId, kind: 'repair', repairTaskId: t.id }, {
      amountKzt: payable(t) || 0, userId: t.contractorId ? (t.contractor.userId || null) : t.assigneeId, contractorId: t.contractorId || null,
      name: t.contractor?.name || t.assignee?.name || null, title: `${t.title} — ${aptShort(t.apartment)}`,
    });
  }

  /** Выплатить (или вернуть «к оплате»). Синхронизирует отметку «оплачено» у заказа/заявки. */
  async function pay({ accountId, id, actor, method = 'cash', paid = true }) {
    const p = await prisma.payout.findFirst({ where: { id, accountId } });
    if (!p) throw notFound('Выплата не найдена');
    if (paid && !PAY_METHODS.includes(method)) throw badRequest('Как выплатили: наличными или переводом');
    if (paid && p.status === 'PAID') return p;
    if (paid && p.repairTaskId) {
      const t = await prisma.repairTask.findUnique({ where: { id: p.repairTaskId }, include: { extras: true } });
      if (t && pendingExtras(t).length) throw conflict('Сначала одобрите или отклоните доп. расходы — потом выплачивайте');
    }
    const now = paid ? new Date() : null;
    const u = await prisma.payout.update({ where: { id }, data: { status: paid ? 'PAID' : 'PENDING', method: paid ? method : null, paidAt: now, paidById: paid ? actor?.id || null : null, paidByName: paid ? actor?.name || null : null } });
    if (p.jobId) await prisma.transferJob.update({ where: { id: p.jobId }, data: { paid, paidAt: now } });
    if (p.repairTaskId) {
      await prisma.repairTask.update({ where: { id: p.repairTaskId }, data: { paid, paidAt: now } });
      await prisma.repairEvent.create({ data: { accountId, repairTaskId: p.repairTaskId, type: paid ? 'paid' : 'unpaid', actorType: actor?.type || 'owner', actorId: actor?.id || null, actorName: actor?.name || null, data: { amountKzt: p.amountKzt, method } } });
    }
    return u;
  }

  /** Напоминание владельцу о невыплаченном (через payoutReminderHours, один раз). Вызывается по расписанию. */
  async function remind(now = new Date()) {
    const list = await prisma.payout.findMany({ where: { status: 'PENDING', remindedAt: null } });
    let n = 0;
    for (const p of list) {
      const s = await getSettings(p.accountId);
      if (!s.payoutReminderHours || now - p.createdAt < s.payoutReminderHours * 3600000) continue;
      await prisma.payout.update({ where: { id: p.id }, data: { remindedAt: now } });
      emit('payout.reminder', { accountId: p.accountId, payoutId: p.id });
      n++;
    }
    return n;
  }
  return { forCleaning, forRepair, pay, remind };
}

/** Просрочено (красным): не выплачено дольше payoutReminderHours */
export const isOverdue = (p, hours, now = Date.now()) => p.status === 'PENDING' && hours > 0 && now - new Date(p.createdAt) >= hours * 3600000;

export function payoutOut(p, hours = 3) {
  return {
    id: p.id, kind: p.kind, kindLabel: KIND_RU[p.kind] || p.kind, title: p.title, amountKzt: p.amountKzt, status: p.status,
    statusLabel: p.status === 'PAID' ? 'Выплачено' : 'К оплате', method: p.method, methodLabel: METHOD_RU[p.method] || null,
    paidAt: p.paidAt, paidByName: p.paidByName, createdAt: p.createdAt, overdue: isOverdue(p, hours),
    performer: { userId: p.userId, contractorId: p.contractorId, name: p.name },
    jobId: p.jobId, cleaningTaskId: p.cleaningTaskId, repairTaskId: p.repairTaskId,
  };
}
