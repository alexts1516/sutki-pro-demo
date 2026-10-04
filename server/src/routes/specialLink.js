// Личная ссылка гостя без входа (проход 4, шаг 7; раздел 6.2 спецификации). Подключается в app.js через тот же linkGuard,
// что /api/link, /api/task-link и /api/transfer-link (лимиты общие и не меняются).
//   GET  /api/special-link/:token          — предложение и состояние; 410 для закрытых (expired / revoked / cancelled)
//   POST /api/special-link/:token/guest    — { name, phone, email?, acceptTerms: true } → как GET; 409 если не active; 410
//   POST /api/special-link/:token/submit   — «Подтвердить» → { status:'completed', booking } или { status:'active', stage, missing }; 409 конфликт дат; 410
// Токен: 40–64 символа, иначе 404 без запроса к базе; поиск только по sha256 (findLinkByToken). Токен никуда не пишется.
// В ответах нет bookingId, guestId, accountId, id ссылки, токена и хэша. Лишние поля тела (цена, даты, отметки, статус) отбрасывает zod.
import { Router } from 'express';
import { z } from 'zod';
import { parse, notFound } from '../lib/errors.js';
import { guestView, guestSave, guestSubmit } from '../services/bookingLinks.js';

const phoneRe = /^[+\d][\d\s()-]{5,20}$/;   // как у брони на сайте (routes/public.js)
const GuestSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(80),
  phone: z.string().trim().regex(phoneRe, 'Телефон в формате +7 700 000 00 00'),
  email: z.string().trim().email('Проверьте почту').max(120).optional().nullable().or(z.literal('').transform(() => null)),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие с условиями' }) }),
});

export default function specialLinkRouter({ events, dispatch, config }) {
  const r = Router();
  r.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  // длина — до разбора тела и до базы: неверная ссылка всегда 404 (её считает linkGuard)
  const tok = (req) => { const t = String(req.params.token || ''); if (t.length < 40 || t.length > 64) throw notFound('Ссылка не найдена или заменена новой'); return t; };
  r.get('/:token', async (req, res) => res.json(await guestView({ token: tok(req), config })));
  r.post('/:token/guest', async (req, res) => {
    const token = tok(req);
    const d = parse(GuestSchema, req.body || {});
    res.json(await guestSave({ token, name: d.name, phone: d.phone, email: d.email || null, config, events, dispatch }));
  });
  r.post('/:token/submit', async (req, res) => res.json(await guestSubmit({ token: tok(req), events, dispatch })));
  return r;
}
