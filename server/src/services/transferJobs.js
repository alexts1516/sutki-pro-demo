// Трансферы «как в Uber»: заказ-наряд (TransferJob) для водителя. Вся машина состояний здесь,
// маршруты API (админка, приложение команды, ссылка внешнего водителя) только вызывают эти функции.
//
//  бронь с трансфером подтверждена ─► OFFERED (предложено всем, кто может водить)
//  OFFERED ─ никто не взял за N минут или до подачи < X часов ─► UNASSIGNED (хозяину/админу: «назначьте вручную»)
//  OFFERED / UNASSIGNED ─ первый «Беру» (атомарно) или назначение хозяином/админом ─► ACCEPTED
//  ACCEPTED ─ «Выехал» (+ETA) ─► EN_ROUTE ─ «Я на месте» ─► ARRIVED ─ «Гость в машине» ─► PICKED_UP ─ «Завершить» ─► DONE
//  (шаги можно пропускать вперёд: из ACCEPTED сразу «на месте» или «гость в машине»)
//  ACCEPTED ─ водитель отказался ─► OFFERED (снова всем; хозяину/админу — уведомление)
//  любой незавершённый ─ отмена хозяином/админом или отмена брони ─► CANCELLED
//  Переназначить можно до «Гость в машине». Оплата водителю — флаг paid после DONE, сумма уходит в финансы.
import { prisma } from '../db.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { randomToken } from '../lib/tokens.js';
import { atLocal, isoDay, parseDay } from '../lib/dates.js';
import { config as defaultConfig } from '../config.js';
import { getSettings } from './settings.js';
import { computePayout, noPayoutRule, NO_PAYOUT_RULES } from './payouts.js';

export const STATUSES = ['OFFERED', 'UNASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'DONE', 'CANCELLED'];
export const STATUS_RU = {
  OFFERED: 'Ищем водителя', UNASSIGNED: 'Никто не взял', ACCEPTED: 'Водитель назначен', EN_ROUTE: 'Водитель в пути',
  ARRIVED: 'Водитель на месте', PICKED_UP: 'Гость в машине', DONE: 'Выполнен', CANCELLED: 'Отменён',
};
export const OPEN = ['OFFERED', 'UNASSIGNED'];                         // можно взять
export const ACTIVE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP']; // у водителя в работе — видит телефон гостя
export const TERMINAL = ['DONE', 'CANCELLED'];
/** Бесплатное ожидание, мин: аэропорт 60, вокзал 30, адрес 15 (как у Welcome Pickups / GetTransfer) */
export const FREE_WAIT = { airport: 60, station: 30, address: 15 };
export const PLACE_RU = { airport: 'Аэропорт Астаны (NQZ)', station: 'ЖД вокзал' };
const TRANSFER_STATUS = { OFFERED: 'planned', UNASSIGNED: 'planned', ACCEPTED: 'driver', EN_ROUTE: 'driver', ARRIVED: 'driver', PICKED_UP: 'driver', DONE: 'done', CANCELLED: 'cancelled' };

const conflict = (msg) => new HttpError(409, msg);
const need = (job, list, msg) => { if (!list.includes(job.status)) throw conflict(msg || `Действие недоступно: заказ в статусе «${STATUS_RU[job.status]}»`); };

export const jobInclude = {
  transfer: true, apartment: true, booking: { select: { id: true, number: true, status: true, checkIn: true, checkOut: true } },
  driverUser: { select: { id: true, name: true, phone: true } }, driverContractor: true, payoutRecord: true,
};
export const GUEST_PAY_METHODS = ['cash', 'card', 'online'];
export const GUEST_PAY_RU = { cash: 'наличные', card: 'карта / перевод', online: 'онлайн' };
export const fullInclude = { ...jobInclude, events: { orderBy: { createdAt: 'asc' } } };
export const loadJob = (where, include = fullInclude) => prisma.transferJob.findFirst({ where, include });

/** Кто может водить: активные участники с флагом canDrive или ролью driver */
/** Машина водителя: мест и багажа (пусто — седан: 4 места, 3 места багажа) */
export const CAR_CLASSES = ['sedan', 'minivan', 'bus'];
export const CAR_CLASS_RU = { sedan: 'седан', minivan: 'минивэн', bus: 'микроавтобус' };
export const vehicleCapacity = (m) => ({ seats: m?.vehicleSeats ?? 4, bags: m?.vehicleBags ?? 3, cls: m?.vehicleClass || 'sedan' });
/** Помещаются ли пассажиры и багаж трансфера в машину водителя; заказ «минивэн» — только минивэну/микроавтобусу */
export function vehicleFits(m, t) {
  const c = vehicleCapacity(m);
  if ((t?.pax || 1) > c.seats || (t?.bags || 0) > c.bags) return false;
  return t?.carClass !== 'minivan' || c.cls !== 'sedan';
}
const jobWhen = (j, timeZone) => new Intl.DateTimeFormat('ru-RU', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(j.pickupAt));
export const driverWhere = (accountId) => ({ accountId, active: true, OR: [{ canDrive: true }, { role: 'driver' }] });
export const eligibleDrivers = (accountId) => prisma.membership.findMany({ where: driverWhere(accountId), include: { user: true }, orderBy: { createdAt: 'asc' } });
export async function driverMembership(accountId, userId) {
  if (!userId) return null;
  return prisma.membership.findFirst({ where: { ...driverWhere(accountId), userId } });
}
export const isJobDriver = (job, userId) => !!userId && job.driverUserId === userId;

export function freeWaitFor(t) { return t.direction === 'out' ? FREE_WAIT.address : (FREE_WAIT[t.place] || FREE_WAIT.address); }
export function aptLine(a) {
  if (!a) return null;
  const no = a.code && !/кв\.?\s*\d/i.test(a.address || '') ? `, кв. ${a.code}` : '';
  return `${a.address || a.title}${no}`;
}
/** Адрес без квартиры: «пр. Кошкарбаева, 10/1, блок G-1, кв. 12» → «пр. Кошкарбаева, 10/1, блок G-1» */
export const stripUnit = (s) => String(s || '').replace(/[,;]?\s*(кв\.?|квартира|apt\.?|apartment|flat|офис|оф\.)\s*№?\s*[\w\-/]+.*$/i, '').trim();
/** Дом без номера квартиры — это водитель видит до «Беру»: «ЖК Хайвил, пр. Кошкарбаева, 10/1, блок G-1 (Сарайшык)» */
export function buildingLine(a) {
  if (!a) return null;
  const street = stripUnit(a.address);
  const head = a.complex && !street.toLowerCase().includes(a.complex.toLowerCase()) ? `${a.complex}, ${street}` : street;
  return `${head || a.complex || 'адрес уточнить'}${a.district ? ` (${a.district})` : ''}`;
}
/** Откуда → куда: встреча — от аэропорта/вокзала к квартире, проводы — наоборот.
 *  hideUnit — до «Беру»: только дом/ЖК и район, без номера квартиры. */
export function route(job, { hideUnit = false } = {}) {
  const t = job.transfer;
  const place = PLACE_RU[t.place] || t.place;
  const home = (hideUnit ? buildingLine(job.apartment) : aptLine(job.apartment)) || (hideUnit ? stripUnit(t.address) : t.address) || 'адрес уточнить';
  const station = t.place === 'station' && t.address && !job.apartment ? t.address : place;
  return t.direction === 'out' ? { from: home, to: place } : { from: station, to: home };
}

/** Какие кнопки сейчас у водителя */
export function driverActions(job, userId, eligible) {
  if (OPEN.includes(job.status)) return eligible ? ['accept'] : [];
  if (!isJobDriver(job, userId)) return [];
  return {
    ACCEPTED: ['en-route', 'arrived', 'picked-up', 'time', 'release'], EN_ROUTE: ['arrived', 'picked-up', 'time'],
    ARRIVED: ['picked-up'], PICKED_UP: ['done'],
  }[job.status] || [];
}

function tripOut(job, { hideUnit = false } = {}) {
  const t = job.transfer;
  return {
    direction: t.direction, place: t.place, placeLabel: PLACE_RU[t.place] || t.place, date: isoDay(t.date), time: t.time, pickupAt: job.pickupAt,
    flight: t.flight, flightStatus: job.flightStatus || null, flightEta: job.flightEta || null, ...route(job, { hideUnit }), meetingPoint: job.meetingPoint, sign: t.sign || t.guestName, guestName: t.guestName,
    pax: t.pax, bags: t.bags, childSeats: t.childSeats, carClass: t.carClass, notes: job.notes, freeWaitMin: job.freeWaitMin,
  };
}
const timeline = (j) => ({ offeredAt: j.offeredAt, escalatedAt: j.escalatedAt, acceptedAt: j.acceptedAt, enRouteAt: j.enRouteAt, etaAt: j.etaAt, arrivedAt: j.arrivedAt, pickedUpAt: j.pickedUpAt, doneAt: j.doneAt, cancelledAt: j.cancelledAt });
export const eventOut = (e) => ({ id: e.id, type: e.type, actorType: e.actorType, actorName: e.actorName, note: e.note, data: e.data, createdAt: e.createdAt });

/**
 * Что видит водитель. Открытый заказ — всё для решения «беру/не беру», кроме телефона гостя.
 * Свой заказ в работе — плюс телефон. Заказ, который взял другой, — только «занят», без данных гостя.
 */
/** Квартира для водителя: до «Беру» — только дом/ЖК и район; после — полный адрес и номер квартиры */
function apartmentFor(job, unlocked) {
  const a = job.apartment;
  if (!a) return job.transfer.address ? { building: unlocked ? job.transfer.address : stripUnit(job.transfer.address), address: unlocked ? job.transfer.address : undefined } : null;
  return unlocked
    ? { building: buildingLine(a), address: aptLine(a), apartmentNumber: a.code || null }
    : { building: buildingLine(a), district: a.district || null };
}

/**
 * Что видит водитель. Открытый заказ — всё для решения «беру/не беру», кроме телефона гостя и номера квартиры
 * (только дом/ЖК и район). Свой заказ в работе — плюс телефон и номер квартиры. Заказ, который взял другой, — только «занят».
 * Денег бизнеса водитель не видит: только свою выплату. viewer — { membership, settings } для расчёта его выплаты в предложении.
 */
export function jobForDriver(job, userId, { eligible = false, viewer = null } = {}) {
  const mine = isJobDriver(job, userId);
  if (!OPEN.includes(job.status) && !mine) {
    return { id: job.id, status: 'TAKEN', statusLabel: job.status === 'CANCELLED' ? 'Отменён' : 'Взял другой водитель', date: isoDay(job.transfer.date), time: job.transfer.time, placeLabel: PLACE_RU[job.transfer.place] || job.transfer.place, direction: job.transfer.direction };
  }
  if (OPEN.includes(job.status) && !eligible) throw forbidden('Вы не в списке водителей');
  const unlocked = mine && ACTIVE.includes(job.status);   // после «Беру» и пока заказ в работе
  const unlockedDone = mine && job.status === 'DONE';
  let payoutKzt = job.payoutKzt, rule = job.payoutRule;
  if (!mine && viewer?.settings) {
    const p = computePayout({ priceKzt: job.transfer.priceKzt, settings: viewer.settings, driver: viewer.membership, manualKzt: job.payoutManual ? job.payoutKzt : null });
    payoutKzt = p.payoutKzt; rule = p.rule;
  }
  const noPayout = NO_PAYOUT_RULES.includes(rule);   // везёт владелец / человек «от бизнеса» — выплаты нет
  // оплату гостя (guestPayment*) и цену водителю не отдаём никогда
  return {
    id: job.id, status: job.status, statusLabel: STATUS_RU[job.status], mine, ...tripOut(job, { hideUnit: !(unlocked || unlockedDone) }),
    apartment: apartmentFor(job, unlocked || unlockedDone),
    guestPhone: unlocked ? job.transfer.guestPhone : undefined,   // телефон — только после «Беру» и до завершения
    payoutKzt: noPayout ? 0 : payoutKzt, noPayout, paid: mine && !noPayout ? job.paid : undefined, vehicle: mine ? job.vehicle : undefined, ...(mine ? timeline(job) : {}),
    actions: driverActions(job, userId, eligible),
  };
}
/** Для внешнего водителя по ссылке (ссылка есть только у назначенного): то же правило — квартира и телефон, пока заказ в работе */
export function jobForLink(job) {
  const unlocked = ACTIVE.includes(job.status);
  return {
    id: job.id, status: job.status, statusLabel: STATUS_RU[job.status], ...tripOut(job, { hideUnit: !unlocked }), driverName: job.driverName,
    apartment: apartmentFor(job, unlocked),
    guestPhone: unlocked ? job.transfer.guestPhone : undefined, payoutKzt: job.payoutKzt, ...timeline(job),
    actions: ({ ACCEPTED: ['en-route', 'arrived', 'picked-up', 'time'], EN_ROUTE: ['arrived', 'picked-up', 'time'], ARRIVED: ['picked-up'], PICKED_UP: ['done'] })[job.status] || [],
  };
}
export function jobForManager(job, { publicUrl = '' } = {}) {
  const t = job.transfer;
  return {
    id: job.id, transferId: t.id, status: job.status, statusLabel: STATUS_RU[job.status], ...tripOut(job),
    guestPhone: t.guestPhone, priceKzt: t.priceKzt, address: t.address,
    booking: job.booking ? { id: job.booking.id, number: job.booking.number, status: job.booking.status } : null,
    apartment: job.apartment ? { id: job.apartment.id, title: job.apartment.title, address: job.apartment.address, apartmentNumber: job.apartment.code || null } : null,
    driver: job.driverUserId ? { kind: 'user', id: job.driverUserId, name: job.driverName || job.driverUser?.name, phone: job.driverUser?.phone || null }
      : job.driverContractorId ? { kind: 'contractor', id: job.driverContractorId, name: job.driverName || job.driverContractor?.name, phone: job.driverContractor?.phone || null } : null,
    vehicle: job.vehicle, payoutKzt: job.payoutKzt, commissionKzt: job.commissionKzt ?? (job.payoutKzt != null ? (t.priceKzt || 0) - job.payoutKzt : null),
    payoutRule: job.payoutRule || null, payoutManual: !!job.payoutManual, paid: job.paid, paidAt: job.paidAt, offerRound: job.offerRound,
    noPayout: NO_PAYOUT_RULES.includes(job.payoutRule),
    guestPayment: { status: t.guestPaymentStatus || 'UNPAID', method: t.guestPaymentMethod || null, paidAt: t.guestPaidAt || null, byName: t.guestPaidByName || null },
    payoutRecord: job.payoutRecord ? { id: job.payoutRecord.id, amountKzt: job.payoutRecord.amountKzt, status: job.payoutRecord.status, paidAt: job.payoutRecord.paidAt, byName: job.payoutRecord.paidByName, driverName: job.payoutRecord.name, method: job.payoutRecord.method } : null,
    flightStatus: job.flightStatus || null, flightEta: job.flightEta || null, flightCheckedAt: job.flightCheckedAt || null,
    link: job.linkToken ? { token: job.linkToken, url: `${publicUrl}/link/${job.linkToken}` } : null,
    ...timeline(job), cancelReason: job.cancelReason, events: (job.events || []).map(eventOut), createdAt: job.createdAt,
  };
}
export function jobListItem(job) {
  const t = job.transfer;
  return {
    id: job.id, transferId: t.id, status: job.status, statusLabel: STATUS_RU[job.status], direction: t.direction, place: t.place, date: isoDay(t.date), time: t.time,
    pickupAt: job.pickupAt, flight: t.flight, guestName: t.guestName, pax: t.pax, ...route(job), driverName: job.driverName, priceKzt: t.priceKzt, payoutKzt: job.payoutKzt, commissionKzt: job.commissionKzt, paid: job.paid,
    payoutRule: job.payoutRule || null, noPayout: NO_PAYOUT_RULES.includes(job.payoutRule), payoutStatus: job.payoutRecord?.status || null, guestPaymentStatus: t.guestPaymentStatus || 'UNPAID',
    apartmentId: job.apartmentId, apartmentTitle: job.apartment?.title || null, bookingNumber: job.booking?.number || null,
  };
}

export function createTransferDispatch({ events, config = defaultConfig } = {}) {
  const cfg = { offerTimeoutMin: 30, escalateBeforeHours: 3, reminderBeforeMin: 120, ...(config.transfers || {}) };
  const emit = (name, payload) => events?.emit(name, payload);
  const log = (job, actor, type, note = null, data = null) => prisma.transferEvent.create({
    data: { accountId: job.accountId, jobId: job.id, type, actorType: actor?.type || 'system', actorId: actor?.id || null, actorName: actor?.name || null, note, data },
  });
  const syncTransfer = (job, extra = {}) => prisma.transfer.update({ where: { id: job.transferId }, data: { status: TRANSFER_STATUS[job.status], driverName: job.driverName || null, ...extra } });
  const reload = (id) => loadJob({ id });
  async function tz(accountId) { return (await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } }))?.timezone || 'Asia/Almaty'; }
  /** Выплата водителю и комиссия по правилам (если выплату не задали вручную). driver — Membership/Contractor или null. */
  async function payoutFields(job, priceKzt, driver = null) {
    const settings = await getSettings(job?.accountId);
    const nr = noPayoutRule(driver, settings);   // везёт владелец / «от бизнеса» — выплаты нет, даже если раньше задали вручную
    if (nr) return { payoutKzt: 0, commissionKzt: priceKzt, payoutRule: nr, payoutManual: false };
    if (job?.payoutManual) return { commissionKzt: priceKzt - (job.payoutKzt || 0) };
    const p = computePayout({ priceKzt, settings, driver });
    return { payoutKzt: p.payoutKzt, commissionKzt: p.commissionKzt, payoutRule: p.rule };
  }
  /** Водитель заказа как «участник расчёта»: Membership (роль, paidAsDriver, ставки) или Contractor */
  async function jobDriver(job) {
    if (job.driverUserId) return prisma.membership.findFirst({ where: { accountId: job.accountId, userId: job.driverUserId } });
    if (job.driverContractorId) return prisma.contractor.findUnique({ where: { id: job.driverContractorId } });
    return null;
  }
  /**
   * Долг водителю (DriverPayout) — только у выполненного заказа и только если выплата > 0.
   * Выплаченную запись не трогаем; выплата стала 0 (везёт владелец) — неоплаченная запись удаляется.
   */
  async function syncPayoutRecord(jobId) {
    const job = await prisma.transferJob.findUnique({ where: { id: jobId }, include: { payoutRecord: true } });
    if (!job) return null;
    const rec = job.payoutRecord;
    if (rec?.status === 'PAID') return rec;
    const owed = job.status === 'DONE' && (job.payoutKzt || 0) > 0;
    if (!owed) { if (rec) await prisma.payout.delete({ where: { id: rec.id } }); return null; }
    const data = { amountKzt: job.payoutKzt, userId: job.driverUserId, contractorId: job.driverContractorId, name: job.driverName, title: `Трансфер ${jobWhen(job, await tz(job.accountId))}` };
    if (rec) return prisma.payout.update({ where: { id: rec.id }, data });
    const p = await prisma.payout.create({ data: { accountId: job.accountId, kind: 'transfer', jobId: job.id, status: 'PENDING', ...data } });
    emit('payout.created', { accountId: job.accountId, payoutId: p.id });
    return p;
  }
  let flights = null;
  const setFlightTracker = (t) => { flights = t; };

  /** Создать заказ для трансфера (если ещё нет) и предложить всем водителям */
  async function createForTransfer({ accountId, transferId, actor = null }) {
    const existing = await prisma.transferJob.findUnique({ where: { transferId } });
    if (existing) return existing;
    const t = await prisma.transfer.findFirst({ where: { id: transferId, accountId } });
    if (!t) throw notFound('Трансфер не найден');
    if (['cancelled', 'done'].includes(t.status)) throw conflict('Трансфер уже закрыт');
    let job;
    try {
      job = await prisma.transferJob.create({
        data: {
          accountId, transferId: t.id, bookingId: t.bookingId, apartmentId: t.apartmentId, status: 'OFFERED', offeredAt: new Date(),
          pickupAt: atLocal(t.date, t.time, await tz(accountId)), freeWaitMin: freeWaitFor(t), ...(await payoutFields({ accountId }, t.priceKzt)),
          notes: t.childSeats ? `Детских кресел: ${t.childSeats}` : null,
        },
      });
    } catch (e) { if (e.code === 'P2002') return prisma.transferJob.findUnique({ where: { transferId } }); throw e; }
    await syncTransfer(job);
    await log(job, actor, 'offered', null, { round: 1 });
    emit('transfer.offered', { accountId, jobId: job.id, round: 1 });
    return job;
  }
  /** Подтвердили бронь — заказы на все её трансферы */
  async function createForBooking({ accountId, bookingId, actor = null }) {
    const list = await prisma.transfer.findMany({ where: { accountId, bookingId, status: { notIn: ['cancelled', 'done'] }, job: null } });
    const out = [];
    for (const t of list) out.push(await createForTransfer({ accountId, transferId: t.id, actor }));
    return out;
  }

  /** «Беру»: первый успевший получает заказ. Одна условная запись в БД — второй получит 409. */
  async function accept({ accountId, jobId, user, vehicle }) {
    const m = await driverMembership(accountId, user.id);
    if (!m) throw forbidden('Вы не в списке водителей');
    const now = new Date();
    const cur = await prisma.transferJob.findFirst({ where: { id: jobId, accountId }, include: { transfer: { select: { priceKzt: true, pax: true, bags: true, carClass: true } } } });
    if (!cur) throw notFound('Заказ не найден');
    if (OPEN.includes(cur.status) && !vehicleFits(m, cur.transfer)) throw forbidden(`Машина не подходит: нужно мест ${cur.transfer.pax || 1}, багажа ${cur.transfer.bags || 0}`);
    const pay = await payoutFields(cur, cur.transfer.priceKzt, m);
    const r = await prisma.transferJob.updateMany({
      where: { id: jobId, accountId, status: { in: OPEN }, driverUserId: null, driverContractorId: null },
      data: { status: 'ACCEPTED', driverUserId: user.id, driverName: user.name, vehicle: vehicle || m.vehicle || null, acceptedAt: now, ...pay },
    });
    const job = await reload(jobId);
    if (!job || job.accountId !== accountId) throw notFound('Заказ не найден');
    if (!r.count) {
      if (job.driverUserId === user.id && ACTIVE.includes(job.status)) return job;   // повторное нажатие
      throw conflict(job.status === 'CANCELLED' ? 'Заказ отменён' : 'Заказ уже взял другой водитель');
    }
    await syncTransfer(job);
    await log(job, { type: 'driver', id: user.id, name: user.name }, 'accepted');
    emit('transfer.accepted', { accountId, jobId });
    return reload(jobId);
  }

  /** Водитель отказался (только до выезда) — заказ снова у всех */
  async function release({ job, user, reason }) {
    if (!isJobDriver(job, user.id)) throw forbidden('Это не ваш заказ');
    need(job, ['ACCEPTED'], 'Отказаться можно только до выезда — дальше звоните хозяину/админу');
    const u = await prisma.transferJob.update({ where: { id: job.id }, data: { status: 'OFFERED', driverUserId: null, driverName: null, vehicle: null, acceptedAt: null, offerRound: { increment: 1 }, offeredAt: new Date(), escalatedAt: null, ...(await payoutFields(job, job.transfer.priceKzt)) } });
    await syncTransfer(u);
    await log(u, { type: 'driver', id: user.id, name: user.name }, 'released', reason || null);
    emit('transfer.released', { accountId: job.accountId, jobId: job.id, byName: user.name, reason: reason || null });
    emit('transfer.offered', { accountId: job.accountId, jobId: job.id, round: u.offerRound, exceptUserId: user.id });
    return reload(job.id);
  }

  /** Шаги водителя: выехал → на месте → гость в машине → завершить */
  const STEPS = {
    'en-route': { from: ['ACCEPTED'], to: 'EN_ROUTE', at: 'enRouteAt', ev: 'en_route' },
    arrived: { from: ['ACCEPTED', 'EN_ROUTE'], to: 'ARRIVED', at: 'arrivedAt', ev: 'arrived' },
    'picked-up': { from: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'], to: 'PICKED_UP', at: 'pickedUpAt', ev: 'picked_up' },
    done: { from: ['PICKED_UP'], to: 'DONE', at: 'doneAt', ev: 'done' },
  };
  async function step({ job, actor, action, etaMinutes, note }) {
    const s = STEPS[action]; if (!s) throw badRequest('Неизвестный шаг');
    need(job, s.from);
    const now = new Date();
    const data = { status: s.to, [s.at]: now };
    if (action === 'en-route' && etaMinutes) data.etaAt = new Date(now.getTime() + etaMinutes * 60000);
    const r = await prisma.transferJob.updateMany({ where: { id: job.id, status: job.status }, data });   // защита от двойного нажатия
    if (!r.count) throw conflict('Статус уже изменился — обновите карточку');
    const u = await reload(job.id);
    await syncTransfer(u);
    await log(u, actor, s.ev, note || null, etaMinutes ? { etaMinutes } : null);
    if (action === 'en-route') emit('transfer.en_route', { accountId: job.accountId, jobId: job.id });
    if (action === 'arrived') emit('transfer.driver_arrived', { accountId: job.accountId, jobId: job.id });
    if (action === 'done') { await syncPayoutRecord(job.id); emit('transfer.done', { accountId: job.accountId, jobId: job.id }); }
    return reload(job.id);
  }

  /** Новое время подачи (рейс задержался): водитель или хозяин/админ */
  async function reschedule({ job, actor, date, time, note, reason = null }) {
    if (TERMINAL.includes(job.status) || job.status === 'PICKED_UP') throw conflict('Время уже не изменить');
    const d = date ? parseDay(date) : job.transfer.date;
    if (!d) throw badRequest('Дата в формате ГГГГ-ММ-ДД');
    const before = `${isoDay(job.transfer.date)} ${job.transfer.time}`;
    await prisma.transfer.update({ where: { id: job.transferId }, data: { date: d, time: time || job.transfer.time } });
    const pickupAt = atLocal(d, time || job.transfer.time, await tz(job.accountId));
    await prisma.transferJob.update({ where: { id: job.id }, data: { pickupAt } });
    const after = `${isoDay(d)} ${time || job.transfer.time}`;
    await log(job, actor, 'time_changed', note || null, { before, after });
    const byDriver = actor?.type === 'driver' || actor?.type === 'link';
    emit('transfer.updated', { accountId: job.accountId, jobId: job.id, before, after, byName: actor?.name, reason, notifyManagers: byDriver || actor?.type === 'flight', notifyDriver: !byDriver });
    return reload(job.id);
  }

  /** Хозяин/админ правит детали поездки и выплату водителю */
  async function update({ job, actor, data }) {
    const tData = {}, jData = {};
    for (const k of ['flight', 'pax', 'bags', 'childSeats', 'sign', 'guestPhone', 'address', 'place']) if (data[k] !== undefined) tData[k] = data[k];
    for (const k of ['meetingPoint', 'notes']) if (data[k] !== undefined) jData[k] = data[k];
    const tripChange = Object.keys(tData).length > 0;
    if (TERMINAL.includes(job.status) && (tripChange || data.date || data.time)) throw conflict('Заказ закрыт — можно менять только цену и выплату');
    if (job.status === 'CANCELLED' && (data.priceKzt !== undefined || data.payoutKzt !== undefined || data.payoutAuto)) throw conflict('Заказ отменён');
    if (job.paid && (data.payoutKzt !== undefined || data.payoutAuto)) throw conflict('Выплата уже отмечена как оплаченная — сначала снимите отметку');
    const driver = await jobDriver(job);
    const noPay = noPayoutRule(driver, await getSettings(job.accountId));
    if (noPay && data.payoutKzt != null) throw conflict(noPay === 'owner' ? 'Везёт сам владелец — выплата не требуется, вся сумма остаётся бизнесу' : 'Этот водитель «от бизнеса» — выплата не требуется (см. «Команда»)');
    // деньги: цена для гостя, выплата водителю вручную или «по правилам»
    const price = data.priceKzt !== undefined ? data.priceKzt : job.transfer.priceKzt;
    if (data.priceKzt !== undefined && data.priceKzt !== job.transfer.priceKzt) tData.priceKzt = data.priceKzt;
    if (data.payoutKzt !== undefined && data.payoutKzt !== null) Object.assign(jData, { payoutKzt: data.payoutKzt, payoutManual: true, payoutRule: 'manual', commissionKzt: price - data.payoutKzt });
    else if (data.payoutAuto || data.payoutKzt === null || tData.priceKzt !== undefined) {
      // уже выплачено — сумму водителю не трогаем, меняется только комиссия; ручная выплата держится до «По правилам»
      const manual = job.paid || (!(data.payoutAuto || data.payoutKzt === null) && job.payoutManual);
      Object.assign(jData, manual ? { commissionKzt: price - (job.payoutKzt || 0) } : { ...(await payoutFields({ accountId: job.accountId }, price, driver)), payoutManual: false });
    }
    if (tData.place) jData.freeWaitMin = freeWaitFor({ ...job.transfer, ...tData });
    if (Object.keys(tData).length) await prisma.transfer.update({ where: { id: job.transferId }, data: tData });
    if (Object.keys(jData).length) await prisma.transferJob.update({ where: { id: job.id }, data: jData });
    if (Object.keys(tData).length || Object.keys(jData).length) await log(job, actor, 'updated', null, { ...tData, ...jData });
    if (job.status === 'DONE' && Object.keys(jData).length) await syncPayoutRecord(job.id);
    let u = await reload(job.id);
    if (data.date || data.time) u = await reschedule({ job: u, actor, date: data.date, time: data.time });
    else if (tripChange && (job.driverUserId || job.driverContractorId)) emit('transfer.updated', { accountId: job.accountId, jobId: job.id, fields: Object.keys(tData) });
    return u;
  }

  /** Назначить / переназначить водителя (хозяин/админ) */
  async function assign({ job, actor, driverUserId, driverContractorId }) {
    need(job, ['OFFERED', 'UNASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'], 'Переназначить можно до посадки гостя');
    let data;
    if (driverUserId) {
      const m = await prisma.membership.findFirst({ where: { ...driverWhere(job.accountId), userId: driverUserId }, include: { user: true } });
      if (!m) throw badRequest('Этот человек не в списке водителей — включите «Водит» в разделе «Команда»');
      data = { driverUserId, driverContractorId: null, driverName: m.user.name, vehicle: m.vehicle || null, linkToken: null, ...(await payoutFields(job, job.transfer.priceKzt, m)) };
    } else if (driverContractorId) {
      if (!cfg.externalDrivers) throw badRequest('Трансферы возят только свои водители');
      const c = await prisma.contractor.findFirst({ where: { id: driverContractorId, accountId: job.accountId, canDrive: true } });
      if (!c) throw badRequest('Внешний водитель не найден (нужен подрядчик с отметкой «водитель»)');
      data = { driverUserId: null, driverContractorId: c.id, driverName: c.name, vehicle: c.note || null, linkToken: job.driverContractorId === c.id && job.linkToken ? job.linkToken : randomToken(18), ...(await payoutFields(job, job.transfer.priceKzt, c)) };
    } else throw badRequest('Выберите водителя');
    if ((data.driverUserId && data.driverUserId === job.driverUserId) || (data.driverContractorId && data.driverContractorId === job.driverContractorId)) return job;
    const prev = { userId: job.driverUserId, contractorId: job.driverContractorId, name: job.driverName };
    const u = await prisma.transferJob.update({ where: { id: job.id }, data: { ...data, status: 'ACCEPTED', acceptedAt: new Date(), enRouteAt: null, etaAt: null, arrivedAt: null } });
    await syncTransfer(u);
    await log(u, actor, prev.name ? 'reassigned' : 'assigned', null, { driver: data.driverName, previous: prev.name || null });
    emit('transfer.driver_assigned', { accountId: job.accountId, jobId: job.id, previousUserId: prev.userId, previousContractorId: prev.contractorId });
    return reload(job.id);
  }

  /** Снова предложить всем (снять водителя) */
  async function offerAgain({ job, actor }) {
    need(job, ['OFFERED', 'UNASSIGNED', 'ACCEPTED'], 'Снова предложить можно только до выезда водителя');
    const prev = { userId: job.driverUserId, contractorId: job.driverContractorId };
    const u = await prisma.transferJob.update({ where: { id: job.id }, data: { status: 'OFFERED', driverUserId: null, driverContractorId: null, driverName: null, vehicle: null, linkToken: null, acceptedAt: null, offerRound: { increment: 1 }, offeredAt: new Date(), escalatedAt: null, ...(await payoutFields(job, job.transfer.priceKzt)) } });
    await syncTransfer(u);
    await log(u, actor, 'offered', null, { round: u.offerRound });
    if (prev.userId || prev.contractorId) emit('transfer.driver_removed', { accountId: job.accountId, jobId: job.id, userId: prev.userId, contractorId: prev.contractorId });
    emit('transfer.offered', { accountId: job.accountId, jobId: job.id, round: u.offerRound });
    return reload(job.id);
  }

  async function cancel({ job, actor, reason }) {
    if (TERMINAL.includes(job.status)) throw conflict('Заказ уже закрыт');
    const u = await prisma.transferJob.update({ where: { id: job.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason || null } });
    await syncTransfer(u);
    await log(u, actor, 'cancelled', reason || null);
    if (job.driverUserId || job.driverContractorId) emit('transfer.cancelled', { accountId: job.accountId, jobId: job.id, reason: reason || null });
    return reload(job.id);
  }
  /** Бронь отменена — отменяем её заказы и трансферы */
  async function cancelForBooking({ accountId, bookingId, actor = null, reason = 'Бронь отменена' }) {
    const jobs = await prisma.transferJob.findMany({ where: { accountId, bookingId, status: { notIn: TERMINAL } }, include: jobInclude });
    for (const j of jobs) await cancel({ job: j, actor, reason });
    await prisma.transfer.updateMany({ where: { accountId, bookingId, status: { notIn: ['done', 'cancelled'] }, job: null }, data: { status: 'cancelled' } });
    return jobs.length;
  }
  /** Даты брони изменились — сдвигаем трансферы (встреча = день заезда, проводы = день выезда), время сохраняем */
  async function syncBookingDates({ accountId, booking, actor = null }) {
    const list = await prisma.transfer.findMany({ where: { accountId, bookingId: booking.id, status: { notIn: ['done', 'cancelled'] } }, include: { job: { include: jobInclude } } });
    let n = 0;
    for (const t of list) {
      const day = t.direction === 'out' ? booking.checkOut : booking.checkIn;
      if (+t.date === +new Date(day)) continue;
      if (t.job && !TERMINAL.includes(t.job.status)) await reschedule({ job: t.job, actor, date: isoDay(day), time: t.time, note: 'Изменились даты брони' });
      else await prisma.transfer.update({ where: { id: t.id }, data: { date: day } });
      n++;
    }
    return n;
  }
  /** Выплата водителю: долг (DriverPayout) PENDING → PAID и обратно. Нет долга (везёт владелец, выплата 0) — 409. */
  async function markPaid({ job, actor, paid = true, method = 'cash' }) {
    need(job, ['DONE'], 'Отметить выплату водителю можно после выполнения');
    const rec = job.payoutRecord || await syncPayoutRecord(job.id);
    if (!rec) throw conflict(NO_PAYOUT_RULES.includes(job.payoutRule) ? 'Выплата не требуется — вся сумма осталась бизнесу' : 'Выплаты водителю нет (сумма 0)');
    const now = paid ? new Date() : null;
    await prisma.payout.update({ where: { id: rec.id }, data: { status: paid ? 'PAID' : 'PENDING', method: paid ? method : null, paidAt: now, paidById: paid ? actor?.id || null : null, paidByName: paid ? actor?.name || null : null } });
    await prisma.transferJob.update({ where: { id: job.id }, data: { paid, paidAt: now } });
    await log(job, actor, paid ? 'paid' : 'unpaid', null, { payoutKzt: rec.amountKzt });
    return reload(job.id);
  }
  /** Оплата гостя бизнесу за трансфер: UNPAID | PAID (+ способ). Только владелец/админ; водителю не показывается. */
  async function guestPayment({ job, actor, status, method }) {
    if (status === 'PAID' && job.status === 'CANCELLED') throw conflict('Заказ отменён');
    if (status === 'PAID' && !GUEST_PAY_METHODS.includes(method)) throw badRequest('Укажите, как заплатил гость: наличные, карта или онлайн');
    const paid = status === 'PAID';
    await prisma.transfer.update({ where: { id: job.transferId }, data: {
      guestPaymentStatus: paid ? 'PAID' : 'UNPAID', guestPaymentMethod: paid ? method : null, paid,
      guestPaidAt: paid ? new Date() : null, guestPaidById: paid ? actor?.id || null : null, guestPaidByName: paid ? actor?.name || null : null,
    } });
    await log(job, actor, paid ? 'guest_paid' : 'guest_unpaid', null, paid ? { method, amountKzt: job.transfer.priceKzt } : null);
    return reload(job.id);
  }
  async function newLink({ job, actor }) {
    if (!job.driverContractorId) throw conflict('Ссылка нужна только внешнему водителю');
    await prisma.transferJob.update({ where: { id: job.id }, data: { linkToken: randomToken(18) } });
    await log(job, actor, 'link');
    return reload(job.id);
  }

  /**
   * Диспетчер по расписанию (каждые 5 минут):
   *  1) OFFERED дольше N минут или до подачи < X часов → UNASSIGNED + «назначьте вручную» хозяину/админу;
   *     за час до подачи без водителя — повторное срочное напоминание;
   *  2) напоминание водителю за reminderBeforeMin до подачи.
   */
  async function runDispatch({ now = new Date() } = {}) {
    const res = { escalated: 0, urgent: 0, reminders: 0 };
    const offerCut = new Date(now.getTime() - cfg.offerTimeoutMin * 60000);
    const pickupCut = new Date(now.getTime() + cfg.escalateBeforeHours * 3600000);
    const stale = await prisma.transferJob.findMany({ where: { status: 'OFFERED', pickupAt: { gt: new Date(now.getTime() - 3600000) }, OR: [{ offeredAt: { lte: offerCut } }, { pickupAt: { lte: pickupCut } }] } });
    for (const j of stale) {
      const r = await prisma.transferJob.updateMany({ where: { id: j.id, status: 'OFFERED' }, data: { status: 'UNASSIGNED', escalatedAt: now } });
      if (!r.count) continue;
      const reason = j.pickupAt <= pickupCut ? `до подачи меньше ${cfg.escalateBeforeHours} ч` : `никто не взял за ${cfg.offerTimeoutMin} мин`;
      await log(j, null, 'escalated', reason);
      emit('transfer.unassigned', { accountId: j.accountId, jobId: j.id, reason, dedupe: `${j.id}:${j.offerRound}` });
      res.escalated++;
    }
    const urgent = await prisma.transferJob.findMany({ where: { status: 'UNASSIGNED', pickupAt: { gt: now, lte: new Date(now.getTime() + 3600000) } }, select: { id: true, accountId: true, offerRound: true } });
    for (const j of urgent) { emit('transfer.unassigned', { accountId: j.accountId, jobId: j.id, urgent: true, reason: 'до подачи меньше часа', dedupe: `${j.id}:${j.offerRound}:urgent` }); res.urgent++; }
    const soon = await prisma.transferJob.findMany({ where: { status: { in: ['ACCEPTED', 'EN_ROUTE'] }, pickupAt: { gt: now, lte: new Date(now.getTime() + cfg.reminderBeforeMin * 60000) } }, select: { id: true, accountId: true, driverUserId: true, driverContractorId: true } });
    for (const j of soon) { emit('transfer.reminder', { accountId: j.accountId, jobId: j.id, dedupe: `${j.id}:${j.driverUserId || j.driverContractorId}` }); res.reminders++; }
    if (flights) res.flights = await checkFlights({ now });
    return res;
  }

  /**
   * Слежение за рейсами (только если подключён адаптер, например AeroDataBox, и владелец не выключил в настройках).
   * Встречи в аэропорту на ближайшие 12 часов, проверка не чаще раза в 20 минут. Если ожидаемое время прилёта
   * отличается от подачи на 15+ минут — сдвигаем подачу, пишем в журнал, водителю и менеджерам — уведомление.
   */
  async function checkFlights({ now = new Date() } = {}) {
    const out = { checked: 0, moved: 0 };
    const list = await prisma.transferJob.findMany({
      where: {
        status: { in: ['OFFERED', 'UNASSIGNED', 'ACCEPTED', 'EN_ROUTE'] }, pickupAt: { gt: new Date(now.getTime() - 3600000), lt: new Date(now.getTime() + 12 * 3600000) },
        transfer: { direction: 'in', place: 'airport', flight: { not: null } },
        OR: [{ flightCheckedAt: null }, { flightCheckedAt: { lt: new Date(now.getTime() - 20 * 60000) } }],
      }, include: jobInclude, take: 50,
    });
    for (const job of list) {
      if (!(await getSettings(job.accountId)).flightTracking) continue;
      let info = null;
      try { info = await flights.arrival({ flight: job.transfer.flight, date: isoDay(job.transfer.date) }); }
      catch (e) { await prisma.transferJob.update({ where: { id: job.id }, data: { flightCheckedAt: now } }); continue; }
      out.checked++;
      await prisma.transferJob.update({ where: { id: job.id }, data: { flightCheckedAt: now, flightStatus: info?.status || 'нет данных', flightEta: info?.expectedAt || null } });
      if (!info?.expectedAt || info.cancelled) continue;
      const diffMin = Math.round((info.expectedAt - job.pickupAt) / 60000);
      if (Math.abs(diffMin) < 15) continue;
      const zone = await tz(job.accountId);
      const day = info.expectedAt.toLocaleDateString('en-CA', { timeZone: zone });
      const time = info.expectedAt.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      await reschedule({ job, actor: { type: 'flight', name: 'Слежение за рейсом' }, date: day, time, note: `рейс ${job.transfer.flight}: ${info.status}`, reason: `Рейс ${job.transfer.flight} ${diffMin > 0 ? 'задерживается' : 'прилетает раньше'} — новое время подачи ${time}` });
      out.moved++;
    }
    return out;
  }

  return { cfg, setFlightTracker, checkFlights, payoutFields, createForTransfer, createForBooking, accept, release, step, reschedule, update, assign, offerAgain, cancel, cancelForBooking, syncBookingDates, markPaid, guestPayment, syncPayoutRecord, newLink, runDispatch, config: cfg };
}
