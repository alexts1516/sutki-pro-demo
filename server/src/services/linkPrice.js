// Индивидуальная цена брони по личной ссылке (проход 4, раздел 3а спецификации).
// Здесь — ЕДИНСТВЕННАЯ серверная проверка права и ЕДИНСТВЕННОЕ место, где цена меняется вместе с записью журнала
// BookingPriceChange. Сервис ссылок (шаг 6) и его маршруты вызывают только эти функции, своих проверок не дублируют.
//
// Право: владелец — всегда; админ — только если владелец выдал Membership.canSetLinkPrice; другие роли — никогда;
// отключённый сотрудник (active = false) — никогда. Право читается из базы в момент изменения (в той же транзакции),
// поэтому «забрали право» или «отключили» действует сразу, даже при уже открытом входе.
import { prisma } from '../db.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { hook } from '../lib/testHooks.js';
import { withApartmentTx, quote } from './bookings.js';
import { nights as countNights } from '../lib/dates.js';

export const PRICE_FORBIDDEN = 'Индивидуальную цену ставит владелец или администратор с его разрешения';
export const MAX_TOTAL_KZT = 1_000_000_000;   // техническая граница (Int в базе), не бизнес-правило
const REASONS = ['manual', 'link_created'];   // 'dates_changed' — отдельный путь (существующий PATCH дат, шаг 6), без права цены

/** Есть ли у участника аккаунта право на индивидуальную цену (чистая функция по строке Membership). */
export function hasLinkPriceRight(m) {
  if (!m || m.active !== true) return false;
  if (m.role === 'owner') return true;
  return m.role === 'admin' && m.canSetLinkPrice === true;
}

/** Проверить право по базе (db — общий клиент или tx). Возвращает Membership с user; иначе 403. */
export async function assertLinkPriceRight(db, { accountId, userId }) {
  const m = userId ? await db.membership.findUnique({ where: { userId_accountId: { userId, accountId } }, include: { user: { select: { name: true } } } }) : null;
  if (!hasLinkPriceRight(m)) throw forbidden(PRICE_FORBIDDEN);
  return m;
}

/** Ядро внутри уже открытой транзакции квартиры (tx из withApartmentTx): аккаунт и бронь → право → состояние →
 *  условная запись цены → запись журнала. Любая ошибка — откат всего; «цена без записи» невозможна.
 *  Аккаунт, автор, старая цена, стандартная цена и время берутся только на сервере. */
export async function setLinkPriceInTx(tx, { accountId, bookingId, userId, totalKzt, reason = 'manual', now = new Date() }) {
  if (!Number.isInteger(totalKzt) || totalKzt <= 0 || totalKzt > MAX_TOTAL_KZT) throw badRequest('Цена — целое число тенге больше нуля');
  if (!REASONS.includes(reason)) throw badRequest('Неизвестная причина изменения цены');
  const b = await tx.booking.findFirst({ where: { id: bookingId, accountId }, include: { apartment: true, link: true } });
  if (!b) throw notFound('Бронь не найдена');   // чужой аккаунт — как «нет такой брони»
  const actor = await assertLinkPriceRight(tx, { accountId, userId });
  // состояние (раздел 4.3 и 3а): только бронь по ссылке, ссылка active, бронь request с живым удержанием
  const link = b.link && b.link.accountId === accountId ? b.link : null;
  if (!link) throw new HttpError(409, 'Индивидуальная цена — только для брони по личной ссылке');
  if (b.status === 'confirmed' || b.status === 'completed' || link.status === 'completed') throw new HttpError(409, 'Бронь уже подтверждена — цену по ссылке менять нельзя');
  if (b.status !== 'request' || link.status !== 'active' || (b.holdUntil && b.holdUntil <= now)) throw new HttpError(409, 'Ссылка больше не действует — цену менять нельзя');
  if (link.terms === 'deposit' && link.depositKzt && totalKzt < link.depositKzt) throw badRequest('Цена не может быть меньше залога');   // залог — 1…сумма (раздел 6.1)
  if (totalKzt === b.totalKzt) return { changed: false, booking: b, change: null };   // та же сумма — без записи
  const n = countNights(b.checkIn, b.checkOut);
  // цена за ночь пересчитывается, чтобы смена дат (существующее правило: цена за ночь × ночи + животные) осталась пропорциональной
  const nightlyKzt = Math.max(1, Math.round((totalKzt > b.petFeeKzt ? totalKzt - b.petFeeKzt : totalKzt) / n));
  const won = await tx.booking.updateMany({ where: { id: b.id, accountId, status: 'request', totalKzt: b.totalKzt }, data: { totalKzt, nightlyKzt } });
  if (!won.count) throw new HttpError(409, 'Цену только что изменили — обновите страницу');
  await hook('linkPriceBeforeLog', { bookingId: b.id });   // тест: сбой между записью цены и журнала → откат
  const change = await tx.bookingPriceChange.create({
    data: {
      accountId, bookingId: b.id, linkId: link.id, oldTotalKzt: b.totalKzt, newTotalKzt: totalKzt,
      standardTotalKzt: quote(b.apartment, b.checkIn, b.checkOut, b.pets).totalKzt, reason,
      byUserId: actor.userId, byName: actor.user?.name || null, byRole: actor.role,
    },
  });
  return { changed: true, booking: { ...b, totalKzt, nightlyKzt }, change };
}

/** Изменить индивидуальную цену брони по ссылке: одна транзакция квартиры (всё или ничего).
 *  Изменения владельца тоже пишутся в журнал (раздел 3а: «одинаковое правило»). */
export async function setLinkPrice({ accountId, bookingId, userId, totalKzt, reason = 'manual' }) {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, accountId }, select: { apartmentId: true } });
  if (!b) throw notFound('Бронь не найдена');
  return withApartmentTx(b.apartmentId, (tx) => setLinkPriceInTx(tx, { accountId, bookingId, userId, totalKzt, reason }));
}

/** Смена дат брони по ссылке (существующий PATCH дат, внутри его транзакции квартиры): сумма пересчитана существующим
 *  правилом (цена за ночь × ночи + животные) — если изменилась, запись журнала reason 'dates_changed' (раздел 3а).
 *  Права цены не нужно: даты меняют владелец и админ, как в проходе 3. old — бронь до записи, upd — после (с apartment). */
export async function logDatesChangedInTx(tx, { old, upd, actor }) {
  if (old.totalKzt === upd.totalKzt) return null;
  const link = await tx.bookingLink.findUnique({ where: { bookingId: old.id }, select: { id: true, accountId: true } });
  if (!link || link.accountId !== old.accountId) return null;
  return tx.bookingPriceChange.create({
    data: {
      accountId: old.accountId, bookingId: old.id, linkId: link.id, oldTotalKzt: old.totalKzt, newTotalKzt: upd.totalKzt,
      standardTotalKzt: quote(upd.apartment, upd.checkIn, upd.checkOut, upd.pets).totalKzt, reason: 'dates_changed',
      byUserId: actor?.id || null, byName: actor?.name || null, byRole: actor?.type || null,
    },
  });
}
