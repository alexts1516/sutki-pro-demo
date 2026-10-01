// Ссылка для внешнего водителя без входа (подрядчик с «водитель»): хозяин/админ назначил — водитель получил ссылку.
//   GET  /api/transfer-link/:token            — заказ: маршрут, время, гость, телефон (пока заказ в работе)
//   POST /api/transfer-link/:token/en-route   — { etaMinutes? }   /arrived   /picked-up   /done { note? }
//   POST /api/transfer-link/:token/time       — { time, date?, note } новое время подачи
// Ссылка перестаёт работать (410), когда заказ выполнен/отменён или водителя сменили.
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, notFound, parse } from '../lib/errors.js';
import { loadJob, jobForLink, TERMINAL } from '../services/transferJobs.js';

export default function transferLinkRouter({ dispatch }) {
  const r = Router();
  async function resolve(req) {
    const job = await loadJob({ linkToken: req.params.token });
    if (!job || !job.driverContractorId) throw notFound('Ссылка недействительна');
    if (TERMINAL.includes(job.status)) throw new HttpError(410, 'Заказ закрыт — ссылка больше не работает');
    return { job, actor: { type: 'link', id: job.driverContractorId, name: job.driverName } };
  }
  r.get('/:token', async (req, res) => { const { job } = await resolve(req); res.json(jobForLink(job)); });
  for (const action of ['en-route', 'arrived', 'picked-up', 'done']) {
    r.post(`/:token/${action}`, async (req, res) => {
      const d = parse(z.object({ etaMinutes: z.number().int().min(1).max(600).optional(), note: z.string().max(500).optional() }), req.body || {});
      const { job, actor } = await resolve(req);
      res.json(jobForLink(await dispatch.step({ job, actor, action, ...d })));
    });
  }
  r.post('/:token/time', async (req, res) => {
    const d = parse(z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(300).optional() }), req.body);
    const { job, actor } = await resolve(req);
    res.json(jobForLink(await dispatch.reschedule({ job, actor, ...d })));
  });
  return r;
}
