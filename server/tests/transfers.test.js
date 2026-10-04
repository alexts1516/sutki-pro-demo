// Трансферы «как в Uber»: заказ создаётся при подтверждении брони, предлагается всем, кто может водить,
// первый «Беру» получает заказ, эскалация «никто не взял», отмена/перенос брони, выплата водителю, ссылка внешнего водителя.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, freeDates, extConfig, extDriver, pickupSoon } from './helpers.js';

const { app, events } = makeApp({ config: extConfig });   // внешние водители включены только для этих сценариев
let acc, apt, owner, admin, ruslan, bauyrzhan, kanat, cleaner, master, ownerB;
let start = 40;

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false }, orderBy: { sortOrder: 'desc' } });
  [owner, admin, ruslan, bauyrzhan, kanat, cleaner, master, ownerB] = await Promise.all(['azamat@astanastay.example', 'alina@astanastay.example', 'ruslan@astanastay.example',
    'bauyrzhan@astanastay.example', 'kanat@astanastay.example', 'gulnara@astanastay.example', 'marat@astanastay.example', 'owner@demo-b.example'].map(e => login(app, e)));
});
after(() => prisma.$disconnect());

/** Заявка гостя с сайта + трансфер к ней (бронь ещё не подтверждена) */
async function requestWithTransfer(tr = {}) {
  const dates = await freeDates(acc.id, apt.id, 2, start); start += 5;
  const b = await request(app).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 2, name: 'Ли Мин', phone: '+7 701 222 33 44', paymentMethod: 'card' });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const t = await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '15:30', flight: 'KC 101', pax: 2, bags: 3, childSeats: 1, ...tr });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const booking = await prisma.booking.findUnique({ where: { token: b.body.token } });
  return { booking, transferId: t.body.id, dates };
}
async function confirmedJob(tr) {
  const x = await requestWithTransfer(tr);
  const c = await request(app).post(`/api/admin/bookings/${x.booking.id}/confirm`).set(owner.auth);
  assert.equal(c.status, 200);
  const job = await prisma.transferJob.findUnique({ where: { transferId: x.transferId } });
  return { ...x, job };
}
const logs = (where) => prisma.notificationLog.findMany({ where: { accountId: acc.id, ...where } });

test('подтверждение брони с трансфером автоматически создаёт заказ и предлагает его всем водителям', async () => {
  const x = await requestWithTransfer();
  assert.equal(await prisma.transferJob.count({ where: { transferId: x.transferId } }), 0, 'до подтверждения брони заказа нет');
  assert.equal((await prisma.transfer.findUnique({ where: { id: x.transferId } })).status, 'requested');
  const c = await request(app).post(`/api/admin/bookings/${x.booking.id}/confirm`).set(admin.auth);
  assert.equal(c.status, 200);
  await events.idle();
  const job = await prisma.transferJob.findUnique({ where: { transferId: x.transferId } });
  assert.ok(job); assert.equal(job.status, 'OFFERED'); assert.equal(job.bookingId, x.booking.id); assert.equal(job.freeWaitMin, 60);
  assert.equal(job.payoutKzt, 8000 + 2000, 'выплата водителю по умолчанию = цена трансфера');
  assert.equal((await prisma.transfer.findUnique({ where: { id: x.transferId } })).status, 'planned');
  // предложение ушло владельцу, админу и трём водителям — но не клинингу и не мастеру
  const offered = await logs({ event: 'transfer.offered', dedupeKey: { startsWith: `transfer.offered:${job.id}:` } });
  const ids = offered.map(l => l.recipientId).sort();
  assert.deepEqual(ids, [owner.me.user.id, admin.me.user.id, ruslan.me.user.id, bauyrzhan.me.user.id, kanat.me.user.id].sort());
  assert.match(offered[0].text, /Новый заказ на трансфер/); assert.match(offered[0].text, /KC 101/);
  assert.doesNotMatch(offered[0].text, /222 33 44|2223344/, 'в предложении нет телефона гостя');
  // повторное подтверждение — не дублирует заказ
  await request(app).post(`/api/admin/bookings/${x.booking.id}/confirm`).set(admin.auth);
  assert.equal(await prisma.transferJob.count({ where: { transferId: x.transferId } }), 1);
  // трансфер, добавленный к уже подтверждённой брони, сразу уходит водителям
  const t2 = await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: x.booking.token, direction: 'out', place: 'station', date: x.dates.checkOut, time: '10:00' });
  assert.equal(t2.body.status, 'planned');
  const j2 = await prisma.transferJob.findUnique({ where: { transferId: t2.body.id } });
  assert.equal(j2.status, 'OFFERED'); assert.equal(j2.freeWaitMin, 15, 'проводы от квартиры — 15 минут ожидания');
});

test('предложения видят только те, кто может водить; телефон гостя — только после «Беру»', async () => {
  const { job } = await confirmedJob();
  // клининг и мастер (без «Водит») — не видят и не могут взять
  for (const who of [cleaner, master]) {
    const l = await request(app).get('/api/staff/transfers').set(who.auth);
    assert.equal(l.status, 200); assert.equal(l.body.eligible, false); assert.equal(l.body.offers.length, 0);
    assert.equal((await request(app).get(`/api/staff/transfers/${job.id}`).set(who.auth)).status, 403);
    assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(who.auth)).status, 403);
  }
  // водитель видит заказ: время, место, рейс, гость, пассажиры, багаж, кресло, адрес и номер квартиры — без телефона
  const l = await request(app).get('/api/staff/transfers').set(ruslan.auth);
  assert.equal(l.body.eligible, true);
  const offer = l.body.offers.find(o => o.id === job.id);
  assert.ok(offer); assert.equal(offer.time, '15:30'); assert.equal(offer.flight, 'KC 101'); assert.equal(offer.guestName, 'Ли Мин');
  assert.equal(offer.pax, 2); assert.equal(offer.bags, 3); assert.equal(offer.childSeats, 1); assert.equal(offer.sign, 'Ли Мин');
  // до «Беру» — только дом/ЖК и район, без номера квартиры (ни в адресе, ни в маршруте, ни в заголовке)
  assert.ok(offer.apartment.building.includes('Рыскулова'), offer.apartment.building);
  assert.equal(offer.apartment.apartmentNumber, undefined); assert.equal(offer.apartment.address, undefined);
  assert.equal(/кв\.?\s*\d/.test(JSON.stringify(offer)), false, 'номер квартиры не должен попасть в предложение: ' + JSON.stringify(offer));
  assert.equal(offer.guestPhone, undefined); assert.deepEqual(offer.actions, ['accept']);
  assert.equal(JSON.stringify(offer).includes('222 33 44'), false);
  assert.equal(offer.priceKzt, undefined); assert.equal(offer.commissionKzt, undefined);
  // берёт — телефон появляется
  const a = await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth).send({});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.status, 'ACCEPTED'); assert.equal(a.body.guestPhone, '+7 701 222 33 44'); assert.ok(a.body.vehicle.includes('Hyundai'));
  assert.equal(a.body.apartment.apartmentNumber, apt.code); assert.equal(a.body.apartment.address, apt.address);
  assert.ok(a.body.to.includes(`кв. ${apt.code}`), 'после «Беру» — адрес с номером квартиры');
  // другой водитель видит «занят» без данных гостя
  const other = await request(app).get(`/api/staff/transfers/${job.id}`).set(kanat.auth);
  assert.equal(other.status, 200); assert.equal(other.body.status, 'TAKEN');
  assert.equal(other.body.guestName, undefined); assert.equal(other.body.guestPhone, undefined); assert.equal(other.body.apartment, undefined);
  // мастеру включили «Водит» — теперь он видит предложения; выключили — снова нет
  assert.equal((await request(app).patch(`/api/admin/team/${master.me.user.id}`).set(admin.auth).send({ canDrive: true })).status, 200);
  const { job: j2 } = await confirmedJob();
  assert.ok((await request(app).get('/api/staff/transfers').set(master.auth)).body.offers.some(o => o.id === j2.id));
  await request(app).patch(`/api/admin/team/${master.me.user.id}`).set(owner.auth).send({ canDrive: false });
  assert.equal((await request(app).get(`/api/staff/transfers/${j2.id}`).set(master.auth)).status, 403);
  // другой аккаунт не видит заказ
  assert.equal((await request(app).get(`/api/admin/transfer-jobs/${job.id}`).set(ownerB.auth)).status, 404);
});

test('гонка: одновременно нажали «Беру» четверо — заказ получает ровно один', async () => {
  const { job } = await confirmedJob();
  const who = [ruslan, bauyrzhan, kanat, admin];
  const res = await Promise.all(who.map(w => request(app).post(`/api/staff/transfers/${job.id}/accept`).set(w.auth).send({})));
  const ok = res.filter(r => r.status === 200), lost = res.filter(r => r.status === 409);
  assert.equal(ok.length, 1, res.map(r => r.status).join(',')); assert.equal(lost.length, 3);
  assert.match(lost[0].body.error, /другой водитель/);
  const winner = who[res.findIndex(r => r.status === 200)];
  const db = await prisma.transferJob.findUnique({ where: { id: job.id } });
  assert.equal(db.driverUserId, winner.me.user.id); assert.equal(db.status, 'ACCEPTED');
  assert.equal((await prisma.transfer.findUnique({ where: { id: job.transferId } })).driverName, winner.me.user.name);
  await events.idle();
  // хозяину/админу — «взял водитель» (по одному разу), гостю — имя водителя (гость без Telegram → пропущено, но в журнале)
  const acc1 = await logs({ event: 'transfer.accepted', dedupeKey: { startsWith: `transfer.accepted:${job.id}:` } });
  assert.deepEqual(acc1.map(l => l.recipientType).sort(), ['admin', 'owner']);
  assert.ok((await logs({ event: 'transfer.assigned', recipientType: 'guest', dedupeKey: { startsWith: `transfer.assigned:${job.transferId}:` } })).length === 1);
  assert.equal((await prisma.transferEvent.count({ where: { jobId: job.id, type: 'accepted' } })), 1);
  // повторное нажатие победителя — не ошибка
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(winner.auth)).status, 200);
});

test('эскалация: никто не взял за N минут или до подачи меньше X часов → хозяину/админу «назначьте вручную»', async () => {
  const { job } = await confirmedJob();
  const dispatch = app.locals.dispatch;
  // рано — ничего
  let r = await dispatch.runDispatch({ now: new Date(job.offeredAt.getTime() + 10 * 60000) });
  assert.equal((await prisma.transferJob.findUnique({ where: { id: job.id } })).status, 'OFFERED');
  // через 31 минуту — UNASSIGNED и уведомление
  r = await dispatch.runDispatch({ now: new Date(job.offeredAt.getTime() + 31 * 60000) });
  assert.ok(r.escalated >= 1);
  await events.idle();
  const j = await prisma.transferJob.findUnique({ where: { id: job.id } });
  assert.equal(j.status, 'UNASSIGNED'); assert.ok(j.escalatedAt);
  const esc = await logs({ event: 'transfer.unassigned', dedupeKey: { startsWith: `transfer.unassigned:${job.id}:` } });
  assert.deepEqual(esc.map(l => l.recipientType).sort(), ['admin', 'owner']);
  assert.match(esc[0].text, /Никто не взял трансфер/); assert.match(esc[0].text, /назначьте водителя вручную/i);
  // повторный запуск — без дублей
  await dispatch.runDispatch({ now: new Date(job.offeredAt.getTime() + 40 * 60000) }); await events.idle();
  assert.equal((await logs({ event: 'transfer.unassigned', dedupeKey: { startsWith: `transfer.unassigned:${job.id}:` } })).length, 2);
  // правило «до подачи < X часов»: трансфер через 2 часа эскалируется сразу, даже если предложен только что
  const { job: soon } = await confirmedJob();
  await prisma.transferJob.update({ where: { id: soon.id }, data: { pickupAt: new Date(Date.now() + 2 * 3600000), offeredAt: new Date() } });
  await dispatch.runDispatch({ now: new Date() });
  assert.equal((await prisma.transferJob.findUnique({ where: { id: soon.id } })).status, 'UNASSIGNED');
  // хозяин назначает вручную → водитель получает заказ; переназначение → прежний водитель получает «передан другому»
  const a = await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverUserId: kanat.me.user.id });
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.status, 'ACCEPTED'); assert.equal(a.body.driver.name, 'Канат Ермеков');
  const re = await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(admin.auth).send({ driverUserId: bauyrzhan.me.user.id });
  assert.equal(re.body.driver.name, 'Бауыржан Сеитов');
  await events.idle();
  assert.ok((await logs({ event: 'transfer.driver_assigned', recipientId: bauyrzhan.me.user.id })).some(l => l.text.includes('+7 701 222 33 44')), 'назначенному — с телефоном гостя');
  assert.ok((await logs({ event: 'transfer.driver_removed', recipientId: kanat.me.user.id })).length >= 1);
  assert.equal((await request(app).get(`/api/staff/transfers/${job.id}`).set(kanat.auth)).body.status, 'TAKEN');
  // назначить можно только того, кто в списке водителей
  assert.equal((await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverUserId: cleaner.me.user.id })).status, 400);
  // водители не могут пользоваться админскими действиями
  assert.equal((await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(ruslan.auth).send({ driverUserId: ruslan.me.user.id })).status, 403);
});

test('отмена брони отменяет заказ и предупреждает водителя; перенос дат сдвигает трансфер', async () => {
  const { job, booking } = await confirmedJob();
  await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth);
  // перенос дат брони на 3 дня — трансфер и время подачи сдвигаются, водитель получает уведомление
  const ci = new Date(booking.checkIn.getTime() + 20 * 86400000), co = new Date(booking.checkOut.getTime() + 20 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const p = await request(app).patch(`/api/admin/bookings/${booking.id}`).set(owner.auth).send({ checkIn: iso(ci), checkOut: iso(co) });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const moved = await prisma.transferJob.findUnique({ where: { id: job.id }, include: { transfer: true } });
  assert.equal(iso(moved.transfer.date), iso(ci)); assert.equal(moved.pickupAt.getTime() - job.pickupAt.getTime(), 20 * 86400000);
  assert.equal(moved.status, 'ACCEPTED', 'водитель остаётся');
  await events.idle();
  assert.ok((await logs({ event: 'transfer.updated', recipientId: ruslan.me.user.id })).some(l => l.text.includes('Было')));
  // отмена брони
  const c = await request(app).post(`/api/admin/bookings/${booking.id}/cancel`).set(admin.auth);
  assert.equal(c.status, 200);
  const j = await prisma.transferJob.findUnique({ where: { id: job.id }, include: { transfer: true } });
  assert.equal(j.status, 'CANCELLED'); assert.equal(j.cancelReason, 'Бронь отменена'); assert.equal(j.transfer.status, 'cancelled');
  await events.idle();
  assert.ok((await logs({ event: 'transfer.cancelled', recipientId: ruslan.me.user.id })).length >= 1);
  // водитель больше не может двигать заказ, телефон скрыт
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/en-route`).set(ruslan.auth)).status, 409);
  assert.equal((await request(app).get(`/api/staff/transfers/${job.id}`).set(ruslan.auth)).body.guestPhone, undefined);
  // трансфер неподтверждённой заявки при отмене тоже закрывается
  const x = await requestWithTransfer();
  await request(app).post(`/api/admin/bookings/${x.booking.id}/cancel`).set(admin.auth);
  assert.equal((await prisma.transfer.findUnique({ where: { id: x.transferId } })).status, 'cancelled');
});

test('шаги водителя: выехал (ETA) → на месте → гость в машине → выполнен; выплата водителю уходит в финансы', async () => {
  const { job } = await confirmedJob();
  await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(bauyrzhan.auth);
  // чужой водитель шаги делать не может
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/en-route`).set(kanat.auth)).status, 403);
  // рейс задержался — водитель меняет время, хозяин/админ получает уведомление
  const tm = await request(app).post(`/api/staff/transfers/${job.id}/time`).set(bauyrzhan.auth).send({ time: '16:45', note: 'рейс KC 101 задержан на 75 мин' });
  assert.equal(tm.status, 200); assert.equal(tm.body.time, '16:45');
  await events.idle();
  assert.ok((await logs({ event: 'transfer.updated', recipientType: 'owner' })).some(l => l.text.includes('16:45')));
  await pickupSoon(job.id);
  const en = await request(app).post(`/api/staff/transfers/${job.id}/en-route`).set(bauyrzhan.auth).send({ etaMinutes: 40 });
  assert.equal(en.body.status, 'EN_ROUTE'); assert.ok(en.body.etaAt);
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/release`).set(bauyrzhan.auth)).status, 409, 'после выезда отказаться нельзя');
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/done`).set(bauyrzhan.auth)).status, 409, 'нельзя завершить без посадки');
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/arrived`).set(bauyrzhan.auth)).body.status, 'ARRIVED');
  assert.equal((await request(app).post(`/api/admin/transfer-jobs/${job.id}/paid`).set(owner.auth)).status, 409, 'оплата — только после выполнения');
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/picked-up`).set(bauyrzhan.auth)).body.status, 'PICKED_UP');
  const done = await request(app).post(`/api/staff/transfers/${job.id}/done`).set(bauyrzhan.auth).send({ note: 'Доставил, помог с багажом' });
  assert.equal(done.body.status, 'DONE'); assert.equal(done.body.guestPhone, undefined, 'после завершения телефон снова скрыт');
  const card = (await request(app).get(`/api/admin/transfer-jobs/${job.id}`).set(admin.auth)).body;
  assert.deepEqual(card.events.map(e => e.type), ['offered', 'accepted', 'time_changed', 'en_route', 'arrived', 'picked_up', 'done']);
  await events.idle();
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'transfer.driver_arrived', recipientType: 'guest', dedupeKey: { startsWith: `transfer.driver_arrived:${job.id}` } } }));
  // выплата: правим сумму, отмечаем «оплачено», видим в финансах месяца
  assert.equal((await request(app).patch(`/api/admin/transfer-jobs/${job.id}`).set(owner.auth).send({ payoutKzt: 7000 })).body.payoutKzt, 7000);
  const paid = await request(app).post(`/api/admin/transfer-jobs/${job.id}/paid`).set(owner.auth).send({ paid: true });
  assert.equal(paid.body.paid, true);
  const fin = await request(app).get(`/api/admin/finance?month=${card.date.slice(0, 7)}`).set(owner.auth);
  assert.ok(fin.body.transfersKzt >= 7000); assert.ok(fin.body.transfersRevenueKzt >= 10000);
  assert.equal((await request(app).get('/api/admin/finance').set(admin.auth)).status, 403, 'финансы — только владелец');
});

test('водитель отказался до выезда → заказ снова у всех; хозяин может снова предложить или отменить', async () => {
  const { job } = await confirmedJob();
  await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(kanat.auth);
  const rel = await request(app).post(`/api/staff/transfers/${job.id}/release`).set(kanat.auth).send({ reason: 'Сломалась машина' });
  assert.equal(rel.status, 200); assert.equal(rel.body.status, 'OFFERED');
  const db = await prisma.transferJob.findUnique({ where: { id: job.id } });
  assert.equal(db.offerRound, 2); assert.equal(db.driverUserId, null);
  await events.idle();
  assert.ok((await logs({ event: 'transfer.released', recipientType: 'owner' })).some(l => l.text.includes('Сломалась машина')));
  const round2 = await logs({ event: 'transfer.offered', dedupeKey: { startsWith: `transfer.offered:${job.id}:2:` } });
  assert.ok(round2.length >= 4); assert.ok(!round2.some(l => l.recipientId === kanat.me.user.id), 'отказавшемуся повторно не предлагаем');
  await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth);
  const again = await request(app).post(`/api/admin/transfer-jobs/${job.id}/offer`).set(admin.auth);
  assert.equal(again.body.status, 'OFFERED'); assert.equal(again.body.driver, null);
  const cancel = await request(app).post(`/api/admin/transfer-jobs/${job.id}/cancel`).set(owner.auth).send({ reason: 'Гость поедет сам' });
  assert.equal(cancel.body.status, 'CANCELLED');
  assert.equal((await request(app).post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth)).status, 409);
});

test('внешний водитель по ссылке: назначение, шаги, ссылка закрывается после выполнения', async () => {
  const { job } = await confirmedJob();
  const ext = await extDriver(acc.id);
  const a = await request(app).post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverContractorId: ext.id });
  assert.equal(a.status, 200); assert.equal(a.body.driver.kind, 'contractor'); assert.ok(a.body.link.token);
  const url = `/api/transfer-link/${a.body.link.token}`;
  const v = await request(app).get(url);
  assert.equal(v.status, 200); assert.equal(v.body.guestPhone, '+7 701 222 33 44'); assert.equal(v.body.apartment.apartmentNumber, apt.code);
  await pickupSoon(job.id);
  for (const s of ['en-route', 'arrived', 'picked-up', 'done']) assert.equal((await request(app).post(`${url}/${s}`).send({})).status, 200, s);
  assert.equal((await request(app).get(url)).status, 410);
  assert.equal((await request(app).get('/api/transfer-link/nope')).status, 404);
});

test('календарь админки: брони, уборки, заявки мастерам и трансферы со статусом заказа', async () => {
  const r = await request(app).get('/api/admin/calendar?days=7').set(admin.auth);
  assert.equal(r.status, 200);
  assert.ok(r.body.apartments.length > 0 && r.body.bookings.length > 0);
  assert.ok(r.body.transfers.some(t => t.jobId && ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'UNASSIGNED', 'OFFERED'].includes(t.status)));
  assert.equal((await request(app).get('/api/admin/calendar').set(ruslan.auth)).status, 403);
  const drivers = (await request(app).get('/api/admin/drivers').set(admin.auth)).body;
  assert.ok(drivers.team.some(d => d.role === 'driver') && drivers.team.some(d => d.role === 'owner'));
  assert.ok(!drivers.team.some(d => d.role === 'cleaning'));
  const list = (await request(app).get('/api/admin/transfer-jobs?status=UNASSIGNED,OFFERED').set(admin.auth)).body;
  assert.ok(list.items.every(i => ['UNASSIGNED', 'OFFERED'].includes(i.status)));
});
