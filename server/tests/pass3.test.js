// Проход 3: операционный поток «событие → задача → ответственный → выполнение → подтверждение».
// Шаги водителя — только по порядку и не раньше окна (≈2 ч до подачи); подготовка — не раньше своего дня, после «готово» не меняется;
// готовность квартиры выводится из условий (подготовка, отчёт, срочные недочёты); «Сегодня» — исключения первыми;
// недочёты с подготовки; ранний заезд; заказ водителю — только по подтверждённой брони; оплата на сайте = подтверждение.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, freeDates, pickupSoon, guestBooking, guestPayment, guestTransfer } from './helpers.js';
import { todayView, apartmentOps, cleaningDeadline } from '../src/services/ops.js';
import { syncDefectsWithRepair } from '../src/services/defects.js';
import { createTestPayments } from '../src/payments/test.js';
import crypto from 'node:crypto';
import { todayIn, addDays, atLocal, isoDay } from '../src/lib/dates.js';
import { randomToken } from '../src/lib/tokens.js';

const { app } = makeApp();
const A = () => request(app);
let acc, apt, owner, admin, ruslan, gulnara, tz, testApt, gulnaraUser;
let start = 260, num = 970000;

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  tz = acc.timezone;
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false }, orderBy: { sortOrder: 'asc' } });
  [owner, admin, ruslan, gulnara] = await Promise.all(['azamat', 'alina', 'ruslan', 'gulnara'].map(l => login(app, `${l}@astanastay.example`)));
  gulnaraUser = gulnara.me.user;
  // отдельная квартира без броней — чтобы сценарии не зависели от демо-данных;
  // без номера, «с животными», в конце порядка — не попадает в выборки других тестов
  testApt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест проход 3', address: 'ул. Тестовая, 3', district: 'Есиль', rooms: '1-комн.', maxGuests: 4, basePriceKzt: 20000, sortOrder: -100, petsAllowed: true } });
});
after(() => prisma.$disconnect());

async function confirmedJob() {
  const dates = await freeDates(acc.id, apt.id, 2, start); start += 5;
  const b = await A().post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 1, name: 'Гость Три', phone: '+7 701 333 44 55' });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const t = await A().post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '15:00', pax: 1, bags: 1 });
  const booking = await guestBooking(b.body.token);
  return { booking, transferId: (await guestTransfer(t.body.ref)).id };
}
const step = (who, id, s, body = {}) => A().post(`/api/staff/transfers/${id}/${s}`).set(who.auth).send(body);
const mkBooking = (o) => prisma.booking.create({ data: { accountId: acc.id, apartmentId: testApt.id, number: ++num, token: randomToken(12), source: 'site', status: 'confirmed', guestsCount: 2, nightlyKzt: 20000, totalKzt: 40000, paymentStatus: 'paid', paymentMethod: 'card', ...o } });

test('водитель: шаги не раньше окна (≈2 ч до подачи) и строго по порядку; после завершения ничего не меняется', async () => {
  const x = await confirmedJob();
  assert.equal((await A().post(`/api/admin/bookings/${x.booking.id}/confirm`).set(owner.auth)).status, 200);
  const job = await prisma.transferJob.findUnique({ where: { transferId: x.transferId } });
  assert.equal((await step(ruslan, job.id, 'accept')).status, 200);
  // поездка через месяц: «Запланировано», кнопки «Выехал» нет, нажать нельзя ни водителю, ни админу «за водителя»
  let v = (await A().get(`/api/staff/transfers/${job.id}`).set(ruslan.auth)).body;
  assert.equal(v.planned, true); assert.ok(v.startOpensAt); assert.ok(!v.actions.includes('en-route'));
  const early = await step(ruslan, job.id, 'en-route', { etaMinutes: 30 });
  assert.equal(early.status, 409); assert.match(early.body.error, /Рано/);
  assert.equal((await A().post(`/api/admin/transfer-jobs/${job.id}/status`).set(admin.auth).send({ action: 'en-route' })).status, 409);
  // до подачи час — окно открыто; доступен только следующий шаг
  await pickupSoon(job.id, 60);
  v = (await A().get(`/api/staff/transfers/${job.id}`).set(ruslan.auth)).body;
  assert.equal(v.planned, false); assert.ok(v.actions.includes('en-route'));
  assert.ok(!v.actions.includes('arrived') && !v.actions.includes('picked-up') && !v.actions.includes('done'));
  assert.equal((await step(ruslan, job.id, 'arrived')).status, 409, 'сначала «Выехал»');
  assert.equal((await step(ruslan, job.id, 'en-route', { etaMinutes: 30 })).status, 200);
  assert.equal((await step(ruslan, job.id, 'en-route', { etaMinutes: 30 })).status, 409, 'повторно не отмечается');
  assert.equal((await step(ruslan, job.id, 'picked-up')).status, 409, 'сначала «На месте»');
  v = (await A().get(`/api/staff/transfers/${job.id}`).set(ruslan.auth)).body;
  assert.ok(v.actions.includes('arrived') && !v.actions.includes('done'));
  for (const s of ['arrived', 'picked-up', 'done']) assert.equal((await step(ruslan, job.id, s)).status, 200, s);
  const after = await step(ruslan, job.id, 'en-route');
  assert.equal(after.status, 409); assert.match(after.body.error, /выполнен/);
});

test('окно «Выехал» — настройка владельца; список водителя отсортирован по времени подачи', async () => {
  assert.equal((await A().put('/api/admin/settings').set(owner.auth).send({ driverStartWindowMin: 30 })).status, 200);
  try {
    const x = await confirmedJob();
    await A().post(`/api/admin/bookings/${x.booking.id}/confirm`).set(owner.auth);
    const job = await prisma.transferJob.findUnique({ where: { transferId: x.transferId } });
    await step(ruslan, job.id, 'accept');
    await pickupSoon(job.id, 60);   // до подачи час, окно 30 мин — ещё рано
    const v = (await A().get(`/api/staff/transfers/${job.id}`).set(ruslan.auth)).body;
    assert.equal(v.planned, true); assert.ok(!v.actions.includes('en-route'));
    const list = (await A().get('/api/staff/transfers').set(ruslan.auth)).body;
    const times = list.mine.map(j => +new Date(j.pickupAt));
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'ближайшие — первыми');
  } finally {
    await A().put('/api/admin/settings').set(owner.auth).send({ driverStartWindowMin: 120 });
  }
});

test('админ «за водителя» может пропустить шаги, но только когда окно открыто', async () => {
  const x = await confirmedJob();
  await A().post(`/api/admin/bookings/${x.booking.id}/confirm`).set(owner.auth);
  const job = await prisma.transferJob.findUnique({ where: { transferId: x.transferId } });
  await A().post(`/api/admin/transfer-jobs/${job.id}/assign`).set(owner.auth).send({ driverUserId: ruslan.me.user.id });
  await pickupSoon(job.id, 30);
  const r = await A().post(`/api/admin/transfer-jobs/${job.id}/status`).set(admin.auth).send({ action: 'done' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'DONE');
  const db = await prisma.transferJob.findUnique({ where: { id: job.id } });
  assert.ok(db.enRouteAt && db.arrivedAt && db.pickedUpAt, 'пропущенные шаги заполнены');
});

test('заказ водителю — только по подтверждённой брони', async () => {
  const x = await confirmedJob();   // бронь ещё «ждёт оплаты»
  const r = await A().post(`/api/admin/transfers/${x.transferId}/dispatch`).set(admin.auth);
  assert.equal(r.status, 409); assert.match(r.body.error, /не подтверждена/);
  assert.equal(await prisma.transferJob.count({ where: { transferId: x.transferId } }), 0);
});

test('оплата на сайте = подтверждение: бронь подтверждается сама, появляется подготовка и заказ водителям', async () => {
  const callbackSecret='pass3-payment-callback';
  const { app: payApp } = makeApp({ payments: createTestPayments({callbackSecret}) });
  const dates = await freeDates(acc.id, apt.id, 2, start); start += 5;
  const b = await request(payApp).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 1, name: 'Гость Оплата', phone: '+7 701 333 44 66', paymentMethod: 'card', earlyCheckIn: '10:00' });
  assert.equal(b.status, 201); assert.equal(b.body.payOnline, true);
  const t = await request(payApp).post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '09:00', pax: 1, bags: 1 });
  assert.equal(t.status, 201);
  const p = await request(payApp).post(`/api/public/astana-stay/bookings/${b.body.token}/pay`).send({});
  assert.equal(p.status, 201); assert.equal(p.body.status, 'created'); assert.equal(p.body.bookingStatus, 'request');
  const payment=await guestPayment(p.body.paymentRef);const raw=JSON.stringify({paymentRef:p.body.paymentRef,operationId:'pass3-provider-operation',amount:payment.amount,currency:payment.currency,status:'succeeded'});
  const callback=await request(payApp).post('/api/payments/test/callback').set('Content-Type','application/json').set('X-Test-Signature',crypto.createHmac('sha256',callbackSecret).update(raw).digest('hex')).send(raw);
  assert.equal(callback.status,200);
  const bk = await guestBooking(b.body.token);
  assert.equal(bk.status, 'confirmed'); assert.equal(bk.paymentStatus, 'paid');
  assert.equal(bk.earlyCheckIn, '10:00'); assert.equal(bk.earlyCheckInStatus, 'requested');
  assert.ok(await prisma.cleaningTask.findFirst({ where: { bookingId: bk.id } }));
  assert.ok(await prisma.transferJob.findUnique({ where: { transferId: (await guestTransfer(t.body.ref)).id } }), 'заказ водителям ушёл после оплаты');
  assert.equal((await request(payApp).post(`/api/public/astana-stay/bookings/${b.body.token}/pay`).send({})).status, 409, 'повторно не оплатить');
});

test('подготовка: не раньше своего дня; «закончить» — только после «начать»; после «готово» ничего не меняется', async () => {
  const today = todayIn(tz);
  const future = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: testApt.id, assigneeId: gulnaraUser.id, date: addDays(today, 3) } });
  const s1 = await A().post(`/api/staff/cleaning/${future.id}/start`).set(gulnara.auth);
  assert.equal(s1.status, 409); assert.match(s1.body.error, /запланирована/);
  const card = (await A().get(`/api/staff/cleaning/${future.id}`).set(gulnara.auth)).body;
  assert.equal(card.canStart, false); assert.ok(card.deadline?.at);
  const t = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: testApt.id, assigneeId: gulnaraUser.id, date: today } });
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({ note: 'x' })).status, 409);
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/start`).set(gulnara.auth)).status, 200);
  const f = await A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({ note: 'Не было чистого белья' });
  assert.equal(f.status, 200); assert.equal(f.body.status, 'done');
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/check`).set(gulnara.auth).send({ index: 0, done: false })).status, 409);
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/start`).set(gulnara.auth)).status, 409);
  assert.equal((await A().patch(`/api/admin/cleaning-tasks/${t.id}`).set(admin.auth).send({ assigneeId: null })).status, 409);
  // сообщить о недочёте после «готово» — можно (это не меняет отчёт)
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/problem`).set(gulnara.auth).send({ text: 'Скрипит дверь шкафа', priority: 'later' })).status, 201);
  // готовность: подготовка закончена не полностью → «Проверьте отчёт», после «Принять отчёт» — готова
  let ops = await apartmentOps(acc.id, testApt.id, { role: 'admin' });
  assert.equal(ops.state, 'check'); assert.equal(ops.ready, false);
  assert.equal((await A().post(`/api/admin/cleaning-tasks/${t.id}/review`).set(admin.auth)).status, 200);
  ops = await apartmentOps(acc.id, testApt.id, { role: 'admin' });
  assert.notEqual(ops.state, 'check');
  await prisma.cleaningTask.delete({ where: { id: future.id } });
});

test('недочёт с подготовки: срочный блокирует готовность, виден в календаре (⚠) и в «Сегодня»; заявка мастеру выполнена → решён', async () => {
  const today = todayIn(tz);
  const t = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: testApt.id, assigneeId: gulnaraUser.id, date: today } });
  await A().post(`/api/staff/cleaning/${t.id}/start`).set(gulnara.auth);
  const p = await A().post(`/api/staff/cleaning/${t.id}/problem`).set(gulnara.auth).send({ text: 'Мигает лампа в коридоре', priority: 'urgent' });
  assert.equal(p.status, 201);
  const d = await prisma.defect.findFirst({ where: { cleaningTaskId: t.id, text: 'Мигает лампа в коридоре' } });
  assert.equal(d.priority, 'urgent'); assert.equal(d.status, 'open');
  await A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({ note: 'лампа' });
  const ops = await apartmentOps(acc.id, testApt.id, { role: 'admin' });
  assert.equal(ops.state, 'blocked'); assert.equal(ops.ready, false);
  assert.ok(ops.reasons.some(r => r.includes('Мигает лампа')));
  assert.ok(ops.defects.some(x => x.id === d.id));
  const cal = (await A().get(`/api/admin/calendar?from=${isoDay(today)}&days=3`).set(admin.auth)).body;
  assert.ok(cal.cleanings.find(c => c.id === t.id).defects >= 1, '⚠N на плитке подготовки');
  assert.ok(cal.apartments.find(a => a.id === testApt.id).urgentDefects >= 1);
  const tv = (await A().get('/api/admin/today').set(admin.auth)).body;
  assert.ok(tv.items.some(i => i.kind === 'defect' && i.aptId === testApt.id));
  // «Заявка мастеру» → заявка выполнена → недочёт решён
  const r = await A().post(`/api/admin/defects/${d.id}/repair`).set(admin.auth);
  assert.equal(r.status, 201);
  await syncDefectsWithRepair(r.body.repairTaskId, 'DONE', 'Мастер');
  const d2 = await prisma.defect.findUnique({ where: { id: d.id } });
  assert.equal(d2.status, 'resolved'); assert.equal(d2.resolution, 'repair');
  // остальные — «Решено»
  for (const x of await prisma.defect.findMany({ where: { apartmentId: testApt.id, status: 'open' } })) assert.equal((await A().post(`/api/admin/defects/${x.id}/resolve`).set(admin.auth).send({})).status, 200);
  assert.notEqual((await apartmentOps(acc.id, testApt.id, { role: 'admin' })).state, 'blocked');
});

test('«Сегодня»: заезд при неготовой квартире — критично и первым; трансфер без водителя; ранний заезд → согласовать (срок подготовки сдвигается)', async () => {
  const tomorrow = addDays(todayIn(tz), 1);
  const now = atLocal(tomorrow, '12:00', tz);   // смотрим «глазами» завтрашнего полудня
  await prisma.repairTask.updateMany({ where: { apartmentId: testApt.id }, data: { status: 'CANCELLED' } });
  const bk = await mkBooking({ checkIn: tomorrow, checkOut: addDays(tomorrow, 2), checkInTime: '14:00', earlyCheckIn: '11:00', earlyCheckInStatus: 'requested' });
  const cl = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: testApt.id, date: tomorrow, fromTime: '10:00', toTime: '18:00' } });   // никто не назначен
  const tr = await prisma.transfer.create({ data: { accountId: acc.id, apartmentId: testApt.id, bookingId: bk.id, direction: 'in', date: tomorrow, time: '13:00', priceKzt: 8000, status: 'planned' } });
  const job = await prisma.transferJob.create({ data: { accountId: acc.id, transferId: tr.id, bookingId: bk.id, apartmentId: testApt.id, status: 'UNASSIGNED', pickupAt: atLocal(tomorrow, '13:00', tz) } });
  try {
    const v = await todayView(acc.id, { role: 'admin', now });
    const mine = v.items.filter(i => i.aptId === testApt.id);
    const k = (kind) => mine.find(i => i.kind === kind);
    assert.equal(k('checkin_not_ready')?.level, 'critical');
    assert.equal(k('prep_unassigned')?.level, 'critical');
    assert.equal(k('transfer_no_driver')?.level, 'critical');
    assert.equal(k('early_checkin')?.level, 'action');
    assert.equal(v.items[0].level, 'critical', 'исключения — первыми');
    const order = v.items.map(i => ['critical', 'action', 'today', 'info'].indexOf(i.level));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    for (const i of mine.filter(i => i.level === 'critical')) assert.ok(i.problem && i.action && i.object, 'проблема → действие → объект');
    // владелец (есть админ): рутину «назначить подготовку» не видит, а решение по раннему заезду — видит
    const ov = await todayView(acc.id, { role: 'owner', now });
    assert.ok(!ov.items.some(i => i.aptId === testApt.id && i.kind === 'prep_unassigned' && i.level !== 'critical'));
    assert.ok(ov.items.some(i => i.aptId === testApt.id && i.kind === 'early_checkin'));
    assert.ok(ov.business && typeof ov.business.apartments === 'number');
    // ранний заезд согласован: время заезда 11:00 → срок подготовки 11:00
    const before = cleaningDeadline(cl, [bk], tz);
    const ok = await A().post(`/api/admin/bookings/${bk.id}/early-checkin`).set(admin.auth).send({ approve: true });
    assert.equal(ok.status, 200); assert.equal(ok.body.checkInTime, '11:00');
    const after = cleaningDeadline(cl, [await prisma.booking.findUnique({ where: { id: bk.id } })], tz);
    assert.ok(after.at < before.at); assert.match(after.reason, /11:00/);
    assert.equal((await A().post(`/api/admin/bookings/${bk.id}/early-checkin`).set(admin.auth).send({ approve: false })).status, 409, 'решение уже принято');
  } finally {
    await prisma.transferJob.delete({ where: { id: job.id } });
    await prisma.transfer.delete({ where: { id: tr.id } });
    await prisma.cleaningTask.delete({ where: { id: cl.id } });
    await prisma.booking.update({ where: { id: bk.id }, data: { status: 'cancelled' } });
  }
});

test('бронь: завершённую не отменить; у заехавшего гостя не сдвинуть дату заезда', async () => {
  const today = todayIn(tz);
  const done = await mkBooking({ checkIn: addDays(today, -40), checkOut: addDays(today, -38), status: 'completed' });
  assert.equal((await A().post(`/api/admin/bookings/${done.id}/cancel`).set(admin.auth)).status, 409);
  const live = await mkBooking({ checkIn: addDays(today, -30), checkOut: addDays(today, -28) });
  const r = await A().patch(`/api/admin/bookings/${live.id}`).set(admin.auth).send({ checkIn: isoDay(addDays(today, -29)) });
  assert.equal(r.status, 409);
});
