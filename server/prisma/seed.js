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
  // подрядчики, заявки мастерам, сметы (статусы — как в services/workRequests.js)
  const owner = Object.values(users).find(u => u.email.startsWith(d.STAFF_BASE.find(x => x.role === 'owner').login + '@'));
  const admin = Object.values(users).find(u => u.email.startsWith(d.STAFF_BASE.find(x => x.role === 'admin').login + '@'));
  const contr = {};
  for (const c of d.CONTRACTORS_BASE) contr[c.id] = await prisma.contractor.create({ data: { accountId: acc.id, name: c.name, type: c.type, phone: c.phone, note: c.note, regular: !!c.regular } });
  const ev = (t, type, actor, note, data, when) => prisma.repairEvent.create({ data: { accountId: acc.id, repairTaskId: t.id, type, actorType: actor.type, actorId: actor.id || null, actorName: actor.name, note: note || null, data: data || undefined, createdAt: when || new Date() } });
  const OWNER = { type: 'owner', id: owner.id, name: owner.name }, ADMIN = { type: 'admin', id: admin.id, name: admin.name };
  for (const r of d.repairs) {
    const q = r.quote;
    const status = r.status === 'done' ? 'DONE' : r.status === 'progress' ? 'IN_PROGRESS' : q?.status === 'approved' ? 'APPROVED' : q?.status === 'pending' ? 'AWAITING_OWNER_APPROVAL' : 'NEW';
    const quick = status === 'IN_PROGRESS' && !q;   // «в работе» без сметы — в демо это мелкие работы
    const t = await prisma.repairTask.create({
      data: {
        accountId: acc.id, apartmentId: apt[r.aptId].id, title: r.title, description: r.desc || null, type: r.type || 'other', priority: r.priority,
        status, quickJob: quick, assigneeId: r.masterId ? users[r.masterId]?.id : null, contractorId: r.contractorId ? contr[r.contractorId]?.id : null,
        assigneeLabel: r.assignee, date: day(r.date), accessMode: r.access?.mode || 'code', accessNote: r.access?.whoName ? `Ключи/встреча: ${r.access.whoName}${r.access.time ? ', ' + r.access.time : ''}` : null,
        timeWindow: r.window || null, costKzt: r.cost || null, finalCostKzt: status === 'DONE' ? (r.cost || null) : null, paid: !!r.paid, blockDays: r.blockDays || null,
        doneAt: status === 'DONE' ? day(r.date) : null, arrivedAt: ['IN_PROGRESS', 'DONE'].includes(status) ? day(r.date) : null, startedAt: ['IN_PROGRESS', 'DONE'].includes(status) ? day(r.date) : null,
        linkToken: randomToken(18), createdById: owner.id, occupancy: r.access?.mode === 'presence' ? 'OWNER_PRESENT' : 'UNKNOWN', occupancyUpdatedById: owner.id, occupancyUpdatedAt: day(r.date - 1),
      },
    });
    await ev(t, 'created', OWNER, null, { quickJob: quick }, day(r.date - 1));
    if (q) {
      await prisma.repairEstimate.create({ data: { accountId: acc.id, repairTaskId: t.id, method: 'REMOTE', workKzt: q.work, partsKzt: q.parts, materialsIncluded: q.parts > 0, items: q.list, byName: q.by, status: q.status || 'pending', decidedAt: q.status && q.status !== 'pending' ? new Date() : null, decidedById: q.status && q.status !== 'pending' ? owner.id : null } });
      await ev(t, 'estimate_submitted', { type: 'master', name: q.by }, null, { method: 'REMOTE', totalKzt: q.work + q.parts });
      if (q.status === 'approved') await ev(t, 'approved', OWNER, null, { totalKzt: q.work + q.parts });
    }
    if (['IN_PROGRESS', 'DONE'].includes(status)) await ev(t, 'started', { type: 'master', name: r.assignee }, null, quick ? { quickJob: true } : null, day(r.date));
    if (status === 'DONE') await ev(t, 'completed', { type: 'master', name: r.assignee }, null, { finalCostKzt: r.cost || 0 }, day(r.date));
  }

  // ---------- Master Electric — внешний электрик с входом в приложение команды; по одной заявке в каждом статусе ----------
  const meUser = await prisma.user.create({ data: { name: 'Master Electric', email: 'electric@astanastay.example', phone: '+77000000101', passwordHash, locale: 'ru' } });
  await prisma.membership.create({ data: { userId: meUser.id, accountId: acc.id, role: 'master' } });
  const me = await prisma.contractor.create({ data: { accountId: acc.id, name: 'Master Electric', type: 'elec', phone: '+7 700 000 01 01', note: 'электрика: розетки, автоматы, свет (демо-контакт)', regular: true, userId: meUser.id } });
  const ME = { type: 'master', id: meUser.id, name: 'Master Electric' };
  const hv = Object.values(apt).filter(a => a.complex === 'ЖК Хайвил');
  const problemSvg = (title, hue) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="hsl(${hue},18%,86%)"/>
<rect x="330" y="170" width="240" height="240" rx="28" fill="#fff" stroke="#9aa3ad" stroke-width="6"/><circle cx="410" cy="290" r="18" fill="#3b4048"/><circle cx="490" cy="290" r="18" fill="#3b4048"/>
<path d="M560 180c40 10 70 40 80 80" stroke="#3b4048" stroke-width="8" fill="none" opacity=".5"/><circle cx="560" cy="200" r="46" fill="#2b2b2b" opacity=".35"/>
<text x="40" y="550" font-family="Inter,Arial,sans-serif" font-size="40" font-weight="700" fill="#2c3038">${title}</text><text x="40" y="585" font-family="Inter,Arial,sans-serif" font-size="22" fill="#4b5563">демо-фото проблемы</text></svg>`);
  const ago = (h) => new Date(Date.now() - h * 3600000);
  const meTasks = [
    { status: 'NEW', title: 'Не работает розетка на кухне', desc: 'Розетка у холодильника не даёт питание, автомат не выбивает.', occ: 'UNKNOWN', photos: 0 },
    { status: 'VISIT_INSPECTION', title: 'Мигает свет в спальне', desc: 'Люстра мигает при включении, иногда гаснет.', occ: 'OWNER_PRESENT', visit: true, arrived: true },
    { status: 'AWAITING_OWNER_APPROVAL', title: 'Розетка обгорела у кровати', desc: 'Следы гари на розетке, запах пластика. Фото приложены.', occ: 'EMPTY', instr: 'Ключи у консьержа в лобби блока G-1, скажите «к Азамату». Консьерж с 9:00 до 21:00.', photos: 2,
      est: { method: 'PHOTOS', workKzt: 8000, partsKzt: 3500, materialsIncluded: true, maxKzt: 15000, items: 'Розетка Schneider, подрозетник', comment: 'По фото: менять розетку и подрозетник; если проводка обгорела — дороже.' } },
    { status: 'REJECTED', title: 'Перенести выключатель в прихожей', desc: 'Выключатель за дверью — перенести на 40 см.', occ: 'UNKNOWN',
      est: { method: 'REMOTE', workKzt: 25000, partsKzt: 0, materialsIncluded: false, comment: 'Штробление, кабель, шпаклёвка — материалы отдельно.', status: 'rejected', reject: 'Дорого, без штробления — накладным кабель-каналом' } },
    { status: 'APPROVED', title: 'Установить 3 точечных светильника в ванной', desc: 'Влагозащищённые светильники, белые.', occ: 'EMPTY', instr: 'Код подъезда сообщит админ по телефону в день работ.',
      est: { method: 'REMOTE', workKzt: 12000, partsKzt: 9000, materialsIncluded: true, items: '3 светильника IP44, кабель', status: 'approved' } },
    { status: 'IN_PROGRESS', title: 'Заменить автомат в щитке', desc: 'Автомат на кухонную линию выбивает при включении чайника.', occ: 'OWNER_PRESENT', visit: true, arrived: true,
      est: { method: 'VISIT', workKzt: 7000, partsKzt: 4500, materialsIncluded: true, items: 'Автомат 16А ABB', status: 'approved' },
      extras: [{ amountKzt: 6000, description: 'Замена подгоревшей шины в щитке', reason: 'Обнаружена при вскрытии щитка — не было видно при осмотре', status: 'APPROVED' },
        { amountKzt: 3500, description: 'Клеммы WAGO, 10 шт.', reason: 'Старые скрутки на линии — менять обязательно по технике безопасности', status: 'PENDING' }] },
    { status: 'DONE', quick: true, title: 'Заменить перегоревшую лампочку в коридоре', desc: 'Цоколь E27, тёплый свет.', occ: 'EMPTY', instr: 'Ключ в почтовом ящике №45, код ящика скажет админ.', arrived: true, final: 2500, report: 'Заменил лампу E27 3000K, проверил выключатель.' },
    { status: 'CANCELLED', title: 'Подключить варочную панель', desc: 'Нужна отдельная линия 32А.', occ: 'UNKNOWN', cancel: 'Хозяин решил подключать через застройщика' },
  ];
  for (const [i, x] of meTasks.entries()) {
    const a = hv[i % hv.length] || Object.values(apt)[i];
    // у каждой заявки своя последовательная «лента времени»: каждый следующий шаг — на 50 минут позже
    let clock = ago(30 + i * 4); const next = () => (clock = new Date(clock.getTime() + 50 * 60000));
    const t0 = clock;
    const T = {}; for (const k of ['occ', 'visit', 'arrived', 'inspected', 'est', 'decided', 'started', 'extra', 'extraOk', 'done', 'cancel']) T[k] = next();
    const t = await prisma.repairTask.create({
      data: {
        accountId: acc.id, apartmentId: a.id, title: x.title, description: x.desc, type: 'elec', priority: i === 2 ? 'high' : 'medium', status: x.status, quickJob: !!x.quick,
        contractorId: me.id, date: day(d.TODAY + (i % 3)), linkToken: randomToken(18), createdById: owner.id,
        occupancy: x.occ, accessInstructions: x.instr || null, occupancyUpdatedById: i % 2 ? admin.id : owner.id, occupancyUpdatedAt: T.occ,
        visitRequestedAt: x.visit ? T.visit : null, arrivedAt: x.arrived ? T.arrived : null, inspectionNotes: x.visit ? 'Проверил щиток и линию, причина найдена.' : null,
        startedAt: ['IN_PROGRESS', 'DONE'].includes(x.status) ? T.started : null, finalCostKzt: x.final ?? null, report: x.report || null,
        doneAt: x.status === 'DONE' ? T.done : null, cancelReason: x.cancel || null,
      },
    });
    await ev(t, 'created', OWNER, null, { quickJob: !!x.quick }, t0);
    await ev(t, 'occupancy_changed', i % 2 ? ADMIN : OWNER, null, { from: 'UNKNOWN', to: x.occ, instructions: !!x.instr }, T.occ);
    for (let k = 0; k < (x.photos || 0); k++) {
      const saved = await storage.save(`${acc.id}/repairs/${t.id}/problem-${k + 1}.svg`, problemSvg(k ? 'Розетка крупно' : 'Розетка у кровати', 20 + k * 30), 'image/svg+xml');
      await prisma.repairPhoto.create({ data: { accountId: acc.id, repairTaskId: t.id, kind: 'problem', url: saved.url, storageKey: saved.key, caption: k ? 'Крупно' : 'Общий вид', uploadedBy: 'owner', mimeType: 'image/svg+xml', createdAt: t0 } });
    }
    if (x.visit) await ev(t, 'visit_requested', ME, 'По описанию не понять — нужно посмотреть на месте', null, T.visit);
    if (x.arrived) await ev(t, 'arrived', ME, null, null, T.arrived);
    if (x.visit) await ev(t, 'inspected', ME, 'Проверил щиток и линию, причина найдена.', null, T.inspected);
    if (x.est) {
      const e = await prisma.repairEstimate.create({ data: { accountId: acc.id, repairTaskId: t.id, method: x.est.method, workKzt: x.est.workKzt, partsKzt: x.est.partsKzt, materialsIncluded: x.est.materialsIncluded, maxKzt: x.est.maxKzt ?? null, items: x.est.items || null, comment: x.est.comment || null, byName: 'Master Electric', byUserId: meUser.id, status: x.est.status || 'pending', rejectReason: x.est.reject || null, decidedAt: x.est.status ? T.decided : null, decidedById: x.est.status ? owner.id : null, createdAt: T.est } });
      await ev(t, 'estimate_submitted', ME, x.est.comment, { estimateId: e.id, method: x.est.method, totalKzt: x.est.workKzt + x.est.partsKzt, maxKzt: x.est.maxKzt ?? null, materialsIncluded: x.est.materialsIncluded }, T.est);
      if (x.est.status) await ev(t, x.est.status === 'approved' ? 'approved' : 'rejected', OWNER, x.est.reject, { estimateId: e.id, totalKzt: x.est.workKzt + x.est.partsKzt }, T.decided);
    }
    if (['IN_PROGRESS', 'DONE'].includes(x.status)) await ev(t, 'started', ME, null, x.quick ? { quickJob: true } : null, T.started);
    for (const xe of x.extras || []) {
      const e = await prisma.extraExpense.create({ data: { accountId: acc.id, repairTaskId: t.id, amountKzt: xe.amountKzt, description: xe.description, reason: xe.reason, status: xe.status, byName: 'Master Electric', byUserId: meUser.id, decidedAt: xe.status !== 'PENDING' ? T.extraOk : null, decidedById: xe.status !== 'PENDING' ? owner.id : null, createdAt: T.extra } });
      await ev(t, 'extra_submitted', ME, xe.description, { extraId: e.id, amountKzt: xe.amountKzt, reason: xe.reason }, T.extra);
      if (xe.status === 'APPROVED') await ev(t, 'extra_approved', OWNER, null, { extraId: e.id, amountKzt: xe.amountKzt }, T.extraOk);
    }
    if (x.status === 'DONE') await ev(t, 'completed', ME, x.report, { finalCostKzt: x.final }, T.done);
    if (x.status === 'CANCELLED') await ev(t, 'cancelled', OWNER, x.cancel, null, T.cancel);
    // сумма для финансов: итог/одобренная смета + одобренные доп. расходы
    const base = x.final ?? (x.est?.status === 'approved' ? x.est.workKzt + x.est.partsKzt : null);
    const extrasOk = (x.extras || []).filter(e => e.status === 'APPROVED').reduce((s2, e) => s2 + e.amountKzt, 0);
    if (base != null || extrasOk) await prisma.repairTask.update({ where: { id: t.id }, data: { costKzt: (base || 0) + extrasOk } });
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
    console.log(`Готово: квартир ${counts[0]}, фото ${counts[1]}, броней ${counts[2]}, уборок ${counts[3]}, заявок мастерам ${counts[4]}, трансферов ${counts[5]}`);
    console.log(`Вход в админку: azamat@astanastay.example / ${PASSWORD} (владелец), alina@astanastay.example (админ), gulnara@… (клининг), marat@… (мастер), electric@… (подрядчик Master Electric)`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
