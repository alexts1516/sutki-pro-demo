// Напоминания по расписанию: раз в 30 минут ищем подтверждённые брони с заездом сегодня/завтра
// и отправляем событие checkin.upcoming. Повторно одно и то же не уйдёт (dedupeKey в журнале).
import { addDays, todayIn } from '../lib/dates.js';

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

export function startScheduler({ prisma, events, everyMs = 30 * 60 * 1000, logger = console }) {
  const tick = () => runReminders({ prisma, events }).catch(e => logger.error('[scheduler]', e.message));
  const t = setInterval(tick, everyMs); t.unref?.();
  setTimeout(tick, 5000).unref?.();
  return () => clearInterval(t);
}
