// Шаги мастера/подрядчика по заявке. Одни и те же обработчики подключены в двух местах:
//   /api/staff/repairs/:id/...   — мастер вошёл в приложение команды (видит только свои заявки)
//   /api/task-link/:token/...    — ссылка на одну задачу без входа (как task.html в демо)
// Кто именно делает шаг и можно ли ему — решает resolve(req) → { task, actor }; правила статусов — в services/workRequests.js.
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { imageUpload } from '../lib/upload.js';
import { makeKey, looksLikeImage } from '../storage/index.js';
import { taskForMaster, loadTask, MASTER_PHOTO_KINDS } from '../services/workRequests.js';

const money = z.coerce.number().int().min(0).max(100_000_000);
const ids = z.array(z.string()).max(30).optional();
export const schemas = {
  estimate: z.object({
    method: z.enum(['REMOTE', 'PHOTOS', 'VISIT']), labourKzt: money, materialsKzt: money.optional().nullable(), materialsIncluded: z.boolean().default(false),
    maxKzt: money.optional().nullable(), items: z.string().max(1000).optional(), comment: z.string().max(2000).optional(),
  }),
  note: z.object({ note: z.string().max(1000).optional() }),
  arrive: z.object({ note: z.string().max(1000).optional(), photoIds: ids }),
  inspect: z.object({ notes: z.string().min(2).max(3000), photoIds: ids }),
  extra: z.object({ amountKzt: z.coerce.number().int().min(1).max(100_000_000), description: z.string().min(3).max(500), reason: z.string().min(3).max(500), photoIds: ids }),
  decline: z.object({ reason: z.string().trim().min(3, 'Напишите причину отказа').max(1000) }),
  complete: z.object({ finalCostKzt: money, report: z.string().min(3).max(3000), photoIds: ids }),
};

export function mountWorkActions(r, { prefix, resolve, workflow, storage, config }) {
  const upload = imageUpload({ maxMb: config.storage.maxUploadMb, maxFiles: 10 });
  const reply = async (res, task, status = 200) => res.status(status).json(taskForMaster(await loadTask({ id: task.id })));
  const step = (fn) => async (req, res) => { const { task, actor } = await resolve(req); const out = await fn(task, actor, req); await reply(res, task, out?.httpStatus || 200); };

  r.get(prefix, async (req, res) => { const { task } = await resolve(req, { read: true }); res.json(taskForMaster(task)); });
  r.post(`${prefix}/request-visit`, step((t, a, req) => workflow.requestVisit(t, a, parse(schemas.note, req.body))));
  r.post(`${prefix}/arrive`, step((t, a, req) => workflow.arrive(t, a, parse(schemas.arrive, req.body))));
  r.post(`${prefix}/inspect`, step((t, a, req) => workflow.inspect(t, a, parse(schemas.inspect, req.body))));
  r.post(`${prefix}/estimate`, step(async (t, a, req) => { await workflow.submitEstimate(t, a, parse(schemas.estimate, req.body)); return { httpStatus: 201 }; }));
  r.post(`${prefix}/start`, step((t, a) => workflow.start(t, a)));
  r.post(`${prefix}/extras`, step(async (t, a, req) => { await workflow.addExtra(t, a, parse(schemas.extra, req.body)); return { httpStatus: 201 }; }));
  r.post(`${prefix}/complete`, step((t, a, req) => workflow.complete(t, a, parse(schemas.complete, req.body))));
  // отказ: заявка уходит владельцу без исполнителя — мастеру больше не показываем карточку
  r.post(`${prefix}/decline`, async (req, res) => {
    const { task, actor } = await resolve(req);
    await workflow.decline(task, actor, parse(schemas.decline, req.body));
    res.json({ declined: true, message: 'Вы отказались от заявки. Владелец выберет другого мастера.' });
  });
  r.post(`${prefix}/photos`, upload.array('photos', 10), async (req, res) => {
    const { task, actor } = await resolve(req);
    const kind = parse(z.object({ kind: z.enum(MASTER_PHOTO_KINDS) }), req.body).kind;
    const photos = await workflow.addPhotos(task, actor, { storage, files: req.files, kind, captions: [].concat(req.body.captions ?? []), makeKey, looksLikeImage });
    res.status(201).json(photos.map(p => ({ id: p.id, kind: p.kind, url: p.url, caption: p.caption })));
  });
}
