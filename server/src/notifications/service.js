// Сервис уведомлений: слушает события и пишет владельцу/админам, сотрудникам и гостям.
// Если Telegram-бот не настроен (нет TELEGRAM_BOT_TOKEN) — сообщение печатается в консоль
// и сохраняется в журнал NotificationLog со статусом «logged». Ничего не падает.
import { render } from './templates.js';
import { consoleTransport } from './transports.js';
import { nights } from '../lib/dates.js';
import { route, driverWhere, vehicleFits, PLACE_RU } from '../services/transferJobs.js';
import { managerRoles, getSettings } from '../services/settings.js';
import { computePayout } from '../services/payouts.js';
import { config } from '../config.js';
import { payoutButtons } from '../telegram/payoutButtons.js';

export const EVENTS = ['booking.requested', 'booking.confirmed', 'checkin.upcoming', 'guest.checkin_instructions', 'transfer.requested',
  'transfer.assigned', 'cleaning.reported', 'repair.assigned', 'repair.visit_requested', 'estimate.submitted', 'estimate.decided',
  'extra.submitted', 'extra.decided', 'repair.reported', 'repair.cancelled', 'repair.occupancy_changed', 'payment.succeeded',
  'transfer.offered', 'transfer.accepted', 'transfer.driver_assigned', 'transfer.driver_removed', 'transfer.unassigned', 'transfer.released',
  'transfer.updated', 'transfer.cancelled', 'transfer.reminder', 'transfer.en_route', 'transfer.driver_arrived',
  'cleaning.problem', 'repair.declined', 'payout.created', 'payout.reminder'];

export function createNotificationService({ prisma, transport = null, logger = console, quiet = false }) {
  const fallback = consoleTransport({ quiet });

  /** Отправить одно сообщение и записать в журнал */
  async function deliver({ accountId, event, recipientType, recipientId = null, recipientName = '', chatId = null, lang = 'ru', data, dedupeKey = null, buttons = null }) {
    if (dedupeKey && await prisma.notificationLog.findUnique({ where: { dedupeKey } })) return { status: 'duplicate' };
    const text = render(event, lang, data);
    let status, channel, error = null;
    if (transport && chatId) {
      channel = 'telegram';
      try { await transport.send(chatId, text, buttons ? { buttons } : undefined); status = 'sent'; }
      catch (e) { status = 'failed'; error = String(e.message || e).slice(0, 500); logger.warn(`[notify] ${event} → ${chatId}: ${error}`); }
    } else if (recipientType === 'guest' && !chatId) {
      channel = 'console'; status = 'skipped'; error = 'Гость не подключил Telegram';
    } else {
      channel = 'console'; status = 'logged';
      if (!transport) error = null; else error = 'Telegram не привязан';
      await fallback.send(chatId, text, [recipientName, recipientType].filter(Boolean).join(', '));
    }
    try {
      await prisma.notificationLog.create({ data: { accountId, event, channel, recipientType, recipientId, chatId, lang, text, status, error, dedupeKey } });
    } catch (e) { if (e.code !== 'P2002') throw e; return { status: 'duplicate' }; }   // P2002 — такой dedupeKey уже есть
    return { status, channel, text };
  }

  /** Владельцу и/или админам — кому именно, решает настройка «Кому уведомления» (владелец / админ / оба).
   *  roles — задать явно (например, оплаты — только владельцу); alsoOwner — владелец получит в любом случае (сметы при «одобряет только владелец»). */
  async function toManagers(accountId, event, data, { roles = null, alsoOwner = false, dedupeKey = null, buttons = null } = {}) {
    roles = roles || await managerRoles(accountId, prisma);
    if (alsoOwner && !roles.includes('owner')) roles = [...roles, 'owner'];
    const members = await prisma.membership.findMany({ where: { accountId, active: true, role: { in: roles } }, include: { user: true } });
    const out = [];
    for (const m of members) {
      out.push(await deliver({ accountId, event, recipientType: m.role, recipientId: m.userId, recipientName: m.user.name, chatId: m.user.telegramId, lang: m.user.locale, data,
        dedupeKey: dedupeKey ? `${dedupeKey}:${m.userId}` : null, buttons }));
    }
    return out;
  }
  async function toGuest(accountId, guest, event, data, dedupeKey = null) {
    return deliver({ accountId, event, recipientType: 'guest', recipientId: guest?.id, chatId: guest?.telegramChatId || null, lang: guest?.locale || 'ru', data, dedupeKey });
  }

  /** Исполнителю заявки: мастеру из команды или пользователю подрядчика; у подрядчика без входа — только журнал */
  async function toExecutor(accountId, taskId, event, extra = {}) {
    const task = await prisma.repairTask.findFirst({ where: { id: taskId, accountId }, include: { apartment: true, assignee: true, contractor: { include: { user: true } }, occupancyUpdatedBy: true } });
    if (!task) return;
    const user = task.assignee || task.contractor?.user || null;
    const data = { task, apartment: task.apartment, ...extra };
    if (user) return deliver({ accountId, event, recipientType: 'master', recipientId: user.id, recipientName: task.contractor?.name || user.name, chatId: user.telegramId, lang: user.locale, data });
    if (task.contractor) return deliver({ accountId, event, recipientType: 'contractor', recipientId: task.contractor.id, recipientName: task.contractor.name, data });
  }
  const loadRepair = (accountId, id) => prisma.repairTask.findFirst({ where: { id, accountId }, include: { apartment: true, assignee: true, contractor: true } });
  const repairData = (t) => ({ task: t, apartment: t.apartment, assignee: t.assignee || (t.contractor ? { name: t.contractor.name } : null) });

  // ---------- трансферы ----------
  const loadJob = (accountId, id) => prisma.transferJob.findFirst({ where: { id, accountId }, include: { transfer: { include: { guest: true, booking: { include: { guest: true } } } }, apartment: true, booking: { select: { number: true } }, driverUser: true, driverContractor: true } });
  const jobData = (j, extra = {}, { hideUnit = false } = {}) => ({ job: j, transfer: j.transfer, trip: { ...route(j, { hideUnit }), placeLabel: PLACE_RU[j.transfer.place] }, booking: j.booking, ...extra });
  /** Водителю заказа: из команды — в Telegram; внешнему — в журнал (ему отправляют ссылку вручную) */
  async function toDriver(j, event, extra = {}, dedupeKey = null, who = null) {
    const user = who?.userId !== undefined ? (who.userId ? await prisma.user.findUnique({ where: { id: who.userId } }) : null) : j.driverUser;
    const contractor = who?.contractorId !== undefined ? (who.contractorId ? await prisma.contractor.findUnique({ where: { id: who.contractorId } }) : null) : j.driverContractor;
    const data = jobData(j, extra);
    if (user) return deliver({ accountId: j.accountId, event, recipientType: 'driver', recipientId: user.id, recipientName: user.name, chatId: user.telegramId, lang: user.locale, data, dedupeKey: dedupeKey && `${dedupeKey}:${user.id}` });
    if (contractor) return deliver({ accountId: j.accountId, event, recipientType: 'contractor', recipientId: contractor.id, recipientName: contractor.name, data, dedupeKey: dedupeKey && `${dedupeKey}:${contractor.id}` });
  }
  const jobGuest = (j) => j.transfer.guest || j.transfer.booking?.guest || null;

  const loadBooking = (accountId, id) => prisma.booking.findFirst({ where: { id, accountId }, include: { apartment: true, guest: true, transfers: true } });
  const bookingData = (b) => ({ booking: b, apartment: b.apartment, guest: b.guest, nights: nights(b.checkIn, b.checkOut) });

  async function payoutNotice(accountId, payoutId, event) {
    const p = await prisma.payout.findFirst({ where: { id: payoutId, accountId } }); if (!p || p.status === 'PAID') return;
    let apartment = null, task = null;
    if (p.cleaningTaskId) apartment = (await prisma.cleaningTask.findUnique({ where: { id: p.cleaningTaskId }, include: { apartment: true } }))?.apartment;
    if (p.repairTaskId) { task = await prisma.repairTask.findUnique({ where: { id: p.repairTaskId }, include: { apartment: true } }); apartment = task?.apartment; }
    const { payoutReminderHours: hours } = await getSettings(accountId, prisma);
    return toManagers(accountId, event, { payout: p, apartment, task, hours }, { roles: ['owner'], dedupeKey: `${event}:${p.id}`, buttons: payoutButtons(p.id) });
  }

  const handlers = {
    async 'booking.requested'({ accountId, bookingId }) {
      const b = await loadBooking(accountId, bookingId); if (!b) return;
      return toManagers(accountId, 'booking.requested', bookingData(b));
    },
    async 'booking.confirmed'({ accountId, bookingId }) {
      const b = await loadBooking(accountId, bookingId); if (!b) return;
      return toGuest(accountId, b.guest, 'booking.confirmed', bookingData(b), `booking.confirmed:${b.id}`);
    },
    /** Напоминание команде о заезде (сегодня/завтра) + инструкция гостю */
    async 'checkin.upcoming'({ accountId, bookingId, when }) {
      const b = await loadBooking(accountId, bookingId); if (!b) return;
      const transfer = b.transfers.find(t => t.direction === 'in' && t.status !== 'cancelled');
      const r = await toManagers(accountId, 'checkin.upcoming', { ...bookingData(b), when, transfer }, { dedupeKey: `checkin.upcoming:${b.id}:${when}` });
      if (when === 'tomorrow' || when === 'today') {
        await toGuest(accountId, b.guest, 'guest.checkin_instructions', bookingData(b), `guest.checkin_instructions:${b.id}`);
      }
      return r;
    },
    async 'transfer.requested'({ accountId, transferId }) {
      const t = await prisma.transfer.findFirst({ where: { id: transferId, accountId }, include: { booking: true, guest: true } }); if (!t) return;
      return toManagers(accountId, 'transfer.requested', { transfer: t, booking: t.booking, guest: t.guest });
    },
    async 'transfer.assigned'({ accountId, transferId }) {
      const t = await prisma.transfer.findFirst({ where: { id: transferId, accountId }, include: { booking: { include: { guest: true } }, guest: true } }); if (!t) return;
      const guest = t.guest || t.booking?.guest;
      return toGuest(accountId, guest, 'transfer.assigned', { transfer: t }, `transfer.assigned:${t.id}:${t.driverName || ''}`);
    },
    /** Новый заказ — всем, кто может водить (кроме отказавшегося) */
    async 'transfer.offered'({ accountId, jobId, round = 1, exceptUserId = null }) {
      const j = await loadJob(accountId, jobId); if (!j || !['OFFERED', 'UNASSIGNED'].includes(j.status)) return;
      const drivers = await prisma.membership.findMany({ where: driverWhere(accountId), include: { user: true } });
      const settings = await getSettings(accountId, prisma);
      const out = [];
      for (const m of drivers) {
        if (m.userId === exceptUserId || !vehicleFits(m, j.transfer)) continue;   // не помещаются пассажиры/багаж
        // до «Беру»: без номера квартиры и телефона гостя; выплата — по ставке этого водителя; цена для гостя не показывается
        const p = computePayout({ priceKzt: j.transfer.priceKzt, settings, driver: m, manualKzt: j.payoutManual ? j.payoutKzt : null });
        const data = jobData({ ...j, payoutKzt: p.payoutKzt, payoutRule: p.rule }, {}, { hideUnit: true });
        out.push(await deliver({ accountId, event: 'transfer.offered', recipientType: 'driver', recipientId: m.userId, recipientName: m.user.name, chatId: m.user.telegramId, lang: m.user.locale, data,
          dedupeKey: `transfer.offered:${j.id}:${round}:${m.userId}`, buttons: [[{ text: m.user.locale === 'en' ? '✋ Take it' : '✋ Беру', data: `tj:acc:${j.id}` }]] }));
      }
      return out;
    },
    /** Водитель взял заказ — хозяину/админу; гостю — имя водителя, машина, табличка */
    async 'transfer.accepted'({ accountId, jobId }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      await toManagers(accountId, 'transfer.accepted', jobData(j), { dedupeKey: `transfer.accepted:${j.id}:${j.driverUserId}` });
      return toGuest(accountId, jobGuest(j), 'transfer.assigned', { transfer: j.transfer, job: j }, `transfer.assigned:${j.transferId}:${j.driverName || ''}`);
    },
    async 'transfer.driver_assigned'({ accountId, jobId, previousUserId = null, previousContractorId = null }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      await toDriver(j, 'transfer.driver_assigned', { link: j.linkToken ? `${config.publicUrl}/link/${j.linkToken}` : null });
      if (previousUserId || previousContractorId) await toDriver(j, 'transfer.driver_removed', {}, null, { userId: previousUserId, contractorId: previousContractorId });
      return toGuest(accountId, jobGuest(j), 'transfer.assigned', { transfer: j.transfer, job: j }, `transfer.assigned:${j.transferId}:${j.driverName || ''}`);
    },
    async 'transfer.driver_removed'({ accountId, jobId, userId = null, contractorId = null }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      return toDriver(j, 'transfer.driver_removed', {}, null, { userId, contractorId });
    },
    /** Никто не взял — хозяину/админу «назначьте вручную» (и срочно — за час до подачи) */
    async 'transfer.unassigned'({ accountId, jobId, reason, urgent = false, dedupe }) {
      const j = await loadJob(accountId, jobId); if (!j || j.status !== 'UNASSIGNED') return;
      return toManagers(accountId, 'transfer.unassigned', jobData(j, { reason, urgent }), { dedupeKey: `transfer.unassigned:${dedupe || j.id}` });
    },
    async 'transfer.released'({ accountId, jobId, byName, reason }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      return toManagers(accountId, 'transfer.released', jobData(j, { byName, reason }));
    },
    /** Изменилось время/детали: водителю (если менял не он) и менеджерам (если менял водитель или трекинг рейса) */
    async 'transfer.updated'({ accountId, jobId, before = null, after = null, byName = null, notifyManagers = false, notifyDriver = !notifyManagers, reason = null }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      const extra = { before, after, byName, reason };
      if (notifyManagers) await toManagers(accountId, 'transfer.updated', jobData(j, extra));
      if (notifyDriver && (j.driverUserId || j.driverContractorId)) await toDriver(j, 'transfer.updated', extra);
    },
    async 'transfer.cancelled'({ accountId, jobId }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      return toDriver(j, 'transfer.cancelled');
    },
    async 'transfer.reminder'({ accountId, jobId, dedupe }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      return toDriver(j, 'transfer.reminder', {}, `transfer.reminder:${dedupe || j.id}`);
    },
    async 'transfer.en_route'({ accountId, jobId }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      return toGuest(accountId, jobGuest(j), 'transfer.en_route', jobData(j), `transfer.en_route:${j.id}`);
    },
    async 'transfer.driver_arrived'({ accountId, jobId }) {
      const j = await loadJob(accountId, jobId); if (!j) return;
      return toGuest(accountId, jobGuest(j), 'transfer.driver_arrived', jobData(j), `transfer.driver_arrived:${j.id}:${j.arrivedAt?.getTime() || ''}`);
    },
    async 'cleaning.reported'({ accountId, taskId }) {
      const task = await prisma.cleaningTask.findFirst({ where: { id: taskId, accountId }, include: { apartment: true, assignee: true } }); if (!task) return;
      return toManagers(accountId, 'cleaning.reported', { task, apartment: task.apartment, assignee: task.assignee });
    },
    async 'cleaning.problem'({ accountId, taskId, problemId }) {
      const task = await prisma.cleaningTask.findFirst({ where: { id: taskId, accountId }, include: { apartment: true, assignee: true } }); if (!task) return;
      const problem = (task.problems || []).find(p => p.id === problemId); if (!problem) return;
      return toManagers(accountId, 'cleaning.problem', { task, apartment: task.apartment, assignee: task.assignee, problem });
    },
    async 'repair.declined'({ accountId, taskId, by, reason }) {
      const t = await loadRepair(accountId, taskId); if (!t) return;
      return toManagers(accountId, 'repair.declined', { ...repairData(t), by, reason }, { alsoOwner: true });
    },
    /** Работа закончена — владельцу «к оплате» с кнопками «Оплатить» (наличные / перевод); через N часов — напоминание */
    async 'payout.created'({ accountId, payoutId }) { return payoutNotice(accountId, payoutId, 'payout.created'); },
    async 'payout.reminder'({ accountId, payoutId }) { return payoutNotice(accountId, payoutId, 'payout.reminder'); },
    async 'repair.assigned'({ accountId, taskId }) { return toExecutor(accountId, taskId, 'repair.assigned'); },
    async 'repair.visit_requested'({ accountId, taskId }) {
      const t = await loadRepair(accountId, taskId); if (!t) return;
      const ev = await prisma.repairEvent.findFirst({ where: { repairTaskId: t.id, type: 'visit_requested' }, orderBy: { createdAt: 'desc' } });
      return toManagers(accountId, 'repair.visit_requested', { ...repairData(t), note: ev?.note });
    },
    async 'repair.reported'({ accountId, taskId }) {
      const t = await loadRepair(accountId, taskId); if (!t) return;
      return toManagers(accountId, 'repair.reported', repairData(t));
    },
    async 'repair.cancelled'({ accountId, taskId }) { return toExecutor(accountId, taskId, 'repair.cancelled'); },
    async 'repair.occupancy_changed'({ accountId, taskId }) { return toExecutor(accountId, taskId, 'repair.occupancy_changed'); },
    async 'estimate.submitted'({ accountId, estimateId }) {
      const est = await prisma.repairEstimate.findFirst({ where: { id: estimateId, accountId }, include: { repairTask: { include: { apartment: true } } } }); if (!est) return;
      const { approvalBy } = await getSettings(accountId, prisma);
      return toManagers(accountId, 'estimate.submitted', { estimate: est, task: est.repairTask, apartment: est.repairTask.apartment }, { alsoOwner: approvalBy === 'OWNER_ONLY' });
    },
    async 'estimate.decided'({ accountId, estimateId }) {
      const est = await prisma.repairEstimate.findFirst({ where: { id: estimateId, accountId } }); if (!est) return;
      return toExecutor(accountId, est.repairTaskId, 'estimate.decided', { estimate: est });
    },
    async 'extra.submitted'({ accountId, extraId }) {
      const x = await prisma.extraExpense.findFirst({ where: { id: extraId, accountId }, include: { repairTask: { include: { apartment: true } } } }); if (!x) return;
      const { approvalBy } = await getSettings(accountId, prisma);
      return toManagers(accountId, 'extra.submitted', { extra: x, task: x.repairTask, apartment: x.repairTask.apartment }, { alsoOwner: approvalBy === 'OWNER_ONLY' });
    },
    async 'extra.decided'({ accountId, extraId }) {
      const x = await prisma.extraExpense.findFirst({ where: { id: extraId, accountId } }); if (!x) return;
      return toExecutor(accountId, x.repairTaskId, 'extra.decided', { extra: x });
    },
    async 'payment.succeeded'({ accountId, paymentId }) {
      const p = await prisma.payment.findFirst({ where: { id: paymentId, accountId }, include: { booking: true } }); if (!p) return;
      return toManagers(accountId, 'payment.succeeded', { payment: p, booking: p.booking }, { roles: ['owner'] });
    },
  };

  return {
    deliver, toManagers, toGuest, handlers,
    /** Подписаться на все события шины */
    register(events) { for (const [name, fn] of Object.entries(handlers)) events.on(name, fn); },
    get telegramEnabled() { return !!transport; },
  };
}
