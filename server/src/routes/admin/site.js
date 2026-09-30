// Тексты сайта и бренд.
//   GET  /api/admin/site-texts            — все ключи: по умолчанию, свои значения, подсказки
//   PUT  /api/admin/site-texts            — { lang, values: { key: 'текст' | '' } } ('' или null — вернуть стандартный)
//   GET  /api/admin/brand                 — название, слоган, цвета, контакты, логотип
//   PATCH /api/admin/brand                — изменить
//   POST /api/admin/brand/logo            — загрузить логотип (поле logo)
//   DELETE /api/admin/brand/logo          — убрать логотип (вернётся рисованная заглушка)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { badRequest, parse } from '../../lib/errors.js';
import { SITE_TEXT_KEYS, SITE_LANGS, DEFAULT_BRAND } from '../../site/defaults.js';
import { loadBrand, loadTexts } from '../../site/config.js';
import { imageUpload } from '../../lib/upload.js';
import { makeKey, looksLikeImage } from '../../storage/index.js';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB');
const BrandSchema = z.object({
  name: z.string().min(1).max(60).optional(), short: z.string().min(1).max(4).optional(),
  taglineRu: z.string().max(80).optional(), taglineEn: z.string().max(80).optional(),
  colors: z.object({ brand: color, brand2: color, accent: color, accent2: color }).partial().optional(),
  phone: z.string().max(40).optional().nullable(), telegram: z.string().max(60).optional().nullable(),
  whatsapp: z.string().max(40).optional().nullable(), email: z.string().max(120).optional().nullable(),
});

export default function siteRouter({ storage, config }) {
  const r = Router();
  const upload = imageUpload({ maxMb: 5, maxFiles: 1 });

  r.get('/site-texts', async (req, res) => {
    const { texts, custom } = await loadTexts(prisma, req.accountId);
    res.json({ langs: SITE_LANGS, keys: SITE_TEXT_KEYS.map(({ key, group, hint, ru, en }) => ({ key, group, hint, defaults: { ru, en } })), texts, custom });
  });
  r.put('/site-texts', async (req, res) => {
    const { lang, values } = parse(z.object({ lang: z.enum(SITE_LANGS), values: z.record(z.string(), z.string().max(2000).nullable()) }), req.body);
    const known = new Set(SITE_TEXT_KEYS.map(k => k.key));
    const bad = Object.keys(values).filter(k => !known.has(k));
    if (bad.length) throw badRequest('Неизвестные ключи: ' + bad.join(', '));
    const def = Object.fromEntries(SITE_TEXT_KEYS.map(k => [k.key, k[lang]]));
    const ops = Object.entries(values).map(([key, v]) => {
      const val = (v ?? '').trim();
      const where = { accountId_lang_key: { accountId: req.accountId, lang, key } };
      return !val || val === def[key]
        ? prisma.siteText.deleteMany({ where: { accountId: req.accountId, lang, key } })
        : prisma.siteText.upsert({ where, update: { value: val }, create: { accountId: req.accountId, lang, key, value: val } });
    });
    await prisma.$transaction(ops);
    const { texts, custom } = await loadTexts(prisma, req.accountId);
    res.json({ texts, custom });
  });

  r.get('/brand', async (req, res) => res.json(await loadBrand(prisma, req.accountId)));
  r.patch('/brand', async (req, res) => {
    const data = parse(BrandSchema, req.body);
    const cur = await prisma.brand.findUnique({ where: { accountId: req.accountId } });
    const colors = { ...DEFAULT_BRAND.colors, ...(cur?.colors || {}), ...(data.colors || {}) };
    await prisma.brand.upsert({
      where: { accountId: req.accountId },
      update: { ...data, colors },
      create: { ...DEFAULT_BRAND, ...data, colors, accountId: req.accountId },
    });
    res.json(await loadBrand(prisma, req.accountId));
  });
  r.post('/brand/logo', upload.single('logo'), async (req, res) => {
    const f = req.file; if (!f) throw badRequest('Выберите файл логотипа (поле logo)');
    if (!looksLikeImage(f.buffer)) throw badRequest('Файл не похож на картинку');
    const cur = await prisma.brand.findUnique({ where: { accountId: req.accountId } });
    const saved = await storage.save(makeKey(req.accountId, 'brand', f.mimetype, f.originalname), f.buffer, f.mimetype);
    await prisma.brand.upsert({
      where: { accountId: req.accountId },
      update: { logoUrl: saved.url, logoKey: saved.key },
      create: { ...DEFAULT_BRAND, accountId: req.accountId, logoUrl: saved.url, logoKey: saved.key },
    });
    if (cur?.logoKey) await storage.remove(cur.logoKey).catch(() => {});
    res.status(201).json(await loadBrand(prisma, req.accountId));
  });
  r.delete('/brand/logo', async (req, res) => {
    const cur = await prisma.brand.findUnique({ where: { accountId: req.accountId } });
    if (cur?.logoKey) await storage.remove(cur.logoKey).catch(() => {});
    if (cur) await prisma.brand.update({ where: { accountId: req.accountId }, data: { logoUrl: null, logoKey: null } });
    res.json(await loadBrand(prisma, req.accountId));
  });
  return r;
}
