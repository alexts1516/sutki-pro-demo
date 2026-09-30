// Заполняет базу демо-данными — теми же, что на статическом демо-сайте (assets/data.js).
// Запуск: npm run db:seed. Повторный запуск пересоздаёт только демо-аккаунты (astana-stay и demo-b).
// Даты сдвигаются так, чтобы «сегодня» прототипа (30 сентября 2026) стало сегодняшним днём.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadPrototypeData } from './demo-data.js';
import { hashPassword } from '../src/auth/password.js';
import { randomToken } from '../src/lib/tokens.js';
import { todayIn, DAY_MS } from '../src/lib/dates.js';
import { createStorage } from '../src/storage/index.js';
import { config } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BRAND } from '../src/site/defaults.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const BUILDING = fs.readFileSync(path.join(ASSETS, 'photos', 'highvill-g1-1200.jpg')); // фото дома (ЖК Хайвил, блок G-1)

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD || 'demo12345';
const DEMO_SLUGS = ['astana-stay', 'demo-b'];
const ROLE = { owner: 'owner', admin: 'admin', cleaner: 'cleaning', master: 'master' };
const AREA = { 'Студия': 24, '1-комн.': 38, '2-комн.': 58, '3-комн.': 82 };
const ROOMS_EN = { 'Студия': 'Studio', '1-комн.': '1-bedroom', '2-комн.': '2-bedroom', '3-комн.': '3-bedroom' };
const CAPTIONS = [['Вид', 'View'], ['Гостиная', 'Living room'], ['Спальня', 'Bedroom'], ['Кухня', 'Kitchen'], ['Ванная', 'Bathroom']];
const HUES = [32, 200, 160, 345, 45, 255, 15, 185, 95, 220, 5, 280];

/** Картинка-заглушка (SVG) с подписью — пока владелец не загрузил настоящие фото */
function placeholderSvg(title, caption, hue) {
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},40%,38%)"/></linearGradient></defs>
<rect width="1200" height="800" fill="url(#g)"/><rect x="0" y="560" width="1200" height="240" fill="rgba(0,0,0,.18)"/>
<path d="M520 300l80-70 80 70v110H520z" fill="none" stroke="#fff" stroke-width="14" stroke-linejoin="round" opacity=".85"/>
<text x="60" y="660" font-family="Inter,Arial,sans-serif" font-size="64" font-weight="700" fill="#fff">${esc(caption)}</text>
<text x="60" y="730" font-family="Inter,Arial,sans-serif" font-size="36" fill="#fff" opacity=".9">${esc(title)} · демо-фото</text></svg>`;
}

async function main() {
  const d = loadPrototypeData();
  const offset = Math.round(todayIn('Asia/Almaty') / DAY_MS) - d.TODAY;
  const day = (i) => new Date((i + offset) * DAY_MS);
  const at = (i, hm) => { const [h, m] = String(hm || '12:00').split(':').map(Number); return new Date((i + offset) * DAY_MS + ((h - 5) * 60 + m) * 60000); }; // время Астаны (UTC+5)
  const storage = createStorage(config.storage);
  const passwordHash = await hashPassword(PASSWORD);

  // ---------- очистка прошлых демо-данных ----------
  const old = await prisma.account.findMany({ where: { slug: { in: DEMO_SLUGS } }, select: { id: true } });
  for (const a of old) await storage.removeFolder?.(a.id).catch(() => {});
  await prisma.account.deleteMany({ where: { slug: { in: DEMO_SLUGS } } });
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: '@astanastay.example' } }, { email: { endsWith: '@demo-b.example' } }] } });

  // ---------- аккаунт A: The Address · Apart Hotel (ЖК Хайвил) ----------
  const acc = await prisma.account.create({ data: { name: 'The Address', slug: 'astana-stay', plan: 'pro', status: 'active', billingEmail: 'owner@astanastay.example', timezone: 'Asia/Almaty' } });
  const users = {};
  for (const s of d.STAFF_BASE) {
    const u = await prisma.user.create({ data: { name: s.name, email: `${s.login}@astanastay.example`, phone: s.phone.replace(/[^\d+]/g, ''), passwordHash, locale: 'ru' } });
    await prisma.membership.create({ data: { userId: u.id, accountId: acc.id, role: ROLE[s.role] } });
    users[s.id] = u; users[s.short] = u;
  }
  // логотип клиента — метка из присланного логотипа (assets/brand/pin-silver-128.png)
  const logoBuf = fs.readFileSync(path.join(ASSETS, 'brand', 'pin-silver-128.png'));
  const logo = await storage.save(`${acc.id}/brand/logo-seed.png`, logoBuf, 'image/png');
  await prisma.brand.create({ data: { ...DEFAULT_BRAND, logoUrl: logo.url, logoKey: logo.key, accountId: acc.id } });
  const fx = d.FX_DEFAULT();
  await prisma.currencySettings.create({ data: { accountId: acc.id, shown: ['KZT', 'RUB', 'USD', 'EUR'], roundMode: fx.round.mode, roundStep: fx.round.step } });
  for (const [code, rateKzt] of Object.entries(fx.rates)) await prisma.exchangeRate.create({ data: { accountId: acc.id, code, rateKzt } });

  // квартиры + фото
  const apt = {};
  for (const a of d.apartments) {
    const pets = d.aptPets(a), door = d.aptDoor(a);
    const rec = await prisma.apartment.create({
      data: {
        accountId: acc.id, code: String(a.num), title: a.name, titleEn: `${a.complex.replace('ЖК ', '')} residence, apt ${a.num}`.replace('Хайвил', 'Highvill'),
        complex: a.complex, address: a.address, district: a.district, rooms: a.rooms, maxGuests: a.maxGuests, areaM2: AREA[a.rooms], basePriceKzt: a.price,
        description: `${a.rooms} квартира в ${a.complex}${a.embassy ? ', рядом с посольством США' : ''}. Заселение 24/7 по коду.`,
        descriptionEn: `${ROOMS_EN[a.rooms]} apartment${a.embassy ? ' near the US Embassy' : ''}. 24/7 self check-in with a door code.`,
        petsAllowed: pets.allowed, petFeeKzt: pets.fee || 0, petNote: pets.allowed ? `${pets.weight}, не больше ${pets.count}` : null,
        entrance: String(door.entrance), floor: door.floor, intercom: door.intercom, keyboxCode: door.keybox, lockCode: String(((a.id * 4817) % 9000) + 1000),
        wifiName: door.wifi, wifiPassword: `astana${a.num}`, sortOrder: a.id,
      },
    });
    apt[a.id] = rec;
    // квартиры в ЖК Хайвил: первое фото — настоящий дом (блок G-1), остальные — заглушки до загрузки владельцем
    let k0 = 0;
    if (a.embassy) {
      const saved = await storage.save(`${acc.id}/apartments/${rec.id}/building.jpg`, BUILDING, 'image/jpeg');
      await prisma.apartmentPhoto.create({ data: { accountId: acc.id, apartmentId: rec.id, url: saved.url, storageKey: saved.key, caption: 'Дом', captionEn: 'Building', sortOrder: 0, isCover: true, mimeType: 'image/jpeg' } });
      k0 = 1;
    }
    const n = 3 + (a.id % 3);
    for (let k = k0; k < n; k++) {
      const [ru, en] = CAPTIONS[k];
      const saved = await storage.save(`${acc.id}/apartments/${rec.id}/seed-${k + 1}.svg`, Buffer.from(placeholderSvg(a.name, ru, HUES[(a.id + k * 3) % HUES.length])), 'image/svg+xml');
      await prisma.apartmentPhoto.create({ data: { accountId: acc.id, apartmentId: rec.id, url: saved.url, storageKey: saved.key, caption: ru, captionEn: en, sortOrder: k, isCover: k === 0 && !k0, mimeType: 'image/svg+xml' } });
    }
  }

  // брони (+ гости)
  const bk = {};
  for (const b of d.bookings) {
    const g = await prisma.guest.create({ data: { accountId: acc.id, name: b.guest, phone: b.phone.replace(/\s/g, '') } });
    bk[b.id] = await prisma.booking.create({
      data: {
        accountId: acc.id, apartmentId: apt[b.aptId].id, guestId: g.id, number: b.id, token: randomToken(12), source: b.source,
        status: b.co <= d.TODAY ? 'completed' : 'confirmed', checkIn: day(b.ci), checkOut: day(b.co), checkInTime: b.checkinTime, checkOutTime: b.checkoutTime,
        guestsCount: b.guests, nightlyKzt: b.nightly, totalKzt: b.total, paymentStatus: b.payment, note: b.note, cleanerName: b.cleaner,
        paymentMethod: b.source === 'airbnb' || b.source === 'booking' ? 'card' : 'cash', confirmedAt: day(b.ci - 7),
      },
    });
  }
  // заявки из каналов → брони со статусом request (подтверждённые — confirmed)
  let num = Math.max(...d.bookings.map(b => b.id));
  for (const r of d.requests) {
    const g = await prisma.guest.create({ data: { accountId: acc.id, name: r.name, phone: '+7701555' + String(1000 + r.id * 37).slice(-4) } });
    const a = apt[r.aptId];
    await prisma.booking.create({
      data: {
        accountId: acc.id, apartmentId: a.id, guestId: g.id, number: ++num, token: randomToken(12), source: r.channel,
        status: r.status === 'confirmed' ? 'confirmed' : 'request', checkIn: day(r.ci), checkOut: day(r.co), guestsCount: r.guests,
        nightlyKzt: a.basePriceKzt, totalKzt: a.basePriceKzt * (r.co - r.ci), note: r.text, paymentMethod: 'cash',
      },
    });
  }
  // трансферы
  for (const t of d.transfers) {
    const b = d.bookings.find(x => x.id === t.bookingId);
    await prisma.transfer.create({
      data: {
        accountId: acc.id, bookingId: bk[t.bookingId]?.id, guestId: bk[t.bookingId]?.guestId, apartmentId: b ? apt[b.aptId].id : null,
        direction: t.dir, place: 'airport', date: day(t.date), time: t.time, flight: t.flight, pax: t.pax, priceKzt: t.price,
        status: t.status, driverName: t.driver, guestName: b?.guest, sign: b?.guest,
      },
    });
  }
  // уборки
  for (const c of d.cleanings) {
    await prisma.cleaningTask.create({
      data: {
        accountId: acc.id, apartmentId: apt[c.aptId].id, bookingId: bk[c.bookingId]?.id, assigneeId: users[c.cleaner]?.id, date: day(c.date),
        fromTime: c.from, toTime: c.to, status: c.status, checklist: d.CHECKLIST.map((label, k) => ({ label, done: !!c.checked[k] })),
        doneAt: c.doneAt ? at(c.date, c.doneAt) : null,
      },
    });
  }
  // подрядчики, ремонты, сметы
  const contr = {};
  for (const c of d.CONTRACTORS_BASE) contr[c.id] = await prisma.contractor.create({ data: { accountId: acc.id, name: c.name, type: c.type, phone: c.phone, note: c.note, regular: !!c.regular } });
  for (const r of d.repairs) {
    const t = await prisma.repairTask.create({
      data: {
        accountId: acc.id, apartmentId: apt[r.aptId].id, title: r.title, description: r.desc || null, type: r.type || 'other', priority: r.priority,
        status: r.status, assigneeId: r.masterId ? users[r.masterId]?.id : null, contractorId: r.contractorId ? contr[r.contractorId]?.id : null,
        assigneeLabel: r.assignee, date: day(r.date), accessMode: r.access?.mode || 'code', accessNote: r.access?.whoName ? `Ключи/встреча: ${r.access.whoName}${r.access.time ? ', ' + r.access.time : ''}` : null,
        timeWindow: r.window || null, costKzt: r.cost || null, paid: !!r.paid, blockDays: r.blockDays || null, doneAt: r.status === 'done' ? day(r.date) : null,
      },
    });
    if (r.quote) {
      await prisma.repairEstimate.create({ data: { accountId: acc.id, repairTaskId: t.id, workKzt: r.quote.work, partsKzt: r.quote.parts, items: r.quote.list, byName: r.quote.by, status: r.quote.status || 'pending', decidedAt: r.quote.status && r.quote.status !== 'pending' ? new Date() : null } });
    }
  }

  // ---------- аккаунт B — второй владелец (для проверки, что аккаунты не видят друг друга) ----------
  const accB = await prisma.account.create({ data: { name: 'Демо Б — Алматы', slug: 'demo-b', plan: 'trial', trialEndsAt: new Date(Date.now() + 14 * DAY_MS) } });
  const ownerB = await prisma.user.create({ data: { name: 'Бауыржан Демо', email: 'owner@demo-b.example', passwordHash } });
  await prisma.membership.create({ data: { userId: ownerB.id, accountId: accB.id, role: 'owner' } });
  await prisma.brand.create({ data: { ...DEFAULT_BRAND, name: 'Almaty Rooms', short: 'AR', accountId: accB.id } });
  await prisma.currencySettings.create({ data: { accountId: accB.id, shown: ['KZT'] } });
  const b1 = await prisma.apartment.create({ data: { accountId: accB.id, title: 'Алматы, Абая 10, кв. 5', address: 'пр. Абая, 10, кв. 5', district: 'Бостандыкский', rooms: '1-комн.', maxGuests: 3, basePriceKzt: 22000, lockCode: '9999' } });
  await prisma.apartment.create({ data: { accountId: accB.id, title: 'Алматы, Достык 50, кв. 12', address: 'пр. Достык, 50, кв. 12', district: 'Медеуский', rooms: '2-комн.', maxGuests: 4, basePriceKzt: 30000 } });
  const gB = await prisma.guest.create({ data: { accountId: accB.id, name: 'Гость Б', phone: '+77000000001' } });
  await prisma.booking.create({ data: { accountId: accB.id, apartmentId: b1.id, guestId: gB.id, number: 1001, token: randomToken(12), source: 'direct', status: 'confirmed', checkIn: day(d.TODAY + 2), checkOut: day(d.TODAY + 4), guestsCount: 2, nightlyKzt: 22000, totalKzt: 44000 } });

  const counts = await Promise.all([prisma.apartment.count(), prisma.apartmentPhoto.count(), prisma.booking.count(), prisma.cleaningTask.count(), prisma.repairTask.count(), prisma.transfer.count()]);
  if (!config.isTest) {
    console.log(`Готово: квартир ${counts[0]}, фото ${counts[1]}, броней ${counts[2]}, уборок ${counts[3]}, ремонтов ${counts[4]}, трансферов ${counts[5]}`);
    console.log(`Вход в админку: azamat@astanastay.example / ${PASSWORD} (владелец), alina@astanastay.example (админ), gulnara@… (клининг), marat@… (мастер)`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
