// Личная ссылка для особой брони (проход 4, шаг 6; разделы 3, 4, 5, 6.1, 8 спецификации) — серверное ядро.
// Бронь — обычная Booking (status 'request', source 'link', holdUntil = срок ссылки); у неё ровно одна BookingLink.
// Хранимые статусы ссылки: active | completed | expired | revoked | cancelled; всё остальное (stage, missing) вычисляется.
// Токен: randomToken(32) — 256 бит; в базе только sha256 (tokenHash); сам токен отдаётся один раз — при создании и «Новой ссылке».
// Срок — только Booking.holdUntil. Истечение — общий releaseExpiredHolds (транзакция квартиры, планировщик, ленивое чтение).
// Подтверждение — общее ядро confirmRequestInTx (то же, что у confirmBooking и оплаты). Отмена/отзыв — cancelBooking().
// Индивидуальная цена — только services/linkPrice.js (право + цена + журнал одной транзакцией).
// Гостевого API здесь нет (шаг 7); findLinkByToken — внутренняя функция для тестов и шага 7.
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { randomToken } from '../lib/tokens.js';
import { isoDay, nights as countNights, todayIn, DAY_MS } from '../lib/dates.js';
import { createBookingRequest, withApartmentTx, releaseAllExpiredHolds, cancelBooking, confirmRequestInTx, confirmKeys, isAvailable, quote } from './bookings.js';
import { enqueue, runOutbox } from './outbox.js';
import { assertLinkPriceRight, setLinkPriceInTx, setLinkPrice, MAX_TOTAL_KZT } from './linkPrice.js';

export const LINK_TERMS = ['cash_on_arrival', 'deposit'];
export const LINK_HOURS = { def: 24, min: 1, max: 72 };   // срок ссылки при создании и шаг продления (раздел 6.1)
export const LINK_MAX_DAYS = 7;                            // итоговый срок — не дольше 7 суток от создания
export const LINK_TOKEN_BYTES = 32;                        // 256 бит → 43 символа base64url
const MAX_NIGHTS = 90;
const EXPIRED_MSG = 'Ссылка истекла — создайте новую';
const CLOSED_MSG = { completed: 'Бронь по ссылке уже подтверждена', expired: EXPIRED_MSG, revoked: 'Ссылка отозвана', cancelled: 'Бронь отменена — ссылка закрыта' };

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
/** Отпечаток предложения, с которым согласился гость: sha256(checkIn|checkOut|totalKzt|terms|depositKzt) (раздел 4.2). */
export const termsHashOf = (b, link) => crypto.createHash('sha256').update([isoDay(b.checkIn), isoDay(b.checkOut), b.totalKzt, link.terms, link.depositKzt ?? ''].join('|')).digest('hex');
const linkKeys = (linkId) => [`event:link.completed:${linkId}`, `event:link.conflict:${linkId}`];

/** Заявка с истёкшим удержанием, ещё не снятая планировщиком, — уже истекла (строгая граница: ровно в holdUntil — истекло). */
const holdExpired = (b, now = new Date()) => b.status === 'request' && !!b.holdUntil && b.holdUntil <= now;
/** Действующий статус ссылки (с учётом ещё не снятого истечения). */
export const linkStatus = (link, b, now = new Date()) => (link.status === 'active' && holdExpired(b, now) ? 'expired' : link.status);

/** Что ещё не выполнено (раздел 4.2). Паспорт и билет сюда не входят никогда. b — бронь с guest. */
export function missing(link, b) {
  const m = [];
  if (!b.guest?.name?.trim() || !b.guest?.phone?.trim()) m.push('guest');
  if (!link.termsAcceptedAt || link.termsHash !== termsHashOf(b, link)) m.push('terms');
  if (link.terms === 'deposit' && !link.depositReceivedAt) m.push('deposit');
  if (link.extraCheckRequired && !link.extraCheckedAt) m.push('extra_check');
  return m;
}
/** Подсостояние активной ссылки (не хранится): waiting_guest | guest_started | waiting_admin | ready; закрытой — её статус. */
export function stage(link, b, now = new Date()) {
  const st = linkStatus(link, b, now);
  if (st !== 'active') return st;
  const m = missing(link, b);
  if (!m.length) return 'ready';
  if (!link.guestStartedAt) return 'waiting_guest';
  return m.every(x => x === 'deposit' || x === 'extra_check') ? 'waiting_admin' : 'guest_started';
}

/** LinkOut (раздел 6.1). Ни токена, ни его хэша. b — бронь с apartment и guest. */
export function linkOut(link, b, now = new Date()) {
  const std = quote(b.apartment, b.checkIn, b.checkOut, b.pets).totalKzt;
  const st = linkStatus(link, b, now);
  return {
    id: link.id, bookingId: b.id, bookingNumber: b.number, bookingStatus: b.status, status: st, stage: stage(link, b, now), missing: st === 'active' ? missing(link, b) : [],
    guest: { name: b.guest?.name || null, phone: b.guest?.phone || null },
    apartment: { id: b.apartment.id, title: b.apartment.title, code: b.apartment.code || null },
    checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut), nights: countNights(b.checkIn, b.checkOut), guestsCount: b.guestsCount,
    totalKzt: b.totalKzt, standardTotalKzt: std, individualPrice: b.totalKzt !== std,
    terms: link.terms, depositKzt: link.depositKzt, extraCheckRequired: link.extraCheckRequired, extraCheckNote: link.extraCheckNote, note: link.note,
    holdUntil: b.holdUntil, createdAt: link.createdAt, createdByName: link.createdByName,
    openCount: link.openCount, lastOpenedAt: link.lastOpenedAt, guestStartedAt: link.guestStartedAt, submittedAt: link.submittedAt, termsAcceptedAt: link.termsAcceptedAt,
    depositReceivedAt: link.depositReceivedAt, depositMarkedBy: link.depositMarkedBy, extraCheckedAt: link.extraCheckedAt, extraCheckedBy: link.extraCheckedBy,
    completedAt: link.completedAt, closedAt: link.closedAt, closedByName: link.closedByName,
  };
}

const withBooking = { booking: { include: { apartment: true, guest: true } } };
async function load(db, accountId, linkId) {
  const link = await db.bookingLink.findFirst({ where: { id: String(linkId), accountId }, include: withBooking });
  if (!link) throw notFound('Ссылка не найдена');   // чужой аккаунт — как «нет такой»
  return link;
}
const out = (link) => linkOut(link, link.booking);
/** Отказ возвращается из транзакции (а не бросается), чтобы снятие истёкшего удержания в ней закоммитилось. */
async function inAptTx(accountId, linkId, fn) {
  const { booking } = await load(prisma, accountId, linkId);
  const r = await withApartmentTx(booking.apartmentId, async (tx) => fn(tx, await load(tx, accountId, linkId)));
  if (r?.refuse) throw new HttpError(409, r.refuse);
  return r;
}

/** Ленивое истечение при чтении: снять истёкшие удержания аккаунта (транзакция квартиры на каждую). */
export const releaseExpiredLinks = (accountId) => releaseAllExpiredHolds({ accountId });

// ---------- создание ----------
/** Создать ссылку: одна транзакция квартиры — проверка дат, Guest, Booking(request, source 'link', holdUntil), BookingLink,
 *  при индивидуальной цене — цена + запись журнала (linkPrice.setLinkPriceInTx). Всё или ничего.
 *  actor = { id, name, type } (сервер, из входа). Возвращает { link: LinkOut, token } — токен только здесь. */
export async function createLink({ accountId, actor, apartmentId, checkIn, checkOut, guestsCount, terms, depositKzt = null, totalKzt = null, expiresInHours = LINK_HOURS.def, extraCheckRequired = false, extraCheckNote = null, guestName = null, guestPhone = null, note = null, now = new Date() }) {
  const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
  const apt = await prisma.apartment.findFirst({ where: { id: String(apartmentId), accountId, active: true } });
  if (!acc || !apt) throw notFound('Квартира не найдена');
  if (!(checkIn instanceof Date) || !(checkOut instanceof Date) || isNaN(checkIn) || isNaN(checkOut) || checkOut <= checkIn) throw badRequest('Проверьте даты заезда и выезда');
  if (checkIn < todayIn(acc.timezone, now)) throw badRequest('Дата заезда уже прошла');
  if (countNights(checkIn, checkOut) > MAX_NIGHTS) throw badRequest(`Максимум ${MAX_NIGHTS} ночей`);
  if (!Number.isInteger(guestsCount) || guestsCount < 1) throw badRequest('Укажите число гостей');
  if (guestsCount > apt.maxGuests) throw badRequest(`В этой квартире максимум ${apt.maxGuests} гостей`);
  if (!LINK_TERMS.includes(terms)) throw badRequest('Условия: наличные при заезде или залог');
  if (!Number.isInteger(expiresInHours) || expiresInHours < LINK_HOURS.min || expiresInHours > LINK_HOURS.max) throw badRequest(`Срок ссылки — от ${LINK_HOURS.min} до ${LINK_HOURS.max} ч`);
  const std = quote(apt, checkIn, checkOut, false).totalKzt;
  if (totalKzt != null && (!Number.isInteger(totalKzt) || totalKzt <= 0 || totalKzt > MAX_TOTAL_KZT)) throw badRequest('Цена — целое число тенге больше нуля');
  const custom = totalKzt != null && totalKzt !== std;
  const finalTotal = custom ? totalKzt : std;
  if (terms === 'deposit') {
    if (!Number.isInteger(depositKzt) || depositKzt < 1 || depositKzt > finalTotal) throw badRequest('Залог — целое число тенге от 1 до суммы брони');
  } else if (depositKzt != null) throw badRequest('Залог указывается только для условий «залог»');
  // право на индивидуальную цену — до любых записей (та же единая проверка, что и внутри транзакции)
  if (custom) await assertLinkPriceRight(prisma, { accountId, userId: actor?.id });
  const token = randomToken(LINK_TOKEN_BYTES);
  const linkId = await createBookingRequest({
    accountId, apartment: apt, checkIn, checkOut, guestsCount, guest: null, source: 'link', paymentMethod: terms,
    holdUntil: new Date(now.getTime() + expiresInHours * 3600000),
    onCreated: async (tx, b) => {
      const g = await tx.guest.create({ data: { accountId, name: guestName?.trim() || '', phone: guestPhone?.trim() || null } });   // минимальный гость; данные дополнит гость (шаг 7)
      await tx.booking.update({ where: { id: b.id }, data: { guestId: g.id } });
      const link = await tx.bookingLink.create({
        data: {
          accountId, bookingId: b.id, tokenHash: hashToken(token), status: 'active', terms, depositKzt: terms === 'deposit' ? depositKzt : null,
          extraCheckRequired: !!extraCheckRequired, extraCheckNote: extraCheckRequired ? (extraCheckNote?.trim() || null) : null, note: note?.trim() || null,
          createdById: actor?.id || null, createdByName: actor?.name || null,
        },
      });
      if (custom) await setLinkPriceInTx(tx, { accountId, bookingId: b.id, userId: actor?.id, totalKzt, reason: 'link_created', now });
      return link.id;
    },
  });
  return { link: out(await load(prisma, accountId, linkId)), token };
}

// ---------- чтение ----------
export async function getLink({ accountId, linkId }) {
  await releaseExpiredLinks(accountId);
  return out(await load(prisma, accountId, linkId));
}
export async function listLinks({ accountId, status = 'active' }) {
  await releaseExpiredLinks(accountId);
  const list = await prisma.bookingLink.findMany({ where: { accountId, ...(status === 'all' ? {} : { status: 'active' }) }, include: withBooking, orderBy: { createdAt: 'desc' }, take: 500 });
  return list.map(out);
}
export async function priceHistory({ accountId, linkId }) {
  const link = await load(prisma, accountId, linkId);
  return prisma.bookingPriceChange.findMany({ where: { accountId, bookingId: link.bookingId }, orderBy: { createdAt: 'asc' } });
}

/** Внутренняя (шаг 7 и тесты): найти ссылку по сырому токену — поиск только по хэшу; длина 40–64, иначе null без запроса.
 *  Истёкшая, но не снятая — снимается сразу (транзакция квартиры). Возвращает ссылку с бронью или null. */
export async function findLinkByToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length < 40 || rawToken.length > 64) return null;
  const tokenHash = hashToken(rawToken);
  let link = await prisma.bookingLink.findUnique({ where: { tokenHash }, include: withBooking });
  if (link && link.status === 'active' && holdExpired(link.booking)) {
    await withApartmentTx(link.booking.apartmentId, () => null);
    link = await prisma.bookingLink.findUnique({ where: { tokenHash }, include: withBooking });
  }
  return link;
}

// ---------- продление, новая ссылка, отзыв ----------
/** Продлить: только active с живым удержанием; holdUntil += hours (1…72), итог ≤ 7 суток от создания ссылки. */
export async function extendLink({ accountId, linkId, hours, now = new Date() }) {
  if (!Number.isInteger(hours) || hours < LINK_HOURS.min || hours > LINK_HOURS.max) throw badRequest(`Продлить можно на ${LINK_HOURS.min}–${LINK_HOURS.max} ч`);
  await inAptTx(accountId, linkId, async (tx, link) => {
    const b = link.booking;
    const st = linkStatus(link, b, now);
    if (st !== 'active') return { refuse: st === 'expired' ? EXPIRED_MSG : `${CLOSED_MSG[st] || 'Ссылка закрыта'} — продлить нельзя` };
    const next = new Date(b.holdUntil.getTime() + hours * 3600000);
    if (next.getTime() > link.createdAt.getTime() + LINK_MAX_DAYS * DAY_MS) return { refuse: `Ссылка действует не дольше ${LINK_MAX_DAYS} суток от создания` };
    const won = await tx.booking.updateMany({ where: { id: b.id, status: 'request', holdUntil: b.holdUntil }, data: { holdUntil: next } });
    if (!won.count) return { refuse: 'Ссылку только что изменили — обновите страницу' };
    return null;
  });
  return out(await load(prisma, accountId, linkId));
}

/** «Новая ссылка»: та же бронь и даты, хэш заменяется одной условной записью — старый токен сразу не работает. */
export async function rotateLink({ accountId, linkId, now = new Date() }) {
  const token = randomToken(LINK_TOKEN_BYTES);
  await inAptTx(accountId, linkId, async (tx, link) => {
    const st = linkStatus(link, link.booking, now);
    if (st !== 'active') return { refuse: `${CLOSED_MSG[st] || 'Ссылка закрыта'} — новую ссылку не выпустить` };
    const won = await tx.bookingLink.updateMany({ where: { id: link.id, status: 'active', tokenHash: link.tokenHash }, data: { tokenHash: hashToken(token) } });
    if (!won.count) return { refuse: 'Ссылку только что изменили — обновите страницу' };
    return null;
  });
  return { link: out(await load(prisma, accountId, linkId)), token };
}

/** Отозвать: active → revoked, бронь → cancelled через единую cancelBooking (она же закрывает ссылку), даты свободны.
 *  Повтор и уже закрытая (expired/revoked/cancelled) — 200 без эффектов. Подтверждённую (completed) отзыв не трогает — 409:
 *  это обычная бронь, её отменяют обычной отменой (ссылка станет cancelled). */
export async function revokeLink({ accountId, linkId, actor = null, events = null, dispatch = null, reason = null }) {
  const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
  const link = await load(prisma, accountId, linkId);
  const st = linkStatus(link, link.booking);
  if (st === 'completed') throw new HttpError(409, 'Бронь по ссылке уже подтверждена — отмените бронь обычной отменой');
  if (st === 'active') {
    try {
      await cancelBooking({ accountId, bookingId: link.bookingId, today: todayIn(acc.timezone), events, dispatch, actor, reason: reason || 'Ссылка отозвана', onlyStatus: 'request' });   // подтверждённую параллельно — не отменять
    } catch (e) { if (e.status !== 409) throw e; }   // уже отменена/истекла параллельно — вернуть текущее состояние
  }
  const cur = await load(prisma, accountId, linkId);
  if (cur.status === 'completed') throw new HttpError(409, 'Бронь по ссылке уже подтверждена — отмените бронь обычной отменой');
  return out(cur);
}

// ---------- отметки админа и подтверждение ----------
/** Подтвердить, если всё выполнено (раздел 4.3): ссылка active, гость нажал «Подтвердить» (submittedAt), missing() пуст,
 *  удержание живо (now < holdUntil). Внутри транзакции квартиры. Даты закрыты (ремонт) — подтверждения нет, строка
 *  event:link.conflict (раздел 4.3; пункт «Сегодня» — шаг 8). Возвращает { completed?, conflict?, keys }. */
export async function completeIfReadyInTx(tx, linkId, { actor = null, now = new Date() } = {}) {
  const link = await tx.bookingLink.findUnique({ where: { id: linkId }, include: { booking: { include: { guest: true } } } });
  const b = link?.booking;
  if (!b || link.status !== 'active' || !link.submittedAt || b.status !== 'request' || holdExpired(b, now) || missing(link, b).length) return { keys: [] };
  if (!(await isAvailable(b.accountId, b.apartmentId, b.checkIn, b.checkOut, b.id, tx))) {
    const key = `event:link.conflict:${link.id}`;
    await enqueue(tx, { accountId: b.accountId, kind: 'event', payload: { name: 'link.conflict', data: { accountId: b.accountId, bookingId: b.id, linkId: link.id } }, dedupeKey: key });
    return { conflict: true, keys: [key] };
  }
  await confirmRequestInTx(tx, b, { actor });   // общее ядро: бронь confirmed, подготовка, журнал; ссылка → completed
  return { completed: true, keys: [...confirmKeys(b.id), ...linkKeys(link.id)] };
}
const CONFLICT_MSG = 'Даты стали недоступны (закрыты ремонтом) — бронь не подтверждена';

async function mark({ accountId, linkId, actor, events, dispatch, kind, now = new Date() }) {
  const r = await inAptTx(accountId, linkId, async (tx, link) => {
    const isDeposit = kind === 'deposit';
    if (isDeposit && link.terms !== 'deposit') return { refuse: 'Для этой ссылки залог не нужен' };
    if (!isDeposit && !link.extraCheckRequired) return { refuse: 'Дополнительное подтверждение для этой ссылки не запрашивалось' };
    if (isDeposit ? link.depositReceivedAt : link.extraCheckedAt) return { keys: [] };   // повтор — 200 без эффектов
    const st = linkStatus(link, link.booking, now);
    if (st !== 'active') return { refuse: `${CLOSED_MSG[st] || 'Ссылка закрыта'} — отметить нельзя` };
    const who = actor?.name || null;   // кто и когда — только сервер
    const data = isDeposit ? { depositReceivedAt: now, depositMarkedBy: who } : { extraCheckedAt: now, extraCheckedBy: who };
    const won = await tx.bookingLink.updateMany({ where: { id: link.id, status: 'active', ...(isDeposit ? { depositReceivedAt: null } : { extraCheckedAt: null }) }, data });
    if (!won.count) return { keys: [] };
    if (isDeposit) await tx.booking.updateMany({ where: { id: link.bookingId, status: 'request' }, data: { paymentStatus: 'prepaid' } });   // раздел 4.3
    return completeIfReadyInTx(tx, link.id, { actor, now });
  });
  if (r.keys.length) await runOutbox({ events, dispatch, keys: r.keys }).catch(() => {});   // лучшее усилие; иначе — планировщик
  const res = out(await load(prisma, accountId, linkId));
  return r.conflict ? { ...res, conflict: CONFLICT_MSG } : res;
}
/** «Залог получен»: условная запись (where depositReceivedAt IS NULL), бронь → prepaid; если всё выполнено — подтверждение. */
export const markDeposit = (o) => mark({ ...o, kind: 'deposit' });
/** «Подтверждение получено» (паспорт/билет — вне системы, только отметка); если всё выполнено — подтверждение. */
export const markExtraCheck = (o) => mark({ ...o, kind: 'extra_check' });

/** Изменить индивидуальную цену активной ссылки — только через linkPrice.setLinkPrice (право, состояние, журнал). */
export async function changeLinkPrice({ accountId, linkId, actor, totalKzt }) {
  const link = await load(prisma, accountId, linkId);
  await setLinkPrice({ accountId, bookingId: link.bookingId, userId: actor?.id, totalKzt, reason: 'manual' });
  return out(await load(prisma, accountId, linkId));
}
