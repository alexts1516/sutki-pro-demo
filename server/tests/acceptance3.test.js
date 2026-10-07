// Приёмка прохода 3: регрессии найденных ошибок (повторные и одновременные действия, неверный порядок, конфликт времени).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, freeDates, guestBooking } from './helpers.js';
import { apartmentOps } from '../src/services/ops.js';
import { todayIn, addDays } from '../src/lib/dates.js';
import { randomToken } from '../src/lib/tokens.js';

const { app } = makeApp();
const A = () => request(app);
let acc, apt, testApt, owner, admin, gulnara, marat, ruslan, gUser, mUser;
let num = 980000 + (Date.now() % 9000), start = 330;

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false }, orderBy: { sortOrder: 'asc' } });
  [owner, admin, gulnara, marat, ruslan] = await Promise.all(['azamat', 'alina', 'gulnara', 'marat', 'ruslan'].map(l => login(app, `${l}@astanastay.example`)));
  gUser = gulnara.me.user; mUser = marat.me.user;
  testApt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Тест приёмка 3', address: 'ул. Тестовая, 33', district: 'Есиль', rooms: '1-комн.', maxGuests: 4, basePriceKzt: 20000, sortOrder: -101, petsAllowed: true, cleaningRateKzt: 5000 } });
});
after(() => prisma.$disconnect());

const mkBooking = (o) => prisma.booking.create({ data: { accountId: acc.id, apartmentId: testApt.id, number: ++num, token: randomToken(12), source: 'site', status: 'confirmed', guestsCount: 2, nightlyKzt: 20000, totalKzt: 40000, paymentStatus: 'paid', paymentMethod: 'card', ...o } });
const prep = (o = {}) => prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: testApt.id, assigneeId: gUser.id, date: todayIn(acc.timezone), ...o } });

test('двойное подтверждение брони (двойной клик / повтор оплаты): одна подготовка и один заказ водителям', async () => {
  const dates = await freeDates(acc.id, apt.id, 2, start); start += 5;
  const b = await A().post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 1, name: 'Гость Дубль', phone: '+7 701 333 77 11' });
  await A().post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '15:00', pax: 1, bags: 1 });
  const bk = await guestBooking(b.body.token);
  const rs = await Promise.all([1, 2, 3].map(() => A().post(`/api/admin/bookings/${bk.id}/confirm`).set(admin.auth)));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
  assert.equal(await prisma.cleaningTask.count({ where: { bookingId: bk.id } }), 1, 'подготовка не задвоилась');
  assert.equal(await prisma.transferJob.count({ where: { bookingId: bk.id } }), 1, 'заказ водителям не задвоился');
  await A().post(`/api/admin/bookings/${bk.id}/cancel`).set(admin.auth);
});

test('подготовка: двойное «Закончить» — одна выплата; «готово» в обход «Начать» нельзя; смена исполнителя «в пути» — с начала', async () => {
  const t = await prep();
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/status`).set(gulnara.auth).send({ status: 'done', report: 'всё сделала' })).status, 409, 'нельзя перепрыгнуть «Начать»');
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/start`).set(gulnara.auth)).status, 200);
  const rs = await Promise.all([1, 2, 3].map(() => A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({ note: 'без белья' })));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
  assert.equal(await prisma.payout.count({ where: { cleaningTaskId: t.id } }), 1);
  // смена исполнителя у «В пути»
  const t2 = await prep({ status: 'enroute' });
  const pp = await A().patch(`/api/admin/cleaning-tasks/${t2.id}`).set(admin.auth).send({ assigneeId: null });
  assert.equal(pp.status, 200); assert.equal(pp.body.status, 'assigned');
  await prisma.cleaningTask.delete({ where: { id: t2.id } });
});

test('недочёт: повтор не плодит копии; «Заявка мастеру» дважды — одна заявка; «Решено» при живой заявке нельзя; некритичный не блокирует', async () => {
  await prisma.defect.updateMany({ where: { apartmentId: testApt.id }, data: { status: 'resolved' } });
  const t = await prep();
  await A().post(`/api/staff/cleaning/${t.id}/start`).set(gulnara.auth);
  const body = { text: 'Закончились мусорные пакеты', priority: 'later' };
  const rs = await Promise.all([1, 2].map(() => A().post(`/api/staff/cleaning/${t.id}/problem`).set(gulnara.auth).send(body)));
  assert.deepEqual(rs.map(r => r.status), [201, 201]);
  // последовательный повтор (обновили страницу и отправили ещё раз)
  await A().post(`/api/staff/cleaning/${t.id}/problem`).set(gulnara.auth).send(body);
  const list = await prisma.defect.findMany({ where: { apartmentId: testApt.id, status: 'open', text: body.text } });
  assert.equal(list.length, 1, 'один недочёт, а не три');
  const d = list[0];
  // закончили подготовку — некритичный недочёт остаётся и не мешает «Готова»
  for (let i = 0; i < 7; i++) await A().post(`/api/staff/cleaning/${t.id}/check`).set(gulnara.auth).send({ index: i, done: true });
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({})).status, 200);
  let ops = await apartmentOps(acc.id, testApt.id, { role: 'admin' });
  assert.equal(ops.state, 'ready'); assert.ok(ops.defects.some(x => x.id === d.id), 'недочёт не исчез после «Готово»');
  // повтор «Заявка мастеру» (двойной клик) — одна заявка
  const rr = await Promise.all([1, 2].map(() => A().post(`/api/admin/defects/${d.id}/repair`).set(admin.auth)));
  assert.deepEqual(rr.map(r => r.status), [201, 201]);
  assert.equal(rr[0].body.repairTaskId, rr[1].body.repairTaskId);
  assert.equal(await prisma.repairTask.count({ where: { apartmentId: testApt.id, title: body.text } }), 1);
  // закрыть недочёт до работы мастера нельзя; отменили заявку — можно
  const early = await A().post(`/api/admin/defects/${d.id}/resolve`).set(admin.auth).send({});
  assert.equal(early.status, 409);
  assert.equal((await A().post(`/api/admin/repairs/${rr[0].body.repairTaskId}/cancel`).set(admin.auth).send({ reason: 'сделаем сами' })).status, 200);
  assert.equal((await A().post(`/api/admin/defects/${d.id}/resolve`).set(admin.auth).send({})).status, 200);
  const again = await A().post(`/api/admin/defects/${d.id}/resolve`).set(admin.auth).send({});
  assert.equal(again.status, 200); assert.equal(again.body.status, 'resolved', 'повтор «Решено» ничего не ломает');
  assert.equal((await A().post(`/api/admin/defects/${d.id}/repair`).set(admin.auth)).status, 409, 'по закрытому заявку не создать');
});

test('срочная проблема → мастер: двойное «Завершить» — одна запись; после закрытия шаги не работают; готовность пересчиталась сама', async () => {
  await prisma.defect.updateMany({ where: { apartmentId: testApt.id }, data: { status: 'resolved' } });
  const d = await A().post('/api/admin/defects').set(admin.auth).send({ apartmentId: testApt.id, text: 'Течёт кран в ванной', priority: 'urgent' });
  assert.equal(d.status, 201);
  assert.equal((await apartmentOps(acc.id, testApt.id, { role: 'admin' })).state, 'blocked');
  const r = await A().post(`/api/admin/defects/${d.body.id}/repair`).set(admin.auth);
  await prisma.repairTask.update({ where: { id: r.body.repairTaskId }, data: { assigneeId: mUser.id, quickJob: true, status: 'VISIT_INSPECTION', arrivedAt: new Date() } });
  const url = `/api/staff/repairs/${r.body.repairTaskId}`;
  assert.equal((await A().post(`${url}/complete`).set(marat.auth).send({ finalCostKzt: 3000, report: 'Заменил прокладку' })).status, 409, 'завершить без «Начать» нельзя');
  assert.equal((await A().post(`${url}/start`).set(marat.auth)).status, 200);
  const rs = await Promise.all([1, 2].map(() => A().post(`${url}/complete`).set(marat.auth).send({ finalCostKzt: 3000, report: 'Заменил прокладку' })));
  assert.deepEqual(rs.map(x => x.status).sort(), [200, 409]);
  assert.equal(await prisma.repairEvent.count({ where: { repairTaskId: r.body.repairTaskId, type: 'completed' } }), 1);
  assert.equal(await prisma.payout.count({ where: { repairTaskId: r.body.repairTaskId } }), 1);
  assert.equal((await A().post(`${url}/start`).set(marat.auth)).status, 409, 'после закрытия не начать');
  assert.equal((await prisma.defect.findUnique({ where: { id: d.body.id } })).status, 'resolved');
  assert.notEqual((await apartmentOps(acc.id, testApt.id, { role: 'admin' })).state, 'blocked', 'готовность пересчиталась без ручных действий');
});

test('ранний заезд: раньше выезда предыдущего гостя + 2 ч на подготовку согласовать нельзя; допустимое время — можно', async () => {
  const day = addDays(todayIn(acc.timezone), 20);
  const prev = await mkBooking({ checkIn: addDays(day, -2), checkOut: day, checkOutTime: '12:00' });
  const bk = await mkBooking({ checkIn: day, checkOut: addDays(day, 2), checkInTime: '16:00', earlyCheckIn: '10:00', earlyCheckInStatus: 'requested' });
  const no = await A().post(`/api/admin/bookings/${bk.id}/early-checkin`).set(admin.auth).send({ approve: true });
  assert.equal(no.status, 409); assert.match(no.body.error, /14:00/);
  assert.equal((await prisma.booking.findUnique({ where: { id: bk.id } })).checkInTime, '16:00', 'время заезда не изменилось');
  await prisma.booking.update({ where: { id: bk.id }, data: { earlyCheckIn: '14:00' } });
  const ok = await A().post(`/api/admin/bookings/${bk.id}/early-checkin`).set(admin.auth).send({ approve: true });
  assert.equal(ok.status, 200); assert.equal(ok.body.checkInTime, '14:00');
  assert.equal((await A().post(`/api/admin/bookings/${bk.id}/early-checkin`).set(admin.auth).send({ approve: true })).status, 409, 'повторное согласование');
  await prisma.booking.updateMany({ where: { id: { in: [prev.id, bk.id] } }, data: { status: 'cancelled' } });
});

test('роли: исполнители не открывают «Сегодня», карточку квартиры и действия с недочётами напрямую через API', async () => {
  for (const who of [gulnara, marat, ruslan]) {
    assert.equal((await A().get('/api/admin/today').set(who.auth)).status, 403);
    assert.equal((await A().get(`/api/admin/apartments/${testApt.id}/ops`).set(who.auth)).status, 403);
    assert.equal((await A().post('/api/admin/defects').set(who.auth).send({ apartmentId: testApt.id, text: 'чужое действие', priority: 'urgent' })).status, 403);
  }
  // специалист не видит чужую подготовку
  const other = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: testApt.id, date: todayIn(acc.timezone) } });
  assert.ok([403, 404].includes((await A().get(`/api/staff/cleaning/${other.id}`).set(gulnara.auth)).status));
  assert.ok([403, 404].includes((await A().post(`/api/staff/cleaning/${other.id}/start`).set(gulnara.auth)).status));
  // владелец видит выплаты, администратор — нет
  const ov = (await A().get('/api/admin/today').set(owner.auth)).body, av = (await A().get('/api/admin/today').set(admin.auth)).body;
  assert.ok(!av.items.some(i => i.kind === 'payout_overdue'));
  assert.ok(ov.business && !av.business?.owedKzt);
});
