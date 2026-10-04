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
import { DEFAULT_CHECKLIST } from '../src/services/cleaning.js';
import { cleaningRate } from '../src/services/performerPayouts.js';
import crypto from 'node:crypto';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const BUILDING = fs.readFileSync(path.join(ASSETS, 'photos', 'highvill-g1-1200.jpg')); // фото дома (ЖК Хайвил, блок G-1)

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD || 'demo12345';
const DEMO_SLUGS = ['astana-stay', 'demo-b'];
const ROLE = { owner: 'owner', admin: 'admin', cleaner: 'cleaning', master: 'master', driver: 'driver' };
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
        // у первой квартиры — свой доп. пункт подготовки (с обязательным фото)
        cleaningExtraItems: a.id === d.apartments[0].id ? [{ label: 'Балкон: закрыть окна', photo: true }] : undefined,
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

  // брони (+ гости). Модель (ПЛАН.md, проход 2–3): обычная бронь существует только оплаченной на нашем сайте;
  // особая — только по личной разовой ссылке от владельца/админа (наличные при заезде или залог). Неоплаченных «подтвердите» нет.
  const bk = {};
  const payTerms = (src, payment, ci) => {
    if (src === 'airbnb') return { source: 'airbnb', paymentMethod: 'card', paymentStatus: 'paid' };
    if (src === 'site' || src === 'booking') return { source: 'site', paymentMethod: 'card', paymentStatus: 'paid' };
    // telegram / whatsapp / direct → личная ссылка: залог внесён или наличные при заезде (прошлые и текущие — уже оплачены)
    if (payment === 'prepaid') return { source: 'link', paymentMethod: 'deposit', paymentStatus: ci < d.TODAY ? 'paid' : 'prepaid' };
    return { source: 'link', paymentMethod: 'cash_on_arrival', paymentStatus: payment === 'paid' || ci < d.TODAY ? 'paid' : 'unpaid' };
  };
  for (const b of d.bookings) {
    const g = await prisma.guest.create({ data: { accountId: acc.id, name: b.guest, phone: b.phone.replace(/\s/g, '') } });
    bk[b.id] = await prisma.booking.create({
      data: {
        accountId: acc.id, apartmentId: apt[b.aptId].id, guestId: g.id, number: b.id, token: randomToken(12), ...payTerms(b.source, b.payment, b.ci),
        status: b.co <= d.TODAY ? 'completed' : 'confirmed', checkIn: day(b.ci), checkOut: day(b.co), checkInTime: b.checkinTime, checkOutTime: b.checkoutTime,
        guestsCount: b.guests, nightlyKzt: b.nightly, totalKzt: b.total, note: b.note, cleanerName: b.cleaner, confirmedAt: day(b.ci - 7),
      },
    });
  }
  // переписка из каналов (прототип): вопросы без брони в систему не попадают; брони — только подтверждённые.
  // Эмма Мюллер — бронь по личной ссылке (наличные при заезде) с просьбой о раннем заезде; Ли Вэй — оплачено на сайте, с трансфером.
  let num = Math.max(...d.bookings.map(b => b.id));
  const freeApt = async (pref, ci, co) => {
    const busy = async (a) => !!(await prisma.booking.findFirst({ where: { apartmentId: a.id, status: { in: ['request', 'confirmed', 'completed'] }, checkIn: { lt: day(co) }, checkOut: { gt: day(ci) } } }));
    if (pref && !(await busy(pref))) return pref;
    for (const a of Object.values(apt)) if (!(await busy(a))) return a;
    return null;
  };
  const special = {};
  for (const r of d.requests) {
    const emma = r.name === 'Эмма Мюллер', liwei = r.name === 'Ли Вэй';
    if (r.status !== 'confirmed' && !emma && !liwei) continue;
    const ci = emma ? d.TODAY + 1 : r.ci, co = emma ? d.TODAY + 3 : r.co;   // Эмма — завтра, чтобы просьба была видна в «Сегодня»
    const a = await freeApt(apt[r.aptId], ci, co); if (!a) continue;
    const g = await prisma.guest.create({ data: { accountId: acc.id, name: r.name, phone: '+7701555' + String(1000 + r.id * 37).slice(-4) } });
    const terms = emma ? { source: 'link', paymentMethod: 'cash_on_arrival', paymentStatus: 'unpaid' } : payTerms(r.channel === 'telegram' || r.channel === 'whatsapp' ? r.channel : 'site', r.channel === 'telegram' ? 'prepaid' : 'paid', ci);
    special[r.name] = await prisma.booking.create({
      data: {
        accountId: acc.id, apartmentId: a.id, guestId: g.id, number: ++num, token: randomToken(12), ...terms,
        status: 'confirmed', confirmedAt: day(d.TODAY - 1), checkIn: day(ci), checkOut: day(co), guestsCount: r.guests,
        nightlyKzt: a.basePriceKzt, totalKzt: a.basePriceKzt * (co - ci), note: r.text,
        ...(emma ? { earlyCheckIn: '10:00', earlyCheckInStatus: 'requested' } : {}),
      },
      include: { guest: true, apartment: true },
    });
  }
  // ---------- водители и трансферы «как в Uber» (статусы — src/services/transferJobs.js) ----------
  // владелец и админ — в списке водителей; три нанятых водителя (роль driver). Внешних водителей (таксопарк) нет — возят только свои.
  // Машина: мест для пассажиров и багажа — заказ предлагается только тем, у кого всё помещается.
  await prisma.membership.updateMany({ where: { accountId: acc.id, role: { in: ['owner', 'admin'] } }, data: { canDrive: true } });
  await prisma.membership.updateMany({ where: { accountId: acc.id, role: 'owner' }, data: { vehicle: 'Toyota Land Cruiser Prado, белый, 001 AZN 01', vehicleSeats: 6, vehicleBags: 5, vehicleClass: 'minivan' } });
  // настройки владельца: оплата подготовки (по размеру квартиры) и напоминание о невыплаченном через 3 часа
  const settings = await prisma.accountSettings.create({ data: { accountId: acc.id, cleaningRateKzt: 5000, cleaningRates: { 'Студия': 4000, '1-комн.': 5000, '2-комн.': 6000, '3-комн.': 7000 }, payoutReminderHours: 3 } });
  const DRIVERS = [
    { login: 'ruslan', name: 'Руслан Тлеубаев', phone: '+77003000001', vehicle: 'Hyundai Sonata, белая, 777 AAA 01' },
    { login: 'bauyrzhan', name: 'Бауыржан Сеитов', phone: '+77003000002', vehicle: 'Toyota Camry, чёрная, 505 KZT 01' },
    { login: 'kanat', name: 'Канат Ермеков', phone: '+77003000003', vehicle: 'Hyundai Staria, серая, 123 ABK 01', seats: 7, bags: 7, cls: 'minivan' },
  ];
  const drv = {};
  for (const x of DRIVERS) {
    const u = await prisma.user.create({ data: { name: x.name, email: `${x.login}@astanastay.example`, phone: x.phone, passwordHash, locale: 'ru' } });
    await prisma.membership.create({ data: { userId: u.id, accountId: acc.id, role: 'driver', canDrive: true, vehicle: x.vehicle, vehicleSeats: x.seats || 4, vehicleBags: x.bags || 3, vehicleClass: x.cls || 'sedan' } });
    drv[x.name.split(' ')[0]] = { ...u, vehicle: x.vehicle };
  }
  const ownerUser = Object.values(users).find(u => u.email.startsWith('azamat@'));
  const SYS = { type: 'system' };
  const nowMs = Date.now();
  // «ЧЧ:ММ» по Астане через m минут (в пределах сегодняшнего дня)
  const hmIn = (m) => { const t = new Date(nowMs + m * 60000 + 5 * 3600000); const mins = Math.min(Math.max(t.getUTCHours() * 60 + t.getUTCMinutes(), 5), 23 * 60 + 55); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; };
  const minutes = (m) => new Date(nowMs + m * 60000);
  async function seedJob(tr, x) {
    const pickupAt = at(Math.round(tr.date / DAY_MS) - offset, tr.time);
    const driver = x.driver === 'owner' ? { ...ownerUser, vehicle: 'Toyota Land Cruiser Prado, белый, 001 AZN 01' } : x.driver ? drv[x.driver] : null;
    // везёт сам владелец — выплаты нет, вся цена бизнесу (настройка «Везёт сам владелец» включена по умолчанию)
    const byOwner = x.driver === 'owner';
    const payoutKzt = byOwner ? 0 : tr.priceKzt, paid = !byOwner && !!x.paid;
    const job = await prisma.transferJob.create({
      data: {
        accountId: acc.id, transferId: tr.id, bookingId: tr.bookingId, apartmentId: tr.apartmentId, status: x.status, pickupAt,
        freeWaitMin: tr.direction === 'out' ? 15 : (tr.place === 'station' ? 30 : 60), payoutKzt, commissionKzt: tr.priceKzt - payoutKzt, payoutRule: byOwner ? 'owner' : 'account', notes: x.notes || null,
        meetingPoint: tr.direction === 'in' && tr.place === 'airport' ? 'Зал прилёта, у выхода из зоны выдачи багажа, с табличкой' : null,
        driverUserId: driver?.id || null, driverName: driver?.name || null, vehicle: driver?.vehicle || null,
        offeredAt: x.offeredAt, escalatedAt: x.escalatedAt || null, acceptedAt: x.acceptedAt || null, enRouteAt: x.enRouteAt || null, etaAt: x.etaAt || null,
        arrivedAt: x.arrivedAt || null, pickedUpAt: x.pickedUpAt || null, doneAt: x.doneAt || null, cancelledAt: x.cancelledAt || null, cancelReason: x.cancelReason || null,
        paid, paidAt: paid ? x.doneAt : null,
      },
    });
    // долг водителю — только за выполненную поездку и только если выплата > 0
    if (x.status === 'DONE' && payoutKzt > 0) {
      const when = new Intl.DateTimeFormat('ru-RU', { timeZone: acc.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(pickupAt);
      await prisma.payout.create({ data: { accountId: acc.id, kind: 'transfer', jobId: job.id, userId: job.driverUserId, name: job.driverName, title: `Трансфер ${when}`, amountKzt: payoutKzt, createdAt: x.doneAt,
        status: paid ? 'PAID' : 'PENDING', method: paid ? 'cash' : null, paidAt: paid ? new Date(x.doneAt.getTime() + 3600000) : null, paidById: paid ? ownerUser.id : null, paidByName: paid ? ownerUser.name : null } });
    }
    // оплата гостя бизнесу: часть выполненных поездок оплачена (наличными водителю → в кассу, картой/переводом)
    if (x.guestPaid) await prisma.transfer.update({ where: { id: tr.id }, data: { guestPaymentStatus: 'PAID', guestPaymentMethod: x.guestPaid, paid: true, guestPaidAt: x.doneAt || x.offeredAt, guestPaidById: ownerUser.id, guestPaidByName: ownerUser.name } });
    const TR_ST = { OFFERED: 'planned', UNASSIGNED: 'planned', DONE: 'done', CANCELLED: 'cancelled' };
    await prisma.transfer.update({ where: { id: tr.id }, data: { status: TR_ST[x.status] || 'driver', driverName: job.driverName } });
    const D = driver ? { type: x.driver === 'owner' ? 'owner' : 'driver', id: driver.id, name: driver.name } : null;
    const OWN = { type: 'owner', id: ownerUser.id, name: ownerUser.name };
    const evs = [['offered', SYS, x.offeredAt, null, { round: 1 }]];
    if (x.escalatedAt) evs.push(['escalated', SYS, x.escalatedAt, x.escalateNote || 'никто не взял за 30 мин']);
    if (x.acceptedAt) evs.push(x.ext || x.assigned ? ['assigned', OWN, x.acceptedAt, null, { driver: job.driverName }] : ['accepted', D, x.acceptedAt]);
    if (x.enRouteAt) evs.push(['en_route', D, x.enRouteAt, null, x.etaAt ? { etaMinutes: Math.round((x.etaAt - x.enRouteAt) / 60000) } : null]);
    if (x.arrivedAt) evs.push(['arrived', D, x.arrivedAt]);
    if (x.pickedUpAt) evs.push(['picked_up', D, x.pickedUpAt]);
    if (x.doneAt) evs.push(['done', D, x.doneAt]);
    if (x.guestPaid) evs.push(['guest_paid', OWN, new Date((x.doneAt || x.offeredAt).getTime() + 1800000), null, { method: x.guestPaid, amountKzt: tr.priceKzt }]);
    if (paid) evs.push(['paid', OWN, new Date(x.doneAt.getTime() + 3600000), null, { payoutKzt: tr.priceKzt }]);
    if (x.cancelledAt) evs.push(['cancelled', OWN, x.cancelledAt, x.cancelReason]);
    for (const [type, actor, createdAt, note, data] of evs) {
      await prisma.transferEvent.create({ data: { accountId: acc.id, jobId: job.id, type, actorType: actor?.type || 'system', actorId: actor?.id || null, actorName: actor?.name || null, note: note || null, data: data || undefined, createdAt } });
    }
    return job;
  }
  const mkTransfer = (bkRec, aptRec, guestName, x) => prisma.transfer.create({
    data: {
      accountId: acc.id, bookingId: bkRec?.id, guestId: bkRec?.guestId, apartmentId: aptRec?.id, direction: x.dir, place: x.place || 'airport', date: x.date, time: x.time,
      flight: x.flight || null, pax: x.pax || 2, bags: x.bags ?? 2, childSeats: x.childSeats || 0, priceKzt: x.price || 8000, status: 'requested',
      guestName, sign: guestName, guestPhone: x.phone || null,
    },
  });
  const guestPhone = (b) => b.phone.replace(/\s/g, '');
  // трансферы из прототипа: прошлые — выполнены; будущие — водитель взял или ищем водителя
  let k = 0, cancelledOne = false, extOne = false, ownerOne = false;
  for (const t of d.transfers) {
    const b = d.bookings.find(x => x.id === t.bookingId);
    const tr = await mkTransfer(bk[t.bookingId], apt[b.aptId], b.guest, { dir: t.dir, date: day(t.date), time: t.time, flight: t.flight, pax: t.pax, price: t.price, phone: guestPhone(b), bags: Math.min(t.pax, 3), childSeats: t.pax >= 4 ? 1 : 0 });
    const name = (t.driver || '').split(' · ')[0];
    const pickup = at(t.date, t.time);
    const base = { offeredAt: new Date(pickup.getTime() - 3 * DAY_MS) };
    k++;
    if (pickup.getTime() < nowMs - 2 * 3600000) {
      await seedJob(tr, { ...base, status: 'DONE', driver: k === 3 ? 'owner' : drv[name] ? name : 'Руслан', guestPaid: k % 3 === 0 ? null : (k % 3 === 1 ? 'cash' : 'card'), acceptedAt: new Date(base.offeredAt.getTime() + 7 * 60000), enRouteAt: new Date(pickup.getTime() - 50 * 60000), arrivedAt: new Date(pickup.getTime() - 5 * 60000), pickedUpAt: new Date(pickup.getTime() + 25 * 60000), doneAt: new Date(pickup.getTime() + 70 * 60000), paid: k % 2 === 0 });
    } else if (t.status === 'planned' && !cancelledOne && t.date - d.TODAY > 3) {
      cancelledOne = true;
      await seedJob(tr, { ...base, offeredAt: minutes(-26 * 60), status: 'CANCELLED', cancelledAt: minutes(-20 * 60), cancelReason: 'Гость поедет сам — передумал' });
    } else if (t.status === 'planned') {
      await seedJob(tr, { status: 'OFFERED', offeredAt: minutes(-5 - (k % 10)) });
    } else if (!extOne && t.date - d.TODAY > 1) {
      extOne = true;
      await seedJob(tr, { status: 'ACCEPTED', driver: 'Бауыржан', assigned: true, offeredAt: minutes(-30 * 60), escalatedAt: minutes(-29.5 * 60), acceptedAt: minutes(-29 * 60) });
    } else if (!ownerOne && t.date - d.TODAY > 1) {
      ownerOne = true;
      await seedJob(tr, { status: 'ACCEPTED', driver: 'owner', offeredAt: minutes(-10 * 60), acceptedAt: minutes(-9.8 * 60) });
    } else {
      await seedJob(tr, { status: 'ACCEPTED', driver: drv[name] ? name : 'Канат', offeredAt: minutes(-48 * 60 + k * 20), acceptedAt: minutes(-48 * 60 + k * 20 + 4) });
    }
  }
  // сегодняшние заезды — водитель в пути, на месте, гость в машине; один заказ никто не взял (эскалация)
  const todayIn0 = (id) => d.bookings.find(x => x.id === id && x.ci === d.TODAY);
  const live = [
    [1179, { status: 'PICKED_UP', driver: 'Руслан', time: hmIn(-40), flight: 'KC 852' }],
    [1328, { status: 'ARRIVED', driver: 'Бауыржан', time: hmIn(10), flight: 'DV 728' }],
    [1363, { status: 'EN_ROUTE', driver: 'Канат', time: hmIn(55), flight: 'FS 7023', place: 'station' }],
    [1065, { status: 'UNASSIGNED', time: hmIn(150), flight: 'IQ 3311', childSeats: 1 }],
  ];
  for (const [id, x] of live) {
    const b = todayIn0(id); if (!b) continue;
    const tr = await mkTransfer(bk[id], apt[b.aptId], b.guest, { dir: 'in', place: x.place || 'airport', date: day(d.TODAY), time: x.time, flight: x.place === 'station' ? null : x.flight, pax: b.guests, bags: Math.min(b.guests, 3), childSeats: x.childSeats || 0, price: x.place === 'station' ? 6000 : 8000, phone: guestPhone(b) });
    const pickup = at(d.TODAY, x.time);
    const j = { status: x.status, driver: x.driver, offeredAt: minutes(-20 * 60), notes: x.childSeats ? 'Детское кресло (ребёнок 3 года)' : null };
    if (x.status === 'UNASSIGNED') Object.assign(j, { offeredAt: minutes(-90), escalatedAt: minutes(-60), escalateNote: 'никто не взял за 30 мин' });
    else j.acceptedAt = minutes(-19 * 60);
    if (['EN_ROUTE', 'ARRIVED', 'PICKED_UP'].includes(x.status)) { j.enRouteAt = new Date(Math.min(pickup.getTime() - 45 * 60000, nowMs - 5 * 60000)); j.etaAt = new Date(pickup.getTime() - 10 * 60000); }
    if (['ARRIVED', 'PICKED_UP'].includes(x.status)) j.arrivedAt = new Date(Math.min(pickup.getTime() - 8 * 60000, nowMs - 2 * 60000));
    if (x.status === 'PICKED_UP') j.pickedUpAt = new Date(Math.min(pickup.getTime() + 20 * 60000, nowMs - 60000));
    await seedJob(tr, j);
  }
  // оплаченная на сайте бронь с трансфером: заказ водителям ушёл заранее (бронь подтверждена оплатой)
  const lw = special['Ли Вэй'];
  if (lw) {
    const tr = await mkTransfer(lw, lw.apartment, lw.guest.name, { dir: 'in', date: lw.checkIn, time: '23:40', flight: 'KC 921', pax: lw.guestsCount, price: 9500, phone: lw.guest.phone });
    await seedJob(tr, { status: 'OFFERED', offeredAt: minutes(-12) });
  }
  // подготовка квартир (уборки): чек-лист по стандартному шаблону; за готовые — выплата специалисту (прошлые — выплачены, сегодняшние — к оплате)
  const cleaningsDone = [];
  for (const c of d.cleanings) {
    const started = ['progress', 'done'].includes(c.status) ? new Date(Math.min(at(c.date, c.from).getTime(), nowMs - 40 * 60000)) : null;
    const doneAt = c.doneAt ? new Date(Math.min(at(c.date, c.doneAt).getTime(), nowMs - 10 * 60000)) : null;
    const t = await prisma.cleaningTask.create({
      data: {
        accountId: acc.id, apartmentId: apt[c.aptId].id, bookingId: bk[c.bookingId]?.id, assigneeId: users[c.cleaner]?.id, date: day(c.date),
        fromTime: c.from, toTime: c.to, status: c.status, startedAt: started && doneAt && started > doneAt ? new Date(doneAt.getTime() - 75 * 60000) : started, doneAt,
        checklist: c.status === 'assigned' || c.status === 'enroute' ? null : DEFAULT_CHECKLIST.map((x, k) => ({ ...x, done: !!c.checked[k], doneAt: c.checked[k] ? (doneAt || started).toISOString() : null })),
      },
    });
    if (c.status === 'done' && t.assigneeId) cleaningsDone.push({ t, c, apt: apt[c.aptId] });
  }
  // Эмма: подготовка к её заезду (если в этот день нет выезда с уборкой) — срок подготовки = время заезда, сдвинется при раннем заезде
  const em = special['Эмма Мюллер'];
  if (em && !(await prisma.cleaningTask.findFirst({ where: { apartmentId: em.apartmentId, date: em.checkIn } }))) {
    await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: em.apartmentId, date: em.checkIn, fromTime: '09:00', toTime: '14:00', status: 'assigned', assigneeId: Object.values(users).find(u => u.name.startsWith('Айгерим'))?.id || null } });
  }
  let overdueOne = false;
  for (const { t, c, apt: a } of cleaningsDone) {
    const past = c.date < d.TODAY, amount = cleaningRate(a, settings);
    const created = !past && !overdueOne ? new Date(nowMs - 4 * 3600000) : t.doneAt;   // одна сегодняшняя — не выплачена больше 3 ч (красным)
    if (!past) overdueOne = true;
    await prisma.payout.create({ data: { accountId: acc.id, kind: 'cleaning', cleaningTaskId: t.id, userId: t.assigneeId, name: c.cleaner, title: `Подготовка ${a.code ? 'кв. ' + a.code : a.title}`, amountKzt: amount,
      status: past ? 'PAID' : 'PENDING', method: past ? 'cash' : null, paidAt: past ? new Date(t.doneAt.getTime() + 2 * 3600000) : null, paidById: past ? ownerUser.id : null, paidByName: past ? ownerUser.name : null, createdAt: created } });
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
  // одна готовая подготовка — с фото и найденной проблемой (владелец сделает из неё заявку мастеру)
  const withProblem = cleaningsDone.find(x => x.c.date === d.TODAY) || cleaningsDone.at(-1);
  if (withProblem) {
    const { t } = withProblem;
    const s1 = await storage.save(`${acc.id}/cleaning/${t.id}/bath.svg`, problemSvg('Ванная — готово', 200), 'image/svg+xml');
    await prisma.cleaningPhoto.create({ data: { accountId: acc.id, cleaningTaskId: t.id, kind: 'item', itemIndex: 2, url: s1.url, storageKey: s1.key, mimeType: 'image/svg+xml' } });
    const s2 = await storage.save(`${acc.id}/cleaning/${t.id}/problem.svg`, problemSvg('Подтекает смеситель', 10), 'image/svg+xml');
    const ph2 = await prisma.cleaningPhoto.create({ data: { accountId: acc.id, cleaningTaskId: t.id, kind: 'problem', url: s2.url, storageKey: s2.key, mimeType: 'image/svg+xml' } });
    await prisma.cleaningTask.update({ where: { id: t.id }, data: { report: 'Всё готово. Гости оставили зарядку — положила в шкаф.' } });
    // недочёт «можно позже» — не мешает заезду, но висит, пока не решат
    await prisma.defect.create({ data: { accountId: acc.id, apartmentId: t.apartmentId, cleaningTaskId: t.id, text: 'Подтекает смеситель на кухне', priority: 'later', photoIds: [ph2.id], reportedById: t.assigneeId, reportedByName: withProblem.c.cleaner, createdAt: t.doneAt } });
  }
  // срочный недочёт на идущей подготовке перед сегодняшним заездом — квартира «не готова», это первым в «Сегодня»
  const urgentPrep = await prisma.cleaningTask.findFirst({ where: { accountId: acc.id, date: day(d.TODAY), status: 'progress' }, include: { apartment: true, assignee: true }, orderBy: { fromTime: 'asc' } });
  if (urgentPrep) {
    await prisma.defect.create({ data: { accountId: acc.id, apartmentId: urgentPrep.apartmentId, cleaningTaskId: urgentPrep.id, text: 'Мигает лампа в коридоре, плафон тёплый', priority: 'urgent', photoIds: [], reportedById: urgentPrep.assigneeId, reportedByName: urgentPrep.assignee?.name || null, createdAt: ago(0.5) } });
    await prisma.defect.create({ data: { accountId: acc.id, apartmentId: urgentPrep.apartmentId, cleaningTaskId: urgentPrep.id, text: 'Закончились мусорные пакеты', priority: 'later', photoIds: [], reportedById: urgentPrep.assigneeId, reportedByName: urgentPrep.assignee?.name || null, createdAt: ago(0.4) } });
  }
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

  // Pass 4: ясные начальные состояния, без основного deposit-flow.
  // Даты относительно дня установки; 72 ч удержания не истекут при переходе на следующий день.
  const demoLink = async (n, name, { waiting = false, confirmed = false } = {}) => {
    const ci = d.TODAY + n, co = ci + 2;
    const a = await freeApt(apt[1], ci, co);
    if (!a) throw new Error('Демо Pass 4: нет свободной квартиры');
    const g = await prisma.guest.create({ data: { accountId: acc.id, name, phone: '+77015556677' } });
    const b = await prisma.booking.create({ data: {
      accountId: acc.id, apartmentId: a.id, guestId: g.id, number: ++num, token: randomToken(12),
      source: 'link', status: confirmed ? 'confirmed' : 'request', paymentMethod: 'cash_on_arrival', paymentStatus: 'unpaid',
      checkIn: day(ci), checkOut: day(co), guestsCount: 2, nightlyKzt: a.basePriceKzt, totalKzt: a.basePriceKzt * 2,
      holdUntil: confirmed ? null : new Date(nowMs + 72 * 3600000), confirmedAt: confirmed ? new Date(nowMs) : null,
    } });
    const extraCheckRequired = waiting;
    // Токен выдаётся только при создании/rotate в UI; seed не хранит открытый секрет.
    await prisma.bookingLink.create({ data: {
      accountId: acc.id, bookingId: b.id, tokenHash: crypto.createHash('sha256').update(randomToken(32)).digest('hex'),
      status: confirmed ? 'completed' : 'active', terms: 'cash_on_arrival', extraCheckRequired,
      extraCheckNote: waiting ? 'Свяжитесь с владельцем для дополнительного подтверждения' : null,
      note: 'Договорились о наличных при заезде', createdById: owner.id, createdByName: owner.name,
      ...(waiting || confirmed ? { guestStartedAt: new Date(nowMs), submittedAt: new Date(nowMs), termsAcceptedAt: new Date(nowMs),
        termsHash: crypto.createHash('sha256').update([b.checkIn.toISOString().slice(0,10), b.checkOut.toISOString().slice(0,10), b.totalKzt, 'cash_on_arrival', ''].join('|')).digest('hex') } : {}),
      ...(confirmed ? { completedAt: new Date(nowMs) } : {}),
    } });
    return b;
  };
  await demoLink(45, 'Анна · ждём гостя');
  await demoLink(49, 'Ильяс · дополнительное подтверждение', { waiting: true });
  const lateRepairBooking = await demoLink(53, 'Мария · подтверждённая особая бронь', { confirmed: true });
  await prisma.repairTask.create({ data: { accountId: acc.id, apartmentId: lateRepairBooking.apartmentId,
    title: 'Перенести ремонт: пересекается с особой бронью', date: lateRepairBooking.checkIn, blockDays: 1,
    createdAt: new Date(+lateRepairBooking.createdAt + 1), priority: 'medium', status: 'NEW' } });

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

  // Обязательная подготовка уже есть при установке: не оставлять массовую работу reconciliation.
  // Импортированные существующие подготовки сохраняются; получают тот же ключ, что у ядра подтверждения.
  for (const b of await prisma.booking.findMany({ where: { accountId: { in: [acc.id, accB.id] }, status: 'confirmed' } })) {
    const current = await prisma.cleaningTask.findFirst({ where: { bookingId: b.id } });
    if (current) await prisma.cleaningTask.update({ where: { id: current.id }, data: { autoKey: `turnover:${b.id}` } });
    else await prisma.cleaningTask.create({ data: { accountId: b.accountId, apartmentId: b.apartmentId, bookingId: b.id,
      date: b.checkOut, fromTime: b.checkOutTime, status: 'assigned', autoKey: `turnover:${b.id}` } });
  }

  const counts = await Promise.all([prisma.apartment.count(), prisma.apartmentPhoto.count(), prisma.booking.count(), prisma.cleaningTask.count(), prisma.repairTask.count(), prisma.transfer.count(), prisma.transferJob.count()]);
  if (!config.isTest) {
    console.log(`Готово: квартир ${counts[0]}, фото ${counts[1]}, броней ${counts[2]}, уборок ${counts[3]}, заявок мастерам ${counts[4]}, трансферов ${counts[5]} (заказов водителям ${counts[6]})`);
    console.log(`Вход в админку: azamat@astanastay.example / ${PASSWORD} (владелец), alina@astanastay.example (админ), gulnara@… (клининг), marat@… (мастер), electric@… (подрядчик Master Electric), ruslan@ / bauyrzhan@ / kanat@ (водители)`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
