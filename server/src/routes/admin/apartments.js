// Квартиры и фото (владелец и администратор).
//   GET    /api/admin/apartments                  — список
//   POST   /api/admin/apartments                  — создать
//   GET    /api/admin/apartments/:id              — одна квартира с фото
//   PATCH  /api/admin/apartments/:id              — изменить
//   DELETE /api/admin/apartments/:id              — удалить (только владелец)
//   POST   /api/admin/apartments/:id/photos       — загрузить фото (поле photos, можно много; captions — подписи)
//   PUT    /api/admin/apartments/:id/photos/order — новый порядок { ids: [...] }
//   PATCH  /api/admin/photos/:photoId             — подпись { caption, captionEn }
//   POST   /api/admin/photos/:photoId/cover       — сделать обложкой
//   DELETE /api/admin/photos/:photoId             — удалить фото
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireRole } from '../../auth/middleware.js';
import { notFound, badRequest, parse } from '../../lib/errors.js';
import { apartmentAdmin, photoOut } from '../../lib/serialize.js';
import { imageUpload } from '../../lib/upload.js';
import { makeKey, looksLikeImage } from '../../storage/index.js';

const opt = (s) => s.optional().nullable();
const bool = z.union([z.boolean(), z.enum(['true', 'false', 'on', '1', '0']).transform(v => v === 'true' || v === 'on' || v === '1')]);
const ApartmentSchema = z.object({
  code: opt(z.string().max(20)), title: z.string().min(2).max(120), titleEn: opt(z.string().max(120)), complex: opt(z.string().max(80)),
  address: z.string().min(3).max(200), district: z.string().min(2).max(60), rooms: z.string().min(2).max(30),
  maxGuests: z.coerce.number().int().min(1).max(30), areaM2: opt(z.coerce.number().int().min(5).max(1000)),
  basePriceKzt: z.coerce.number().int().min(0).max(10_000_000),
  description: opt(z.string().max(5000)), descriptionEn: opt(z.string().max(5000)),
  petsAllowed: bool.optional(), petFeeKzt: z.coerce.number().int().min(0).optional(), petNote: opt(z.string().max(200)),
  lockCode: opt(z.string().max(40)), keyboxCode: opt(z.string().max(40)), intercom: opt(z.string().max(40)), entrance: opt(z.string().max(20)),
  floor: opt(z.coerce.number().int().min(-5).max(200)), wifiName: opt(z.string().max(60)), wifiPassword: opt(z.string().max(60)), accessNote: opt(z.string().max(1000)),
  active: bool.optional(), sortOrder: z.coerce.number().int().optional(),
  // подготовка: доп. пункты чек-листа этой квартиры и своя оплата специалисту
  cleaningExtraItems: opt(z.array(z.object({ label: z.string().trim().min(1).max(80), photo: z.boolean().default(false) })).max(20)),
  cleaningRateKzt: opt(z.coerce.number().int().min(0).max(1_000_000)),
});

export default function apartmentsRouter({ storage, config }) {
  const r = Router();
  const upload = imageUpload({ maxMb: config.storage.maxUploadMb });
  const findApt = async (req, id = req.params.id) => {
    const a = await prisma.apartment.findFirst({ where: { id, accountId: req.accountId }, include: { photos: true } });
    if (!a) throw notFound('Квартира не найдена'); return a;
  };
  const findPhoto = async (req) => {
    const p = await prisma.apartmentPhoto.findFirst({ where: { id: req.params.photoId, accountId: req.accountId } });
    if (!p) throw notFound('Фото не найдено'); return p;
  };

  r.get('/apartments', async (req, res) => {
    const list = await prisma.apartment.findMany({ where: { accountId: req.accountId }, include: { photos: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json(list.map(apartmentAdmin));
  });
  r.post('/apartments', async (req, res) => {
    const data = parse(ApartmentSchema, req.body);
    const count = await prisma.apartment.count({ where: { accountId: req.accountId } });
    const a = await prisma.apartment.create({ data: { ...data, sortOrder: data.sortOrder ?? count, accountId: req.accountId }, include: { photos: true } });
    res.status(201).json(apartmentAdmin(a));
  });
  r.get('/apartments/:id', async (req, res) => res.json(apartmentAdmin(await findApt(req))));
  r.patch('/apartments/:id', async (req, res) => {
    await findApt(req);
    const data = parse(ApartmentSchema.partial(), req.body);
    const a = await prisma.apartment.update({ where: { id: req.params.id }, data, include: { photos: true } });
    res.json(apartmentAdmin(a));
  });
  r.delete('/apartments/:id', requireRole('owner'), async (req, res) => {
    const a = await findApt(req);
    await prisma.apartment.delete({ where: { id: a.id } });
    await Promise.all(a.photos.map(p => storage.remove(p.storageKey).catch(() => {})));
    res.json({ ok: true });
  });

  // ---------- фото ----------
  r.post('/apartments/:id/photos', upload.array('photos', 30), async (req, res) => {
    const a = await findApt(req);
    const files = req.files || [];
    if (!files.length) throw badRequest('Выберите хотя бы одно фото (поле photos)');
    const caps = [].concat(req.body.captions ?? []);
    const capsEn = [].concat(req.body.captionsEn ?? []);
    let order = a.photos.reduce((m, p) => Math.max(m, p.sortOrder), -1);
    const created = [];
    for (const [i, f] of files.entries()) {
      if (!looksLikeImage(f.buffer)) throw badRequest(`Файл «${f.originalname}» не похож на картинку`);
      const saved = await storage.save(makeKey(req.accountId, `apartments/${a.id}`, f.mimetype, f.originalname), f.buffer, f.mimetype);
      created.push(await prisma.apartmentPhoto.create({
        data: {
          accountId: req.accountId, apartmentId: a.id, url: saved.url, storageKey: saved.key, mimeType: f.mimetype, sizeBytes: f.size,
          caption: String(caps[i] ?? caps[0] ?? '').slice(0, 80), captionEn: String(capsEn[i] ?? '').slice(0, 80),
          sortOrder: ++order, isCover: a.photos.length === 0 && i === 0,
        },
      }));
    }
    res.status(201).json(created.map(photoOut));
  });

  r.put('/apartments/:id/photos/order', async (req, res) => {
    const a = await findApt(req);
    const { ids } = parse(z.object({ ids: z.array(z.string()).min(1) }), req.body);
    const own = new Set(a.photos.map(p => p.id));
    if (ids.some(id => !own.has(id))) throw badRequest('В списке есть чужие фото');
    const rest = a.photos.filter(p => !ids.includes(p.id)).sort((x, y) => x.sortOrder - y.sortOrder).map(p => p.id);
    await prisma.$transaction([...ids, ...rest].map((id, i) => prisma.apartmentPhoto.update({ where: { id }, data: { sortOrder: i } })));
    res.json(apartmentAdmin(await findApt(req)).photos);
  });

  r.patch('/photos/:photoId', async (req, res) => {
    await findPhoto(req);
    const data = parse(z.object({ caption: z.string().max(80).optional(), captionEn: z.string().max(80).optional() }), req.body);
    res.json(photoOut(await prisma.apartmentPhoto.update({ where: { id: req.params.photoId }, data })));
  });
  r.post('/photos/:photoId/cover', async (req, res) => {
    const p = await findPhoto(req);
    await prisma.$transaction([
      prisma.apartmentPhoto.updateMany({ where: { apartmentId: p.apartmentId }, data: { isCover: false } }),
      prisma.apartmentPhoto.update({ where: { id: p.id }, data: { isCover: true } }),
    ]);
    res.json(apartmentAdmin(await findApt(req, p.apartmentId)).photos);
  });
  r.delete('/photos/:photoId', async (req, res) => {
    const p = await findPhoto(req);
    await prisma.apartmentPhoto.delete({ where: { id: p.id } });
    await storage.remove(p.storageKey).catch(() => {});
    if (p.isCover) {
      const first = await prisma.apartmentPhoto.findFirst({ where: { apartmentId: p.apartmentId }, orderBy: { sortOrder: 'asc' } });
      if (first) await prisma.apartmentPhoto.update({ where: { id: first.id }, data: { isCover: true } });
    }
    res.json({ ok: true });
  });
  return r;
}
