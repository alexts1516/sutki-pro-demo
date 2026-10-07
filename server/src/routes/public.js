// API для сайта гостей (без входа). Аккаунт определяется по slug в адресе:
//   GET  /api/public/:slug/site                         — бренд, тексты, валюты, способы оплаты
//   GET  /api/public/:slug/apartments?checkIn&checkOut&guests&lang — квартиры с фото и подписями
//   GET  /api/public/:slug/apartments/:id               — квартира + занятые даты на 6 месяцев
//   GET  /api/public/:slug/apartments/:id/availability?from&to — занятые интервалы
//   GET  /api/public/:slug/apartments/:id/quote          — серверная доступность и итоговая цена
//   POST /api/public/:slug/bookings                     — заявка на бронь
//   GET  /api/public/:slug/bookings/:token              — статус брони для гостя
//   POST /api/public/:slug/bookings/:token/pay          — начать онлайн-оплату (если включена)
//   POST /api/public/:slug/transfers                    — заказ трансфера (к брони или отдельно)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound, badRequest, HttpError, parse } from '../lib/errors.js';
import { apartmentPublic } from '../lib/serialize.js';
import { parseDay, isoDay, addDays, todayIn, nights } from '../lib/dates.js';
import { convertKzt } from '../lib/money.js';
import { busyRanges, createBookingRequest, isAvailable, quote, withApartmentTx, extendHold, PUBLIC_HOLD_MIN } from '../services/bookings.js';
import { transferLegPrice } from '../services/transfers.js';
import { loadBrand, loadTexts, loadCurrency } from '../site/config.js';
import { deepLink } from '../telegram/linking.js';
import { applyPaymentResult } from '../payments/index.js';

import { apartmentGuest, bookingGuest, publicRef } from '../lib/publicDtos.js';
import { checkout, operationKey, issueOperationKey, findGuestBooking, startAttempt } from '../services/publicCheckout.js';
import { linkGuard, createLimiter, tooMany } from '../lib/rateLimit.js';

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

export default function publicRouter({ events, payments, config, dispatch, storage }) {
  const r = Router({ mergeParams: true });

  const limits = config.rateLimit || {};
  r.use(linkGuard({ max: limits.publicMax ?? (config.isTest ? 5000 : 120), badMax: limits.publicBadMax ?? 20, windowMin: 15 }));
  const writes = createLimiter({max: limits.publicWriteMax ?? (config.isTest ? 5000 : 30), windowMs: 15*60000});
  r.use((req,res,next) => {
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    if(req.method==='POST'){ const wait=writes.blockedFor(req.ip); if(wait) throw tooMany(res,wait,'Слишком много операций.'); writes.hit(req.ip); }
    next();
  });
  // аккаунт по slug (кешировать не будем — запрос дешёвый)
  r.use(async (req, _res, next) => {
    const acc = await prisma.account.findUnique({ where: { slug: req.params.slug } });
    if (!acc || acc.status === 'cancelled') throw notFound('Сайт не найден');
    if (acc.status === 'suspended') throw new HttpError(403, 'Сайт временно недоступен');
    req.account = acc; req.accountId = acc.id; next();
  });

  r.post('/operation-key',(req,res)=>res.status(201).json({operationKey:issueOperationKey(config,req.params.slug)}));

  r.get('/photos/:ref',async(req,res)=>{
    const photos=await prisma.apartmentPhoto.findMany({where:{accountId:req.accountId,apartment:{active:true}}});
    const p=photos.find(p=>publicRef(config,req.accountId,'photo:'+p.id)===req.params.ref);
    if(!p) throw notFound('Фото не найдено');
    res.type(p.mimeType || 'image/jpeg').send(await storage.read(p.storageKey));
  });

  r.get('/logo',async(req,res)=>{
    const brand=await prisma.brand.findUnique({where:{accountId:req.accountId}});
    if(!brand?.logoKey) throw notFound('Логотип не найден');
    const suffix=brand.logoKey.split('.').pop().toLowerCase();const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif'}[suffix];
    if(!mime) throw notFound('Логотип не найден');
    res.type(mime).send(await storage.read(brand.logoKey));
  });

  r.get('/site', async (req, res) => {
    const [brand, { texts }, currency] = await Promise.all([loadBrand(prisma, req.accountId), loadTexts(prisma, req.accountId), loadCurrency(prisma, req.accountId)]);
    if(brand.logoUrl && !brand.logoUrl.startsWith('data:') && !brand.logoUrl.includes('/demo/assets/')) { const raw=await prisma.brand.findUnique({where:{accountId:req.accountId}}); if(raw?.logoKey) brand.logoUrl=`/api/public/${encodeURIComponent(req.params.slug)}/logo`; }
    res.json({
      account: { name: req.account.name, slug: req.account.slug }, brand, texts,
      currency: { base: 'KZT', shown: currency.shown, rates: currency.rates, roundStep: currency.roundStep },
      payments: { online: !!payments && payments.guestCheckoutReady !== false, provider: payments?.name || null, offline: [], bookingMethod: 'card' },   // бронь на сайте — только с оплатой картой (особые условия — личная ссылка)
      telegram: { bot: config.telegram.username || null },
    });
  });

  r.get('/apartments', async (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'ru';
    const ci = parseDay(req.query.checkIn), co = parseDay(req.query.checkOut);
    const guests = Number(req.query.guests) || 0;
    const pets = req.query.pets === '1' || req.query.pets === 'true';
    const list = await prisma.apartment.findMany({ where: { accountId: req.accountId, active: true, ...(guests ? { maxGuests: { gte: guests } } : {}) }, include: { photos: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const out = [];
    for (const a of list) {
      const item = apartmentPublic(a, lang);
      if (ci && co && co > ci) { item.available = await isAvailable(req.accountId, a.id, ci, co); item.quote = quote(a, ci, co, pets); }
      out.push(apartmentGuest(item,config,req.accountId,req.params.slug));
    }
    res.json(out);
  });

  const findApt = async (req) => {
    const all = await prisma.apartment.findMany({ where: { accountId: req.accountId, active: true }, include: { photos: true } });
    const a = all.find(a => a.id===req.params.id || publicRef(config,req.accountId,a.id) === req.params.id);
    if (!a) throw notFound('Квартира не найдена'); return a;
  };
  const ranges = async (req, a, from, to) => (await busyRanges(req.accountId, a.id, from, to)).map(b => ({ from: isoDay(b.from), to: isoDay(b.to) }));

  r.get('/apartments/:id', async (req, res) => {
    const a = await findApt(req); const today = todayIn(req.account.timezone);
    res.json({ ...apartmentGuest(apartmentPublic(a, req.query.lang === 'en' ? 'en' : 'ru'),config,req.accountId,req.params.slug), busy: await ranges(req, a, today, addDays(today, 183)) });
  });
  r.get('/apartments/:id/availability', async (req, res) => {
    const a = await findApt(req); const today = todayIn(req.account.timezone);
    const from = parseDay(req.query.from) || today, to = parseDay(req.query.to) || addDays(from, 92);
    if (to <= from || nights(from, to) > 400) throw badRequest('Неверный период');
    res.json({ ref: publicRef(config,req.accountId,a.id), from: isoDay(from), to: isoDay(to), busy: await ranges(req, a, from, to) });
  });
  r.get('/apartments/:id/quote', async (req, res) => {
    const a = await findApt(req); const checkIn = parseDay(req.query.checkIn), checkOut = parseDay(req.query.checkOut);
    const guests = Number(req.query.guests), pets = req.query.pets === '1' || req.query.pets === 'true';
    if (!checkIn || !checkOut || checkOut <= checkIn) throw badRequest('Проверьте даты заезда и выезда');
    if (checkIn < todayIn(req.account.timezone)) throw badRequest('Дата заезда уже прошла');
    if (nights(checkIn, checkOut) > 90) throw badRequest('Максимум 90 ночей');
    if (!Number.isInteger(guests) || guests < 1 || guests > a.maxGuests) throw badRequest(`В этой квартире максимум ${a.maxGuests} гостей`);
    if (pets && !a.petsAllowed) throw badRequest('В этой квартире нельзя с животными');
    const available = await isAvailable(req.accountId, a.id, checkIn, checkOut);
    res.json({ ref: publicRef(config,req.accountId,a.id), checkIn:isoDay(checkIn), checkOut:isoDay(checkOut), guests, pets, available, ...quote(a,checkIn,checkOut,pets) });
  });

  r.post('/bookings', async (req, res) => {
    const key = operationKey(req,config);
    const d = parse(BookingSchema, req.body);
    // проход 4, шаг 4: обычный гость бронирует на сайте только с оплатой картой; способ оплаты ставит сервер.
    // Любое другое значение — 400 (а не молчаливая замена: гость должен понять, что наличных на сайте нет).
    if (d.paymentMethod !== undefined && d.paymentMethod !== 'card') throw badRequest(CARD_ONLY);
    const ci = parseDay(d.checkIn), co = parseDay(d.checkOut);
    const today = todayIn(req.account.timezone);
    if (!ci || !co || co <= ci) throw badRequest('Проверьте даты заезда и выезда');
    if (ci < today) throw badRequest('Дата заезда уже прошла');
    if (nights(ci, co) > 90) throw badRequest('Максимум 90 ночей');
    const apts = await prisma.apartment.findMany({ where: { accountId: req.accountId, active: true } });
    const apt = apts.find(a => a.id === d.apartmentId || publicRef(config,req.accountId,a.id) === d.apartmentId);
    if (!apt) throw notFound('Квартира не найдена');
    if (d.guests > apt.maxGuests) throw badRequest(`В этой квартире максимум ${apt.maxGuests} гостей`);
    if (d.pets && !apt.petsAllowed) throw badRequest('В этой квартире нельзя с животными');
    const cur = await loadCurrency(prisma, req.accountId);
    const q = quote(apt, ci, co, d.pets);
    const amountShown = convertKzt(q.totalKzt, d.currency, cur.rates, cur.roundStep);
    const result = await checkout({ accountId:req.accountId,apartment:apt,data:d,guestData:{name:d.name,phone:d.phone,email:d.email,locale:d.lang},key,config,
      amountShown,holdUntil:new Date(Date.now()+PUBLIC_HOLD_MIN*60000) });
    // Creation reply may be replayed only with the same high-entropy checkout proof.
    res.status(201).json({...bookingGuest(result.booking),token:result.token,payOnline:!!payments && payments.guestCheckoutReady !== false,telegramLink:deepLink(config.telegram.username,`b_${result.token}`)});
  });

  const byToken = req => findGuestBooking(req.accountId,req.params.token);
  r.get('/bookings/:token',async(req,res)=>res.json(bookingGuest(await byToken(req))));
  r.get('/payment-return',(_req,res)=>res.json({status:'processing',message:'Проверьте состояние своей брони'}));
  r.post('/bookings/:token/pay',async(req,res)=>{
    if(!payments || payments.guestCheckoutReady === false) throw new HttpError(409,'Онлайн-оплата пока не подключена');
    const result=await startAttempt({booking:await byToken(req),key:operationKey(req,config),payments,config,slug:req.account.slug,events,dispatch});
    res.status(result.code).json(result.body);
  });

  r.post('/transfers', async (req, res) => {
    const d = parse(TransferSchema, req.body);
    const date = parseDay(d.date); if (!date) throw badRequest('Дата в формате ГГГГ-ММ-ДД');
    let booking = null;
    if (d.bookingToken) {
      booking = await findGuestBooking(req.accountId,d.bookingToken);
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
    res.status(201).json({ ref: publicRef(config,req.accountId,t.id), status, priceKzt: t.priceKzt, date: isoDay(t.date), time: t.time });
  });
  return r;
}
