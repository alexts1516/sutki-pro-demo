// API для сайта гостей (без входа). Аккаунт определяется по slug в адресе:
//   GET  /api/public/:slug/site                         — бренд, тексты, валюты, способы оплаты
//   GET  /api/public/:slug/apartments?checkIn&checkOut&guests&lang — квартиры с фото и подписями
//   GET  /api/public/:slug/apartments/:id               — квартира + занятые даты на 6 месяцев
//   GET  /api/public/:slug/apartments/:id/availability?from&to — занятые интервалы
//   POST /api/public/:slug/bookings                     — заявка на бронь
//   GET  /api/public/:slug/bookings/:token              — статус брони для гостя
//   POST /api/public/:slug/bookings/:token/pay          — начать онлайн-оплату (если включена)
//   POST /api/public/:slug/transfers                    — заказ трансфера (к брони или отдельно)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound, badRequest, HttpError, parse } from '../lib/errors.js';
import { apartmentPublic, bookingOut } from '../lib/serialize.js';
import { parseDay, isoDay, addDays, todayIn, nights } from '../lib/dates.js';
import { convertKzt } from '../lib/money.js';
import { busyRanges, createBookingRequest, isAvailable, quote, withApartmentTx, extendHold, PUBLIC_HOLD_MIN } from '../services/bookings.js';
import { transferLegPrice } from '../services/transfers.js';
import { loadBrand, loadTexts, loadCurrency } from '../site/config.js';
import { deepLink } from '../telegram/linking.js';
import { applyPaymentResult } from '../payments/index.js';

const CARD_ONLY = 'Бронирование на сайте — только с оплатой картой; для особых условий напишите нам';
const HOLD_EXPIRED = 'Время на оплату истекло — даты освобождены. Забронируйте заново';
const phoneRe = /^[+\d][\d\s()-]{5,20}$/;
const BookingSchema = z.object({
  apartmentId: z.string(), checkIn: z.string(), checkOut: z.string(), guests: z.number().int().min(1).max(30),
  name: z.string().trim().min(2).max(80), phone: z.string().trim().regex(phoneRe, 'Телефон в формате +7 700 000 00 00'), email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  comment: z.string().max(1000).optional(), pets: z.boolean().optional(), currency: z.enum(['KZT', 'RUB', 'USD', 'EUR']).default('KZT'),
  paymentMethod: z.string().max(40).optional(), lang: z.enum(['ru', 'en']).default('ru'),   // проход 4: на сайте — только 'card' (проверка ниже)
  earlyCheckIn: z.string().regex(/^\d{2}:\d{2}$/, 'Время в формате ЧЧ:ММ').optional(),   // «можно заехать в 10 утра?» — согласует админ
});
const TransferSchema = z.object({
  bookingToken: z.string().optional(), direction: z.enum(['in', 'out']), place: z.enum(['airport', 'station']).default('airport'),
  date: z.string(), time: z.string().regex(/^\d{2}:\d{2}$/), flight: z.string().max(40).optional(), pax: z.number().int().min(1).max(7).default(1),
  bags: z.number().int().min(0).max(10).default(1), childSeats: z.number().int().min(0).max(3).default(0), carClass: z.enum(['standard', 'minivan']).default('standard'),
  sign: z.string().max(60).optional(), address: z.string().max(200).optional(),
  name: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().regex(phoneRe).optional(), lang: z.enum(['ru', 'en']).default('ru'),
});

export default function publicRouter({ events, payments, config, dispatch }) {
  const r = Router({ mergeParams: true });

  // аккаунт по slug (кешировать не будем — запрос дешёвый)
  r.use(async (req, _res, next) => {
    const acc = await prisma.account.findUnique({ where: { slug: req.params.slug } });
    if (!acc || acc.status === 'cancelled') throw notFound('Сайт не найден');
    if (acc.status === 'suspended') throw new HttpError(403, 'Сайт временно недоступен');
    req.account = acc; req.accountId = acc.id; next();
  });

  r.get('/site', async (req, res) => {
    const [brand, { texts }, currency] = await Promise.all([loadBrand(prisma, req.accountId), loadTexts(prisma, req.accountId), loadCurrency(prisma, req.accountId)]);
    res.json({
      account: { name: req.account.name, slug: req.account.slug }, brand, texts,
      currency: { base: 'KZT', shown: currency.shown, rates: currency.rates, roundStep: currency.roundStep },
      payments: { online: !!payments, provider: payments?.name || null, offline: [], bookingMethod: 'card' },   // бронь на сайте — только с оплатой картой (особые условия — личная ссылка)
      telegram: { bot: config.telegram.username || null },
    });
  });

  r.get('/apartments', async (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'ru';
    const ci = parseDay(req.query.checkIn), co = parseDay(req.query.checkOut);
    const guests = Number(req.query.guests) || 0;
    const list = await prisma.apartment.findMany({ where: { accountId: req.accountId, active: true, ...(guests ? { maxGuests: { gte: guests } } : {}) }, include: { photos: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const out = [];
    for (const a of list) {
      const item = apartmentPublic(a, lang);
      if (ci && co && co > ci) { item.available = await isAvailable(req.accountId, a.id, ci, co); item.quote = quote(a, ci, co); }
      out.push(item);
    }
    res.json(out);
  });

  const findApt = async (req) => {
    const a = await prisma.apartment.findFirst({ where: { id: req.params.id, accountId: req.accountId, active: true }, include: { photos: true } });
    if (!a) throw notFound('Квартира не найдена'); return a;
  };
  const ranges = async (req, a, from, to) => (await busyRanges(req.accountId, a.id, from, to)).map(b => ({ from: isoDay(b.from), to: isoDay(b.to) }));

  r.get('/apartments/:id', async (req, res) => {
    const a = await findApt(req); const today = todayIn(req.account.timezone);
    res.json({ ...apartmentPublic(a, req.query.lang === 'en' ? 'en' : 'ru'), busy: await ranges(req, a, today, addDays(today, 183)) });
  });
  r.get('/apartments/:id/availability', async (req, res) => {
    const a = await findApt(req); const today = todayIn(req.account.timezone);
    const from = parseDay(req.query.from) || today, to = parseDay(req.query.to) || addDays(from, 92);
    if (to <= from || nights(from, to) > 400) throw badRequest('Неверный период');
    res.json({ apartmentId: a.id, from: isoDay(from), to: isoDay(to), busy: await ranges(req, a, from, to) });
  });

  r.post('/bookings', async (req, res) => {
    const d = parse(BookingSchema, req.body);
    // проход 4, шаг 4: обычный гость бронирует на сайте только с оплатой картой; способ оплаты ставит сервер.
    // Любое другое значение — 400 (а не молчаливая замена: гость должен понять, что наличных на сайте нет).
    if (d.paymentMethod !== undefined && d.paymentMethod !== 'card') throw badRequest(CARD_ONLY);
    const ci = parseDay(d.checkIn), co = parseDay(d.checkOut);
    const today = todayIn(req.account.timezone);
    if (!ci || !co || co <= ci) throw badRequest('Проверьте даты заезда и выезда');
    if (ci < today) throw badRequest('Дата заезда уже прошла');
    if (nights(ci, co) > 90) throw badRequest('Максимум 90 ночей');
    const apt = await prisma.apartment.findFirst({ where: { id: d.apartmentId, accountId: req.accountId, active: true } });
    if (!apt) throw notFound('Квартира не найдена');
    if (d.guests > apt.maxGuests) throw badRequest(`В этой квартире максимум ${apt.maxGuests} гостей`);
    if (d.pets && !apt.petsAllowed) throw badRequest('В этой квартире нельзя с животными');
    const cur = await loadCurrency(prisma, req.accountId);
    const q = quote(apt, ci, co, d.pets);
    const amountShown = convertKzt(q.totalKzt, d.currency, cur.rates, cur.roundStep);
    const guest = await prisma.guest.create({ data: { accountId: req.accountId, name: d.name, phone: d.phone, email: d.email, locale: d.lang } });
    const booking = await createBookingRequest({
      accountId: req.accountId, apartment: apt, checkIn: ci, checkOut: co, guestsCount: d.guests, guest, pets: d.pets,
      note: d.comment, paymentMethod: 'card', currencyShown: d.currency, amountShown,
      holdUntil: new Date(Date.now() + PUBLIC_HOLD_MIN * 60000),   // неоплаченная заявка держит даты только 30 мин
    });
    if (d.earlyCheckIn && d.earlyCheckIn < booking.checkInTime) await prisma.booking.update({ where: { id: booking.id }, data: { earlyCheckIn: d.earlyCheckIn, earlyCheckInStatus: 'requested' } });
    events.emit('booking.requested', { accountId: req.accountId, bookingId: booking.id });
    res.status(201).json({
      number: booking.number, token: booking.token, status: booking.status, checkIn: isoDay(ci), checkOut: isoDay(co),
      nights: q.nights, totalKzt: q.totalKzt, currency: d.currency, amountShown,
      telegramLink: deepLink(config.telegram.username, `b_${booking.token}`),
      payOnline: !!payments, holdUntil: booking.holdUntil,
    });
  });

  const byToken = async (req) => {
    const b = await prisma.booking.findFirst({ where: { token: req.params.token, accountId: req.accountId }, include: { apartment: true, guest: true, transfers: true } });
    if (!b) throw notFound('Бронь не найдена'); return b;
  };
  r.get('/bookings/:token', async (req, res) => {
    const b = await byToken(req); const o = bookingOut(b);
    delete o.note; delete o.cleanerName; delete o.guest;
    res.json({ ...o, apartment: { title: b.apartment.title, address: b.status === 'confirmed' ? b.apartment.address : undefined }, telegramLinked: !!b.guest?.telegramChatId, telegramLink: deepLink(config.telegram.username, `b_${b.token}`) });
  });
  r.post('/bookings/:token/pay', async (req, res) => {
    if (!payments) throw new HttpError(409, 'Онлайн-оплата пока не подключена');
    const b0 = await byToken(req);
    if (b0.paymentStatus === 'paid') throw new HttpError(409, 'Бронь уже оплачена');
    // проход 4, шаг 4: в транзакции квартиры — истёкшее удержание снимается, живое продлевается до «сейчас + 20 мин»
    // (более длинное не укорачивается); истёкшую или отменённую заявку оплата не оживляет — 409.
    // Отказ возвращается из транзакции, а не бросается: снятие истёкшего удержания должно закоммититься.
    const { b, payment, refuse } = await withApartmentTx(b0.apartmentId, async (tx) => {
      const cur = await tx.booking.findUnique({ where: { id: b0.id } });
      if (cur.paymentStatus === 'paid') return { refuse: 'Бронь уже оплачена' };
      if (!['request', 'confirmed'].includes(cur.status)) return { refuse: cur.holdUntil && cur.holdUntil <= new Date() ? HOLD_EXPIRED : 'Бронь отменена — оплатить нельзя' };
      const holdUntil = extendHold(cur);
      if (holdUntil) await tx.booking.update({ where: { id: cur.id }, data: { holdUntil } });
      const payment = await tx.payment.create({ data: { accountId: req.accountId, bookingId: cur.id, provider: payments.name, amountKzt: cur.totalKzt, currency: 'KZT', amount: cur.totalKzt, status: 'created' } });   // списываем в тенге; валюта гостя — только для показа
      return { b: { ...b0, ...cur, ...(holdUntil ? { holdUntil } : {}) }, payment };
    });
    if (refuse) throw new HttpError(409, refuse);
    const lang = b.guest?.locale || 'ru';
    const description = lang === 'en' ? `Booking #${b.number}, ${b.apartment.titleEn || b.apartment.title}` : `Бронь №${b.number}, ${b.apartment.title}`;
    const intent = await payments.createPayment({ payment, booking: b, guest: b.guest, description, lang, returnUrl: `${config.publicUrl}/api/public/${req.account.slug}/bookings/${b.token}` });
    if (intent.type === 'instant') {   // тестовая оплата (демо): сразу успешна → бронь подтверждается
      await applyPaymentResult({ prisma, events, dispatch, result: { paymentId: payment.id, status: 'succeeded' } });
      const nb = await prisma.booking.findUnique({ where: { id: b.id } });
      return res.status(201).json({ paymentId: payment.id, type: 'done', paid: true, status: nb.status });
    }
    res.status(201).json({ paymentId: payment.id, ...intent });
  });

  r.post('/transfers', async (req, res) => {
    const d = parse(TransferSchema, req.body);
    const date = parseDay(d.date); if (!date) throw badRequest('Дата в формате ГГГГ-ММ-ДД');
    let booking = null;
    if (d.bookingToken) {
      booking = await prisma.booking.findFirst({ where: { token: d.bookingToken, accountId: req.accountId }, include: { guest: true } });
      if (!booking) throw notFound('Бронь не найдена');
    } else if (!d.name || !d.phone) throw badRequest('Укажите имя и телефон');
    const t = await prisma.transfer.create({
      data: {
        accountId: req.accountId, bookingId: booking?.id, guestId: booking?.guestId, apartmentId: booking?.apartmentId,
        direction: d.direction, place: d.place, date, time: d.time, flight: d.flight, pax: d.pax, bags: d.bags, childSeats: d.childSeats, carClass: d.carClass,
        priceKzt: transferLegPrice(d), status: 'requested', sign: d.sign || d.name || booking?.guest?.name, address: d.address,
        guestName: d.name || booking?.guest?.name, guestPhone: d.phone || booking?.guest?.phone,
      },
    });
    events.emit('transfer.requested', { accountId: req.accountId, transferId: t.id });
    // бронь уже подтверждена — заказ водителям создаётся сразу; иначе — при подтверждении брони
    let status = t.status;
    if (booking?.status === 'confirmed' && dispatch) { await dispatch.createForTransfer({ accountId: req.accountId, transferId: t.id }); status = 'planned'; }
    res.status(201).json({ id: t.id, status, priceKzt: t.priceKzt, date: isoDay(t.date), time: t.time });
  });
  return r;
}
