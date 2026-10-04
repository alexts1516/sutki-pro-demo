// Напоминания по расписанию: раз в 30 минут ищем подтверждённые брони с заездом сегодня/завтра
// и отправляем событие checkin.upcoming. Повторно одно и то же не уйдёт (dedupeKey в журнале).
import { addDays, todayIn } from '../lib/dates.js';
import { releaseAllExpiredHolds, reconcileBookings } from '../services/bookings.js';
import { reconcileLinkConflicts } from '../services/bookingLinks.js';
import { runOutbox } from '../services/outbox.js';

export async function runReminders({ prisma, events, now = new Date() }) {
  const accounts = await prisma.account.findMany({ where: { status: { in: ['active', 'past_due'] } }, select: { id: true, timezone: true } });
  let n = 0;
  for (const acc of accounts) {
    const today = todayIn(acc.timezone, now);
    const list = await prisma.booking.findMany({
      where: { accountId: acc.id, status: 'confirmed', checkIn: { gte: today, lt: addDays(today, 2) } },
      select: { id: true, checkIn: true },
    });
    for (const b of list) {
      events.emit('checkin.upcoming', { accountId: acc.id, bookingId: b.id, when: +b.checkIn === +today ? 'today' : 'tomorrow' });
      n++;
    }
  }
  return n;
}

/** Брони (проход 4, шаг 3): снять истёкшие удержания → сверка (достроить потерянное) → журнал отложенных действий.
 *  Безопасно при нескольких копиях сервера: удержания — под блокировкой квартиры, строки журнала — с арендой. */
export async function runBookingMaintenance({ events, dispatch = null, logger = null, now = new Date() }) {
  const released = await releaseAllExpiredHolds({ now });
  const reconciled = await reconcileBookings({ now });
  await reconcileLinkConflicts({ now });
  const outbox = await runOutbox({ events, dispatch, logger });
  return { released, reconciled, outbox };
}

/** dispatch — диспетчер трансферов (эскалация «никто не взял», напоминания водителям); проверяем каждые 5 минут */
export function startScheduler({ prisma, events, dispatch = null, payouts = null, everyMs = 30 * 60 * 1000, dispatchEveryMs = 5 * 60 * 1000, bookingsEveryMs = 60 * 1000, logger = console }) {
  // брони: при старте (через 3 с) и раз в минуту; следующий прогон не начинается, пока не закончился предыдущий
  let busy = false;
  const tick3 = async () => {
    if (busy) return; busy = true;
    try { await runBookingMaintenance({ events, dispatch, logger }); } catch (e) { logger.error('[scheduler:bookings]', e.message); } finally { busy = false; }
  };
  const t3 = setInterval(tick3, bookingsEveryMs); t3.unref?.();
  setTimeout(tick3, 3000).unref?.();
  const tick = () => runReminders({ prisma, events }).catch(e => logger.error('[scheduler]', e.message));
  const t = setInterval(tick, everyMs); t.unref?.();
  setTimeout(tick, 5000).unref?.();
  let t2 = null;
  if (dispatch) {
    const tick2 = () => {
      dispatch.runDispatch().catch(e => logger.error('[scheduler:transfers]', e.message));
      payouts?.remind().catch(e => logger.error('[scheduler:payouts]', e.message));   // «не выплачено N часов» — владельцу
    };
    t2 = setInterval(tick2, dispatchEveryMs); t2.unref?.();
    setTimeout(tick2, 7000).unref?.();
  }
  return () => { clearInterval(t); clearInterval(t3); if (t2) clearInterval(t2); };
}
