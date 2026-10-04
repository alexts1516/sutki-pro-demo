// Общая логика броней: свободна ли квартира, расчёт цены, создание заявки, подтверждение.
import { prisma } from '../db.js';
import { nights as countNights, addDays } from '../lib/dates.js';
import { randomToken } from '../lib/tokens.js';
import { HttpError } from '../lib/errors.js';

export const BLOCKING = ['request', 'confirmed'];   // заявки тоже держат даты, чтобы не было двойной брони

/** Занятые интервалы квартиры (брони + закрытия на ремонт) */
export async function busyRanges(accountId, apartmentId, from, to) {
  const [bookings, repairs] = await Promise.all([
    prisma.booking.findMany({ where: { accountId, apartmentId, status: { in: BLOCKING }, checkIn: { lt: to }, checkOut: { gt: from } }, select: { checkIn: true, checkOut: true }, orderBy: { checkIn: 'asc' } }),
    prisma.repairTask.findMany({ where: { accountId, apartmentId, blockDays: { gt: 0 }, status: { notIn: ['DONE', 'CANCELLED'] } }, select: { date: true, blockDays: true } }),
  ]);
  return [
    ...bookings.map(b => ({ from: b.checkIn, to: b.checkOut, kind: 'booking' })),
    ...repairs.map(r => ({ from: r.date, to: addDays(r.date, r.blockDays), kind: 'repair' })).filter(r => r.from < to && r.to > from),
  ];
}

export async function isAvailable(accountId, apartmentId, checkIn, checkOut, excludeBookingId) {
  const clash = await prisma.booking.findFirst({
    where: { accountId, apartmentId, status: { in: BLOCKING }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn }, ...(excludeBookingId ? { NOT: { id: excludeBookingId } } : {}) },
    select: { id: true },
  });
  if (clash) return false;
  const blocks = await busyRanges(accountId, apartmentId, checkIn, checkOut);
  return !blocks.some(b => b.kind === 'repair');
}

export function quote(apartment, checkIn, checkOut, pets = false) {
  const n = countNights(checkIn, checkOut);
  const petFeeKzt = pets && apartment.petsAllowed ? apartment.petFeeKzt : 0;
  return { nights: n, nightlyKzt: apartment.basePriceKzt, petFeeKzt, totalKzt: apartment.basePriceKzt * n + petFeeKzt };
}

export async function nextBookingNumber(accountId) {
  const last = await prisma.booking.findFirst({ where: { accountId }, orderBy: { number: 'desc' }, select: { number: true } });
  return (last?.number || 1000) + 1;
}

/** Создать заявку на бронь (статус request). Бросает 409, если даты заняты. */
export async function createBookingRequest({ accountId, apartment, checkIn, checkOut, guestsCount, guest, source = 'site', pets = false, note, paymentMethod, currencyShown = 'KZT', amountShown = null }) {
  if (!(await isAvailable(accountId, apartment.id, checkIn, checkOut))) throw new HttpError(409, 'Эти даты уже заняты');
  const q = quote(apartment, checkIn, checkOut, pets);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.booking.create({
        data: {
          accountId, apartmentId: apartment.id, guestId: guest?.id, number: await nextBookingNumber(accountId), token: randomToken(12),
          source, status: 'request', checkIn, checkOut, guestsCount, nightlyKzt: q.nightlyKzt, totalKzt: q.totalKzt, petFeeKzt: q.petFeeKzt,
          pets: !!pets, note, paymentMethod, currencyShown, amountShown,
        },
        include: { apartment: true, guest: true },
      });
    } catch (e) { if (e.code !== 'P2002' || attempt === 2) throw e; }   // номер заняли параллельно — пробуем следующий
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
