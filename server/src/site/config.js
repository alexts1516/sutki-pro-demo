// Сборка «конфигурации сайта» для гостей: бренд, тексты (свои поверх стандартных), валюты.
import { SITE_LANGS, defaultTexts, DEFAULT_BRAND } from './defaults.js';

export async function loadBrand(prisma, accountId) {
  const b = await prisma.brand.findUnique({ where: { accountId } });
  const x = b || { ...DEFAULT_BRAND, logoUrl: null };
  return {
    name: x.name, short: x.short, tagline: { ru: x.taglineRu, en: x.taglineEn }, logoUrl: x.logoUrl || null,
    colors: { ...DEFAULT_BRAND.colors, ...(x.colors || {}) },
    contacts: { phone: x.phone, telegram: x.telegram, whatsapp: x.whatsapp, email: x.email },
  };
}

export async function loadTexts(prisma, accountId) {
  const rows = await prisma.siteText.findMany({ where: { accountId } });
  const out = {}, custom = {};
  for (const l of SITE_LANGS) { out[l] = defaultTexts(l); custom[l] = {}; }
  for (const t of rows) if (out[t.lang] && t.key in out[t.lang]) { out[t.lang][t.key] = t.value; custom[t.lang][t.key] = t.value; }
  return { texts: out, custom };
}

export async function loadCurrency(prisma, accountId) {
  const [cs, rates] = await Promise.all([
    prisma.currencySettings.findUnique({ where: { accountId } }),
    prisma.exchangeRate.findMany({ where: { accountId } }),
  ]);
  return {
    base: 'KZT', shown: cs?.shown || ['KZT'], roundMode: cs?.roundMode || 'nearest', roundStep: cs?.roundStep || {},
    rates: Object.fromEntries(rates.map(r => [r.code, r.rateKzt])),
    updatedAt: rates.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), new Date(0)),
  };
}
