// Журнал отложенных действий (outbox), проход 4, шаг 3 (спецификация, раздел 4.5).
// Строка пишется В ТОЙ ЖЕ транзакции, что и изменение брони; выполняется после коммита — сразу (лучшее усилие),
// при старте сервера и раз в минуту из startScheduler. Внешних очередей нет.
// Две копии сервера не выполнят одну строку одновременно: строку «захватывает» условная запись (аренда на 5 минут).
// Обработчики повторяемы: заказы водителям защищены уникальным TransferJob.transferId, уведомления — NotificationLog.dedupeKey.
import { prisma } from '../db.js';
import { hook } from '../lib/testHooks.js';
import { withApartmentLock } from './bookings.js';

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_LEASE_MS = 5 * 60000;
export const outboxRetryMs = (attempts) => Math.min(60000 * 2 ** Math.max(0, attempts - 1), 30 * 60000);   // 1, 2, 4, 8 мин…

/** Добавить строку журнала (в транзакции — передайте tx). Повтор с тем же dedupeKey ничего не меняет. */
export async function enqueue(db, { accountId, kind, payload, dedupeKey }) {
  try {
    return await db.outboxEvent.upsert({ where: { dedupeKey }, create: { accountId, kind, payload, dedupeKey }, update: {} });
  } catch (e) {
    if (e.code === 'P2002' && db === prisma) return prisma.outboxEvent.findUnique({ where: { dedupeKey } });   // вставили параллельно — уже есть
    throw e;
  }
}

/** Обработчики по виду строки. Нет нужного сервиса (events/dispatch) — вида нет: строка ждёт процесс, где он есть. */
export function outboxHandlers({ events = null, dispatch = null } = {}) {
  return {
    ...(events ? { event: async (row) => { events.emit(row.payload.name, row.payload.data); } } : {}),
    ...(dispatch ? {
      // предложить водителям трансферы подтверждённой брони; бронь уже отменили — нечего предлагать.
      // Под очередью квартиры: строго до или после отмены этой брони, а не одновременно с ней.
      'transfers.dispatch': async (row) => {
        const b0 = await prisma.booking.findUnique({ where: { id: row.payload.bookingId }, select: { apartmentId: true } });
        if (!b0) return;
        await withApartmentLock(b0.apartmentId, async () => {
          const b = await prisma.booking.findUnique({ where: { id: row.payload.bookingId }, select: { status: true } });
          if (b?.status !== 'confirmed') return;
          await dispatch.createForBooking({ accountId: row.accountId, bookingId: row.payload.bookingId, actor: row.payload.actor || null });
        });
      },
      // бронь отменена — отменить её заказы водителям (водитель получит «заказ отменён») и трансферы
      'transfers.cancel': async (row) => {
        const b0 = await prisma.booking.findUnique({ where: { id: row.payload.bookingId }, select: { apartmentId: true } });
        const run = () => dispatch.cancelForBooking({ accountId: row.accountId, bookingId: row.payload.bookingId, actor: row.payload.actor || null, reason: row.payload.reason || 'Бронь отменена' });
        await (b0 ? withApartmentLock(b0.apartmentId, run) : run());
      },
    } : {}),
  };
}

/** Выполнить готовые строки журнала. keys — только эти (сразу после коммита). Возвращает { done, failed, retried }. */
export async function runOutbox({ events = null, dispatch = null, keys = null, limit = 50, logger = null } = {}) {
  const handlers = outboxHandlers({ events, dispatch });
  const kinds = Object.keys(handlers);
  const out = { done: 0, failed: 0, retried: 0 };
  if (!kinds.length || (keys && !keys.length)) return out;
  const rows = await prisma.outboxEvent.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() }, kind: { in: kinds }, ...(keys ? { dedupeKey: { in: keys } } : {}) },
    orderBy: { createdAt: 'asc' }, take: limit,
  });
  for (const row of rows) {
    // захват: только одна копия сервера выиграет эту условную запись; аренда истечёт, если процесс упадёт посередине
    const claimed = await prisma.outboxEvent.updateMany({
      where: { id: row.id, status: 'pending', nextAttemptAt: { lte: new Date() } },
      data: { nextAttemptAt: new Date(Date.now() + OUTBOX_LEASE_MS) },
    });
    if (!claimed.count) continue;
    try {
      await handlers[row.kind](row);
    } catch (e) {
      const u = await prisma.outboxEvent.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError: String(e?.message || e).slice(0, 500) } });
      const failed = u.attempts >= OUTBOX_MAX_ATTEMPTS;
      await prisma.outboxEvent.update({ where: { id: row.id }, data: failed ? { status: 'failed' } : { nextAttemptAt: new Date(Date.now() + outboxRetryMs(u.attempts)) } });
      out[failed ? 'failed' : 'retried']++;
      logger?.error?.(`[outbox] ${row.dedupeKey}: ${e?.message || e}${failed ? ' — попытки исчерпаны' : ''}`);
      continue;
    }
    await prisma.outboxEvent.update({ where: { id: row.id }, data: { status: 'done', doneAt: new Date(), lastError: null } });
    out.done++;
    await hook('outboxAfterRow', row);   // тест: «процесс упал» после части строк
  }
  return out;
}
