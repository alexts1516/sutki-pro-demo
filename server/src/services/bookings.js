// Общая логика броней: свободна ли квартира, расчёт цены, создание заявки, подтверждение.
import { prisma } from '../db.js';
import { nights as countNights, addDays } from '../lib/dates.js';
import { randomToken } from '../lib/tokens.js';
import { HttpError } from '../lib/errors.js';
import { withLock } from '../lib/lock.js';
import { DATES_TAKEN, isDeadlockError, toConflict } from '../lib/dbErrors.js';

export const BLOCKING = ['request', 'confirmed'];   // статусы, которые могут держать даты (то же условие, что у booking_no_overlap в PostgreSQL)

/** Держит ли бронь даты сейчас. Подтверждённая — всегда; заявка — пока не истёк срок удержания holdUntil.
 *  holdUntil = null — срок не задан (заявки до шага 4 прохода 4): держит, как раньше. Совпадает с базой:
 *  ограничение booking_no_overlap считает любую request/confirmed, а истёкшие удержания снимаются в той же
 *  транзакции до записи (releaseExpiredHolds в withApartmentTx). */
export function holdsDates(b, now = new Date()) {
  return b.status === 'confirmed' || (b.status === 'request' && (!b.holdUntil || b.holdUntil > now));
}
/** То же условие для запросов Prisma (подставлять через AND) */
export function blockingWhere(now = new Date()) {
  return { OR: [{ status: 'confirmed' }, { status: 'request', OR: [{ holdUntil: null }, { holdUntil: { gt: now } }] }] };
}

/** Снять истёкшие удержания: заявки с holdUntil <= now → cancelled. Условная запись — безопасно при повторе и
 *  при нескольких процессах. Заявки без срока (holdUntil = null) не трогает. db — общий клиент или tx. */
export async function releaseExpiredHolds(db = prisma, { accountId, apartmentId, now = new Date() } = {}) {
  const r = await db.booking.updateMany({
    where: { status: 'request', holdUntil: { not: null, lte: now }, ...(accountId ? { accountId } : {}), ...(apartmentId ? { apartmentId } : {}) },
    data: { status: 'cancelled' },
  });
  return r.count;
}

const isPostgres = () => /^postgres(ql)?:/.test(process.env.DATABASE_URL || '');

/** Единственная точка изменения занятости квартиры: проверка дат и запись — одной транзакцией.
 *  PostgreSQL: блокировка строки квартиры (SELECT … FOR NO KEY UPDATE) упорядочивает все такие транзакции одной
 *  квартиры между любыми процессами; ограничение booking_no_overlap — последняя гарантия базы.
 *  Конфликт (23P01) → 409; взаимная блокировка (40P01) → один повтор всей транзакции, затем 409.
 *  SQLite / память (разработка и демо, один процесс): очередь withLock('apt:'+id).
 *  fn(tx) — только чтения и записи через tx, без внешних действий (уведомлений, водителей): её можно повторить. */
export async function withApartmentTx(apartmentId, fn) {
  const pg = isPostgres();
  const once = () => prisma.$transaction(async (tx) => {
    if (pg) await tx.$queryRaw`SELECT "id" FROM "Apartment" WHERE "id" = ${apartmentId} FOR NO KEY UPDATE`;
    await releaseExpiredHolds(tx, { apartmentId });   // иначе ограничение базы «увидит» истёкшее удержание
    return fn(tx);
  }, pg ? { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 15000 } : { timeout: 15000 });
  const run = async () => {
    try { return await once(); } catch (e) {
      if (pg && isDeadlockError(e)) {
        try { return await once(); } catch (e2) { throw toConflict(e2); }
      }
      throw toConflict(e);
    }
  };
  return pg ? run() : withLock(`apt:${apartmentId}`, run);
}

/** Занятые интервалы квартиры (брони + закрытия на ремонт). db — общий клиент или tx транзакции. */
export async function busyRanges(accountId, apartmentId, from, to, db = prisma) {
  const now = new Date();
  const [bookings, repairs] = await Promise.all([
    db.booking.findMany({ where: { accountId, apartmentId, AND: [blockingWhere(now)], checkIn: { lt: to }, checkOut: { gt: from } }, select: { checkIn: true, checkOut: true }, orderBy: { checkIn: 'asc' } }),
    db.repairTask.findMany({ where: { accountId, apartmentId, blockDays: { gt: 0 }, status: { notIn: ['DONE', 'CANCELLED'] } }, select: { date: true, blockDays: true } }),
  ]);
  return [
    ...bookings.map(b => ({ from: b.checkIn, to: b.checkOut, kind: 'booking' })),
    ...repairs.map(r => ({ from: r.date, to: addDays(r.date, r.blockDays), kind: 'repair' })).filter(r => r.from < to && r.to > from),
  ];
}

/** Свободна ли квартира. Внутри withApartmentTx передавайте tx — проверка и запись идут одной операцией. */
export async function isAvailable(accountId, apartmentId, checkIn, checkOut, excludeBookingId, db = prisma) {
  const clash = await db.booking.findFirst({
    where: { accountId, apartmentId, AND: [blockingWhere()], checkIn: { lt: checkOut }, checkOut: { gt: checkIn }, ...(excludeBookingId ? { NOT: { id: excludeBookingId } } : {}) },
    select: { id: true },
  });
  if (clash) return false;
  const blocks = await busyRanges(accountId, apartmentId, checkIn, checkOut, db);
  return !blocks.some(b => b.kind === 'repair');
}

export function quote(apartment, checkIn, checkOut, pets = false) {
  const n = countNights(checkIn, checkOut);
  const petFeeKzt = pets && apartment.petsAllowed ? apartment.petFeeKzt : 0;
  return { nights: n, nightlyKzt: apartment.basePriceKzt, petFeeKzt, totalKzt: apartment.basePriceKzt * n + petFeeKzt };
}

export async function nextBookingNumber(accountId, db = prisma) {
  const last = await db.booking.findFirst({ where: { accountId }, orderBy: { number: 'desc' }, select: { number: true } });
  return (last?.number || 1000) + 1;
}

/** Создать заявку на бронь (статус request). Бросает 409, если даты заняты.
 *  Проверка и создание — в одной транзакции квартиры (withApartmentTx). Срок удержания (holdUntil) здесь пока
 *  не ставится — это шаг 4 прохода 4 (сайт — только с оплатой, 30 мин); до него заявка держит даты, как раньше. */
export async function createBookingRequest({ accountId, apartment, checkIn, checkOut, guestsCount, guest, source = 'site', pets = false, note, paymentMethod, currencyShown = 'KZT', amountShown = null }) {
  const q = quote(apartment, checkIn, checkOut, pets);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withApartmentTx(apartment.id, async (tx) => {
        if (!(await isAvailable(accountId, apartment.id, checkIn, checkOut, null, tx))) throw new HttpError(409, DATES_TAKEN);
        return tx.booking.create({
          data: {
            accountId, apartmentId: apartment.id, guestId: guest?.id, number: await nextBookingNumber(accountId, tx), token: randomToken(12),
            source, status: 'request', checkIn, checkOut, guestsCount, nightlyKzt: q.nightlyKzt, totalKzt: q.totalKzt, petFeeKzt: q.petFeeKzt,
            pets: !!pets, note, paymentMethod, currencyShown, amountShown,
          },
          include: { apartment: true, guest: true },
        });
      });
    } catch (e) { if (e.code !== 'P2002' || attempt === 2) throw e; }   // номер брони заняли параллельно (другая квартира) — вся транзакция заново
  }
}

/** Подтвердить заявку: статус confirmed + уборка в день выезда + уведомление гостю + заказы водителям на трансферы брони */
export async function confirmBooking({ accountId, bookingId, events, dispatch = null, actor = null }) {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, accountId } });
  if (!b) throw new HttpError(404, 'Бронь не найдена');
  if (b.status === 'confirmed') return b;
  if (b.status !== 'request') throw new HttpError(409, 'Подтвердить можно только новую заявку');
  // условная запись: повторный/одновременный вызов (двойной клик, повтор вебхука оплаты) не создаст вторую подготовку и второй заказ водителям
  const won = await prisma.booking.updateMany({ where: { id: b.id, status: 'request' }, data: { status: 'confirmed', confirmedAt: new Date() } });
  const updated = await prisma.booking.findUnique({ where: { id: b.id }, include: { apartment: true, guest: true } });
  if (!won.count) { if (updated.status === 'confirmed') return updated; throw new HttpError(409, 'Подтвердить можно только новую заявку'); }
  const hasCleaning = await prisma.cleaningTask.findFirst({ where: { bookingId: b.id } });
  if (!hasCleaning) await prisma.cleaningTask.create({ data: { accountId, apartmentId: b.apartmentId, bookingId: b.id, date: b.checkOut, fromTime: b.checkOutTime, status: 'assigned' } });
  events?.emit('booking.confirmed', { accountId, bookingId: b.id });
  if (dispatch) await dispatch.createForBooking({ accountId, bookingId: b.id, actor });   // трансфер «как в Uber» — сразу всем водителям
  return updated;
}
