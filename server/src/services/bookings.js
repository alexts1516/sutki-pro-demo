// Общая логика броней: свободна ли квартира, расчёт цены, создание заявки, подтверждение.
import { prisma } from '../db.js';
import { nights as countNights, addDays, todayIn } from '../lib/dates.js';
import { randomToken } from '../lib/tokens.js';
import { HttpError } from '../lib/errors.js';
import { withLock } from '../lib/lock.js';
import { DATES_TAKEN, isDeadlockError, toConflict } from '../lib/dbErrors.js';
import { hook } from '../lib/testHooks.js';
import { enqueue, runOutbox } from './outbox.js';

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

/** Снять истёкшие удержания: заявки с holdUntil <= now → cancelled + строка журнала event:booking.hold_expired.
 *  Условная запись — безопасно при повторе и при нескольких процессах. Заявки без срока (holdUntil = null) не трогает.
 *  db — tx транзакции квартиры (withApartmentTx) или общий клиент. Возвращает число снятых. */
export async function releaseExpiredHolds(db = prisma, { accountId, apartmentId, now = new Date() } = {}) {
  const where = { status: 'request', holdUntil: { not: null, lte: now }, ...(accountId ? { accountId } : {}), ...(apartmentId ? { apartmentId } : {}) };
  const list = await db.booking.findMany({ where, select: { id: true, accountId: true } });
  let n = 0;
  for (const b of list) {
    const r = await db.booking.updateMany({ where: { ...where, id: b.id }, data: { status: 'cancelled' } });
    if (!r.count) continue;
    n++;
    await enqueue(db, { accountId: b.accountId, kind: 'event', payload: { name: 'booking.hold_expired', data: { accountId: b.accountId, bookingId: b.id } }, dedupeKey: `event:booking.hold_expired:${b.id}` });
  }
  return n;
}

/** Снять истёкшие удержания во всех квартирах (планировщик): по одной транзакции квартиры на каждую. */
export async function releaseAllExpiredHolds({ now = new Date() } = {}) {
  const list = await prisma.booking.findMany({ where: { status: 'request', holdUntil: { not: null, lte: now } }, select: { apartmentId: true } });
  const apts = [...new Set(list.map(b => b.apartmentId))];
  for (const apartmentId of apts) await withApartmentTx(apartmentId, () => null);   // снятие выполняет сама withApartmentTx, под блокировкой квартиры
  return list.length;
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

/** Только очередь по квартире, без общей транзакции для fn: PostgreSQL — транзакция, держащая блокировку строки
 *  квартиры (FOR NO KEY UPDATE), пока fn пишет обычным клиентом; SQLite / память — withLock('apt:'+id).
 *  Для действий журнала по брони (заказы водителям и их отмена): они идут строго по очереди с подтверждением и
 *  отменой этой брони, поэтому «подтвердили и тут же отменили» не оставит активный заказ. fn не должна сама брать
 *  транзакцию этой же квартиры. */
export async function withApartmentLock(apartmentId, fn) {
  if (!isPostgres()) return withLock(`apt:${apartmentId}`, fn);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Apartment" WHERE "id" = ${apartmentId} FOR NO KEY UPDATE`;
    return fn();
  }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 60000 });
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

export const turnoverKey = (bookingId) => `turnover:${bookingId}`;
/** Обязательная подготовка после выезда: одна на бронь — уникальный CleaningTask.autoKey (а не «найти, потом создать»). */
async function ensureTurnover(db, b) {
  return db.cleaningTask.upsert({
    where: { autoKey: turnoverKey(b.id) },
    create: { accountId: b.accountId, apartmentId: b.apartmentId, bookingId: b.id, date: b.checkOut, fromTime: b.checkOutTime, status: 'assigned', autoKey: turnoverKey(b.id) },
    update: {},
  });
}
export const confirmKeys = (bookingId) => [`event:booking.confirmed:${bookingId}`, `transfers.dispatch:${bookingId}`];

/** Подтвердить заявку — единственная точка подтверждения (оплата на сайте, админ; на шаге 6 — ссылка).
 *  В ОДНОЙ транзакции квартиры (всё или ничего): перечитать бронь, снять истёкшие удержания, условная запись
 *  request → confirmed (+ confirmedAt, holdUntil = null), обязательная подготовка (autoKey) и строки журнала:
 *  уведомление гостю (booking.confirmed) и заказы водителям (transfers.dispatch).
 *  После коммита — прогон этих строк журнала (Telegram, водители); упадёт — достроит планировщик.
 *  Повтор / одновременный вызов: побеждает одна условная запись, остальные получают «подтверждена» без вторых эффектов. */
export async function confirmBooking({ accountId, bookingId, events, dispatch = null, actor = null }) {
  const b0 = await prisma.booking.findFirst({ where: { id: bookingId, accountId }, select: { apartmentId: true } });
  if (!b0) throw new HttpError(404, 'Бронь не найдена');
  const booking = await withApartmentTx(b0.apartmentId, async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: bookingId, accountId } });
    if (!b) throw new HttpError(404, 'Бронь не найдена');
    if (b.status === 'confirmed') return tx.booking.findUnique({ where: { id: b.id }, include: { apartment: true, guest: true } });
    if (b.status !== 'request') throw new HttpError(409, 'Подтвердить можно только новую заявку');
    const won = await tx.booking.updateMany({ where: { id: b.id, status: 'request' }, data: { status: 'confirmed', confirmedAt: new Date(), holdUntil: null } });
    if (!won.count) throw new HttpError(409, 'Подтвердить можно только новую заявку');   // под блокировкой квартиры не бывает; на всякий случай
    await ensureTurnover(tx, b);
    const [eventKey, dispatchKey] = confirmKeys(b.id);
    await enqueue(tx, { accountId, kind: 'event', payload: { name: 'booking.confirmed', data: { accountId, bookingId: b.id } }, dedupeKey: eventKey });
    await enqueue(tx, { accountId, kind: 'transfers.dispatch', payload: { bookingId: b.id, actor }, dedupeKey: dispatchKey });
    await hook('confirmBeforeCommit', { bookingId: b.id });   // тест: «падение» до коммита → откат всего
    return tx.booking.findUnique({ where: { id: b.id }, include: { apartment: true, guest: true } });
  });
  await hook('confirmAfterCommit', { bookingId });   // тест: «падение» после коммита, до журнала
  await runOutbox({ events, dispatch, keys: confirmKeys(bookingId) }).catch(() => {});   // лучшее усилие; не вышло — планировщик
  return booking;
}

/** Отменить бронь — единая точка отмены (правила прохода 3 без изменений).
 *  В транзакции квартиры: перечитать, проверить правила, условная запись → cancelled (даты свободны), удалить только
 *  неначатую подготовку (assigned), строка журнала transfers.cancel. После коммита — отмена заказов водителям.
 *  Повтор — 409 «Бронь уже отменена» без каких-либо эффектов. */
export async function cancelBooking({ accountId, bookingId, today, events = null, dispatch = null, actor = null, reason = 'Бронь отменена' }) {
  const b0 = await prisma.booking.findFirst({ where: { id: bookingId, accountId }, select: { apartmentId: true } });
  if (!b0) throw new HttpError(404, 'Бронь не найдена');
  const key = `transfers.cancel:${bookingId}`;
  const booking = await withApartmentTx(b0.apartmentId, async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: bookingId, accountId } });
    if (!b) throw new HttpError(404, 'Бронь не найдена');
    if (!BLOCKING.includes(b.status)) throw new HttpError(409, b.status === 'cancelled' ? 'Бронь уже отменена' : 'Бронь завершена — отменить нельзя');
    if (b.status === 'confirmed' && today && b.checkOut <= today) throw new HttpError(409, 'Гость уже выехал — отменить нельзя');
    const won = await tx.booking.updateMany({ where: { id: b.id, status: b.status }, data: { status: 'cancelled' } });
    if (!won.count) throw new HttpError(409, 'Бронь уже отменена');
    await tx.cleaningTask.deleteMany({ where: { bookingId: b.id, status: 'assigned' } });   // начатую и законченную подготовку не трогаем
    await enqueue(tx, { accountId, kind: 'transfers.cancel', payload: { bookingId: b.id, actor, reason }, dedupeKey: key });
    return tx.booking.findUnique({ where: { id: b.id }, include: { apartment: true, guest: true } });
  });
  await runOutbox({ events, dispatch, keys: [key] }).catch(() => {});
  return booking;
}

/** Сверка (reconciler), раздел 4.5: достроить то, что могло потеряться (старые данные, сбой, ручная правка базы).
 *  1) подтверждённая бронь с выездом ≥ сегодня без единой подготовки → обязательная подготовка (autoKey);
 *  2) активный трансфер подтверждённой брони без заказа и без ожидающей строки журнала → строка transfers.dispatch;
 *  3) отменённая бронь с незакрытым заказом водителю → строка transfers.cancel.
 *  Повтор ничего не дублирует (уникальные autoKey и dedupeKey). Невыполненные строки журнала после перезапуска
 *  подхватывает runOutbox (истёкшая аренда = строку можно брать снова). */
export async function reconcileBookings({ now = new Date(), limit = 200 } = {}) {
  const out = { preps: 0, dispatch: 0, cancel: 0 };
  const accounts = await prisma.account.findMany({ select: { id: true, timezone: true } });
  for (const acc of accounts) {
    const today = todayIn(acc.timezone, now);
    const noPrep = await prisma.booking.findMany({ where: { accountId: acc.id, status: 'confirmed', checkOut: { gte: today }, cleanings: { none: {} } }, select: { id: true, apartmentId: true }, take: limit });
    for (const x of noPrep) {
      const made = await withApartmentTx(x.apartmentId, async (tx) => {
        const b = await tx.booking.findUnique({ where: { id: x.id } });
        if (b?.status !== 'confirmed' || await tx.cleaningTask.findFirst({ where: { bookingId: b.id }, select: { id: true } })) return false;
        await ensureTurnover(tx, b);
        return true;
      });
      if (made) out.preps++;
    }
    const orphans = await prisma.transfer.findMany({ where: { accountId: acc.id, status: { notIn: ['cancelled', 'done'] }, job: null, date: { gte: today }, booking: { status: 'confirmed' } }, select: { id: true, bookingId: true }, take: limit });
    for (const t of orphans) {
      const waiting = await prisma.outboxEvent.findFirst({ where: { status: 'pending', dedupeKey: { startsWith: `transfers.dispatch:${t.bookingId}` } }, select: { id: true } });
      if (waiting) continue;
      const key = `transfers.dispatch:${t.bookingId}:transfer:${t.id}`;
      if (await prisma.outboxEvent.findUnique({ where: { dedupeKey: key }, select: { id: true } })) continue;   // уже чинили этот трансфер (done/failed — разбор вручную)
      await enqueue(prisma, { accountId: acc.id, kind: 'transfers.dispatch', payload: { bookingId: t.bookingId, actor: { type: 'system', name: 'Сверка' } }, dedupeKey: key });
      out.dispatch++;
    }
    const stale = await prisma.transferJob.findMany({ where: { accountId: acc.id, status: { notIn: ['DONE', 'CANCELLED'] }, booking: { status: 'cancelled' } }, select: { id: true, bookingId: true }, take: limit });
    for (const j of stale) {
      const key = `transfers.cancel:${j.bookingId}:job:${j.id}`;
      if (await prisma.outboxEvent.findUnique({ where: { dedupeKey: key }, select: { id: true } })) continue;
      await enqueue(prisma, { accountId: acc.id, kind: 'transfers.cancel', payload: { bookingId: j.bookingId, actor: { type: 'system', name: 'Сверка' }, reason: 'Бронь отменена' }, dedupeKey: key });
      out.cancel++;
    }
  }
  return out;
}
