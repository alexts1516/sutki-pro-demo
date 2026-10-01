// Сервис уведомлений: слушает события и пишет владельцу/админам, сотрудникам и гостям.
// Если Telegram-бот не настроен (нет TELEGRAM_BOT_TOKEN) — сообщение печатается в консоль
// и сохраняется в журнал NotificationLog со статусом «logged». Ничего не падает.
import { render } from './templates.js';
import { consoleTransport } from './transports.js';
import { nights } from '../lib/dates.js';

export const EVENTS = ['booking.requested', 'booking.confirmed', 'checkin.upcoming', 'guest.checkin_instructions', 'transfer.requested',
  'transfer.assigned', 'cleaning.reported', 'repair.assigned', 'repair.visit_requested', 'estimate.submitted', 'estimate.decided',
  'extra.submitted', 'extra.decided', 'repair.reported', 'repair.cancelled', 'repair.occupancy_changed', 'payment.succeeded'];

export function createNotificationService({ prisma, transport = null, logger = console, quiet = false }) {
  const fallback = consoleTransport({ quiet });

  /** Отправить одно сообщение и записать в журнал */
  async function deliver({ accountId, event, recipientType, recipientId = null, recipientName = '', chatId = null, lang = 'ru', data, dedupeKey = null }) {
    if (dedupeKey && await prisma.notificationLog.findUnique({ where: { dedupeKey } })) return { status: 'duplicate' };
    const text = render(event, lang, data);
    let status, channel, error = null;
    if (transport && chatId) {
      channel = 'telegram';
      try { await transport.send(chatId, text); status = 'sent'; }
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

  /** Всем владельцам и админам аккаунта (у каждого свой язык) */
  async function toManagers(accountId, event, data, { roles = ['owner', 'admin'], dedupeKey = null } = {}) {
    const members = await prisma.membership.findMany({ where: { accountId, active: true, role: { in: roles } }, include: { user: true } });
    const out = [];
    for (const m of members) {
      out.push(await deliver({ accountId, event, recipientType: m.role, recipientId: m.userId, recipientName: m.user.name, chatId: m.user.telegramId, lang: m.user.locale, data,
        dedupeKey: dedupeKey ? `${dedupeKey}:${m.userId}` : null }));
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

  const loadBooking = (accountId, id) => prisma.booking.findFirst({ where: { id, accountId }, include: { apartment: true, guest: true, transfers: true } });
  const bookingData = (b) => ({ booking: b, apartment: b.apartment, guest: b.guest, nights: nights(b.checkIn, b.checkOut) });

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
    async 'cleaning.reported'({ accountId, taskId }) {
      const task = await prisma.cleaningTask.findFirst({ where: { id: taskId, accountId }, include: { apartment: true, assignee: true } }); if (!task) return;
      return toManagers(accountId, 'cleaning.reported', { task, apartment: task.apartment, assignee: task.assignee });
    },
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
      return toManagers(accountId, 'estimate.submitted', { estimate: est, task: est.repairTask, apartment: est.repairTask.apartment });
    },
    async 'estimate.decided'({ accountId, estimateId }) {
      const est = await prisma.repairEstimate.findFirst({ where: { id: estimateId, accountId } }); if (!est) return;
      return toExecutor(accountId, est.repairTaskId, 'estimate.decided', { estimate: est });
    },
    async 'extra.submitted'({ accountId, extraId }) {
      const x = await prisma.extraExpense.findFirst({ where: { id: extraId, accountId }, include: { repairTask: { include: { apartment: true } } } }); if (!x) return;
      return toManagers(accountId, 'extra.submitted', { extra: x, task: x.repairTask, apartment: x.repairTask.apartment });
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
