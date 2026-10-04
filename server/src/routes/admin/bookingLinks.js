// Личные ссылки для особой брони (проход 4, шаг 6; раздел 6.1 спецификации). Владелец и админ (requireRole(...MANAGERS) в app.js).
//   POST  /api/admin/booking-links                    — создать { apartmentId, checkIn, checkOut, guestsCount, terms, depositKzt?, totalKzt?,
//                                                        expiresInHours?, extraCheckRequired?, extraCheckNote?, guestName?, guestPhone?, note? } → 201 { link, url }
//   GET   /api/admin/booking-links?status=active|all  — список (после ленивого истечения)
//   GET   /api/admin/booking-links/:id                — одна ссылка
//   POST  /api/admin/booking-links/:id/extend         — { hours: 1…72 }
//   POST  /api/admin/booking-links/:id/rotate         — новая ссылка (старая сразу не работает) → { link, url }
//   POST  /api/admin/booking-links/:id/revoke         — { reason? }
//   POST  /api/admin/booking-links/:id/deposit        — «Залог получен»
//   POST  /api/admin/booking-links/:id/extra-check    — «Подтверждение получено»
//   PATCH /api/admin/booking-links/:id/price          — { totalKzt } (владелец; админ — только с правом canSetLinkPrice)
//   GET   /api/admin/booking-links/:id/price-history  — журнал цены
// Токен — только в url ответов create/rotate; в базе — хэш; ни токен, ни хэш больше нигде не отдаются.
import { Router } from 'express';
import { z } from 'zod';
import { parse, badRequest } from '../../lib/errors.js';
import { parseDay } from '../../lib/dates.js';
import * as links from '../../services/bookingLinks.js';

export default function bookingLinksRouter({ events, dispatch, config }) {
  const r = Router();
  const actorOf = (req) => ({ type: req.role, id: req.user.id, name: req.user.name });
  const urlOf = (token) => `${config.publicUrl}/link/${token}`;
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД');
  const CreateSchema = z.object({   // лишние поля (accountId, createdBy, отметки, статус) отбрасываются — их ставит сервер
    apartmentId: z.string().min(1), checkIn: day, checkOut: day, guestsCount: z.number().int().min(1).max(50),
    terms: z.enum(links.LINK_TERMS), depositKzt: z.number().int().positive().nullable().optional(), totalKzt: z.number().int().positive().nullable().optional(),
    expiresInHours: z.number().int().min(links.LINK_HOURS.min).max(links.LINK_HOURS.max).default(links.LINK_HOURS.def),
    extraCheckRequired: z.boolean().default(false), extraCheckNote: z.string().max(500).nullable().optional(),
    guestName: z.string().max(80).nullable().optional(), guestPhone: z.string().max(30).nullable().optional(), note: z.string().max(1000).nullable().optional(),
  });

  r.post('/booking-links', async (req, res) => {
    const d = parse(CreateSchema, req.body);
    const checkIn = parseDay(d.checkIn), checkOut = parseDay(d.checkOut);
    if (!checkIn || !checkOut) throw badRequest('Проверьте даты заезда и выезда');
    const { link, token } = await links.createLink({ ...d, checkIn, checkOut, accountId: req.accountId, actor: actorOf(req) });
    res.set('Cache-Control', 'no-store').status(201).json({ link, url: urlOf(token) });
  });
  r.get('/booking-links', async (req, res) => {
    res.json(await links.listLinks({ accountId: req.accountId, status: req.query.status === 'all' ? 'all' : 'active' }));
  });
  r.get('/booking-links/:id', async (req, res) => res.json(await links.getLink({ accountId: req.accountId, linkId: req.params.id })));
  r.post('/booking-links/:id/extend', async (req, res) => {
    const d = parse(z.object({ hours: z.number().int().min(links.LINK_HOURS.min).max(links.LINK_HOURS.max) }), req.body);
    res.json(await links.extendLink({ accountId: req.accountId, linkId: req.params.id, hours: d.hours }));
  });
  r.post('/booking-links/:id/rotate', async (req, res) => {
    const { link, token } = await links.rotateLink({ accountId: req.accountId, linkId: req.params.id });
    res.set('Cache-Control', 'no-store').json({ link, url: urlOf(token) });
  });
  r.post('/booking-links/:id/revoke', async (req, res) => {
    const d = parse(z.object({ reason: z.string().max(300).optional() }), req.body || {});
    res.json(await links.revokeLink({ accountId: req.accountId, linkId: req.params.id, actor: actorOf(req), events, dispatch, reason: d.reason }));
  });
  r.post('/booking-links/:id/deposit', async (req, res) => res.json(await links.markDeposit({ accountId: req.accountId, linkId: req.params.id, actor: actorOf(req), events, dispatch })));
  r.post('/booking-links/:id/extra-check', async (req, res) => res.json(await links.markExtraCheck({ accountId: req.accountId, linkId: req.params.id, actor: actorOf(req), events, dispatch })));
  r.patch('/booking-links/:id/price', async (req, res) => {
    const d = parse(z.object({ totalKzt: z.number().int().positive() }), req.body);
    res.json(await links.changeLinkPrice({ accountId: req.accountId, linkId: req.params.id, actor: actorOf(req), totalKzt: d.totalKzt }));
  });
  r.get('/booking-links/:id/price-history', async (req, res) => res.json(await links.priceHistory({ accountId: req.accountId, linkId: req.params.id })));
  return r;
}
