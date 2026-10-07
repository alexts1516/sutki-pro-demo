// Проход 1: мастер «В работе» → «Завершить работу» (время начала/окончания), отказ владельца → «Исправить смету» / «Отказаться»,
// чек-лист подготовки (обязательные пункты и фото), единые выплаты (подготовка / мастер / водитель, у владельца — нет),
// вместимость машины (пассажиры и багаж), внешние водители выключены.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, png, isoIn, pickupSoon } from './helpers.js';
import { handlePayoutButton } from '../src/telegram/payoutButtons.js';

const { app, events } = makeApp();
const A = () => request(app);
let acc, apt, owner, admin, marat, erlan, gulnara, ruslan, kanat, ownerUser;

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, code: { not: null } }, orderBy: { sortOrder: 'desc' } });
  [owner, admin, marat, erlan, gulnara, ruslan, kanat] = await Promise.all(['azamat', 'alina', 'marat', 'erlan', 'gulnara', 'ruslan', 'kanat'].map(l => login(app, `${l}@astanastay.example`)));
  ownerUser = owner.me.user;
});
after(() => prisma.$disconnect());

const newRepair = async (body = {}) => {
  const r = await A().post('/api/admin/repairs').set(owner.auth).send({ apartmentId: apt.id, title: 'Течёт смеситель', description: 'Капает на кухне', type: 'plumb', assigneeId: marat.me.user.id, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
};
const st = (who, id, step, body = {}) => A().post(`/api/staff/repairs/${id}/${step}`).set(who.auth).send(body);
const estimate = (who, id, labourKzt = 10000, method = 'REMOTE') => st(who, id, 'estimate', { method, labourKzt, comment: 'Замена картриджа' });
const decide = async (taskId, approve, reason) => {
  const t = await prisma.repairEstimate.findFirst({ where: { repairTaskId: taskId, status: 'pending' } });
  return A().post(`/api/admin/estimates/${t.id}/${approve ? 'approve' : 'reject'}`).set(owner.auth).send({ reason });
};

test('мастер: «Начать работу» → «В работе» (время начала, без «приехал») → «Завершить работу» (время окончания) → выплата «к оплате»', async () => {
  const t = await newRepair();
  assert.ok((await st(marat, t.id, 'start')).status === 409, 'без сметы начать нельзя');
  assert.equal((await estimate(marat, t.id, 12000)).status, 201);
  assert.equal((await decide(t.id, true)).status, 200);
  const before = (await A().get(`/api/staff/repairs/${t.id}`).set(marat.auth)).body;
  assert.ok(before.actions.includes('start') && before.actions.includes('arrive'), 'приезд — по желанию');
  const s = await st(marat, t.id, 'start');
  assert.equal(s.status, 200); assert.equal(s.body.status, 'IN_PROGRESS'); assert.equal(s.body.statusLabel, 'В работе');
  assert.ok(s.body.startedAt, 'время начала'); assert.equal(s.body.arrivedAt, null, 'приезд не подставляется'); assert.equal(s.body.doneAt, null);
  assert.deepEqual(s.body.actions, ['extra', 'complete'], 'отдельный шаг «Завершить работу»');
  const c = await st(marat, t.id, 'complete', { finalCostKzt: 12000, report: 'Заменил картридж' });
  assert.equal(c.body.status, 'DONE'); assert.ok(c.body.doneAt && new Date(c.body.doneAt) >= new Date(c.body.startedAt));
  await events.idle();
  const p = await prisma.payout.findUnique({ where: { repairTaskId: t.id } });
  assert.equal(p.kind, 'repair'); assert.equal(p.amountKzt, 12000); assert.equal(p.status, 'PENDING'); assert.equal(p.userId, marat.me.user.id);
  const msg = await prisma.notificationLog.findFirst({ where: { event: 'payout.created', dedupeKey: { startsWith: `payout.created:${p.id}` } } });
  assert.match(msg.text, /к оплате/); assert.match(msg.text, /12 000 ₸/); assert.equal(msg.recipientType, 'owner');
  // «Оплатить» под уведомлением (кнопка Telegram) → выплачено переводом; заявка отмечена «оплачено»
  await prisma.user.update({ where: { id: ownerUser.id }, data: { telegramId: '700001' } });
  const r = await handlePayoutButton({ prisma, payouts: app.locals.payouts, telegramUserId: 700001, method: 'transfer', payoutId: p.id });
  assert.ok(r.ok, r.text);
  const paid = await prisma.payout.findUnique({ where: { id: p.id } });
  assert.equal(paid.status, 'PAID'); assert.equal(paid.method, 'transfer'); assert.ok(paid.paidAt);
  assert.equal((await prisma.repairTask.findUnique({ where: { id: t.id } })).paid, true);
  const mine = (await A().get('/api/staff/payouts').set(marat.auth)).body;
  assert.ok(mine.items.some(x => x.id === p.id && x.statusLabel === 'Выплачено' && x.paidAt));
});

test('отказ владельца по смете → у мастера ровно «Исправить смету» / «Отказаться» (+ «нужен выезд» ссылкой); исправление уходит на одобрение', async () => {
  const t = await newRepair();
  await estimate(marat, t.id, 30000);
  assert.equal((await decide(t.id, false, 'Дорого')).status, 200);
  const card = (await A().get(`/api/staff/repairs/${t.id}`).set(marat.auth)).body;
  assert.equal(card.status, 'REJECTED');
  assert.deepEqual(card.actions, ['revise', 'decline', 'request-visit']);
  const r = await estimate(marat, t.id, 22000);
  assert.equal(r.status, 201); assert.equal(r.body.status, 'AWAITING_OWNER_APPROVAL');
});

test('мастер отказывается после отклонённой сметы: с причиной; заявка возвращается владельцу без исполнителя, владелец выбирает другого', async () => {
  const t = await newRepair();
  await estimate(marat, t.id, 30000);
  await decide(t.id, false, 'Дорого');
  assert.equal((await st(marat, t.id, 'decline', {})).status, 400, 'причина обязательна');
  const d = await st(marat, t.id, 'decline', { reason: 'Не смогу дешевле' });
  assert.equal(d.status, 200); assert.equal(d.body.declined, true);
  const mt = await A().get(`/api/admin/repairs/${t.id}`).set(owner.auth);
  assert.equal(mt.body.status, 'NEW'); assert.equal(mt.body.executor, null); assert.ok(mt.body.declinedAt);
  assert.equal((await A().get(`/api/staff/repairs/${t.id}`).set(marat.auth)).status, 403, 'бывший мастер заявку больше не видит');
  await events.idle();
  const n = await prisma.notificationLog.findFirst({ where: { event: 'repair.declined', recipientType: 'owner' }, orderBy: { createdAt: 'desc' } });
  assert.match(n.text, /отказался/); assert.match(n.text, /Не смогу дешевле/);
  const a = await A().post(`/api/admin/repairs/${t.id}/assign`).set(owner.auth).send({ assigneeId: erlan.me.user.id });
  assert.equal(a.status, 200); assert.equal(a.body.executor.id, erlan.me.user.id); assert.equal(a.body.status, 'NEW');
  assert.ok((await A().get(`/api/staff/repairs/${t.id}`).set(erlan.auth)).body.actions.includes('estimate:REMOTE'));
});

test('подготовка: чек-лист из шаблона + пункт квартиры; нельзя закончить с неотмеченными / без обязательного фото без комментария; выплата по размеру', async () => {
  const put = await A().put('/api/admin/settings').set(owner.auth).send({
    cleaningChecklist: [{ label: 'Смена белья', photo: false }, { label: 'Ванная и туалет', photo: true }],
    cleaningRates: { [apt.rooms]: 6500 }, cleaningRateKzt: 5000,
  });
  assert.equal(put.status, 200); assert.equal(put.body.cleaningChecklist.length, 2);
  assert.equal((await A().patch(`/api/admin/apartments/${apt.id}`).set(owner.auth).send({ cleaningExtraItems: [{ label: 'Полить цветы', photo: false }] })).status, 200);
  const t = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, assigneeId: gulnara.me.user.id, date: new Date(isoIn(0) + 'T00:00:00Z') } });
  const s = await A().post(`/api/staff/cleaning/${t.id}/start`).set(gulnara.auth);
  assert.equal(s.status, 200); assert.ok(s.body.startedAt);
  assert.deepEqual(s.body.checklist.map(x => x.label), ['Смена белья', 'Ванная и туалет', 'Полить цветы']);
  assert.match(s.body.title, /^Подготовка кв\. /);
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({})).status, 409, 'ничего не отмечено');
  for (const index of [0, 1, 2]) assert.equal((await A().post(`/api/staff/cleaning/${t.id}/check`).set(gulnara.auth).send({ index, done: true })).status, 200);
  const f1 = await A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({});
  assert.equal(f1.status, 409); assert.match(f1.body.error, /нужно фото/);
  const ph = await A().post(`/api/staff/cleaning/${t.id}/photos`).set(gulnara.auth).field('itemIndex', '1').attach('photos', png(), { filename: 'bath.png', contentType: 'image/png' });
  assert.equal(ph.status, 201);
  // проблема с фото → владелец одним нажатием делает заявку мастеру
  const pph = await A().post(`/api/staff/cleaning/${t.id}/photos`).set(gulnara.auth).field('kind', 'problem').attach('photos', png(), { filename: 'leak.png', contentType: 'image/png' });
  const pr = await A().post(`/api/staff/cleaning/${t.id}/problem`).set(gulnara.auth).send({ text: 'Сломана ручка окна', photoIds: [pph.body[0].id] });
  assert.equal(pr.status, 201);
  const f2 = await A().post(`/api/staff/cleaning/${t.id}/finish`).set(gulnara.auth).send({ report: 'Готово' });
  assert.equal(f2.status, 200); assert.equal(f2.body.status, 'done'); assert.ok(f2.body.doneAt);
  await events.idle();
  // полный отчёт в админке
  const rep = (await A().get(`/api/admin/cleaning-tasks/${t.id}`).set(owner.auth)).body;
  assert.equal(rep.assignee.name, gulnara.me.user.name); assert.ok(rep.startedAt && rep.doneAt);
  assert.ok(rep.checklist.every(x => x.done)); assert.equal(rep.checklist[1].photos.length, 1);
  assert.equal(rep.problems.length, 1); assert.equal(rep.problems[0].photos.length, 1);
  assert.equal(rep.payout.amountKzt, 6500, 'ставка по размеру квартиры'); assert.equal(rep.payout.status, 'PENDING');
  const mk = await A().post(`/api/admin/cleaning-tasks/${t.id}/problems/${rep.problems[0].id}/repair`).set(admin.auth);
  assert.equal(mk.status, 201);
  const rt = await A().get(`/api/admin/repairs/${mk.body.repairTaskId}`).set(owner.auth);
  assert.equal(rt.body.status, 'NEW'); assert.equal(rt.body.executor, null); assert.equal(rt.body.photos.filter(p => p.kind === 'problem').length, 1);
  const msg = await prisma.notificationLog.findFirst({ where: { event: 'payout.created', text: { contains: 'закончила подготовку' } }, orderBy: { createdAt: 'desc' } });
  assert.match(msg.text, /Гульнара .*закончила подготовку кв\. .* — к оплате .*6 500 ₸/);
  const cl = await prisma.notificationLog.findFirst({ where: { event: 'cleaning.reported' }, orderBy: { createdAt: 'desc' } });
  assert.match(cl.text, /Подготовка кв\. .* — Гульнара/);
  // свои выплаты — в приложении команды
  const mine = (await A().get('/api/staff/payouts').set(gulnara.auth)).body;
  assert.ok(mine.items.some(x => x.cleaningTaskId === t.id && x.statusLabel === 'К оплате'));
  // экран «Выплаты» владельца: всё человеку одной кнопкой
  const list = (await A().get('/api/admin/payouts').set(owner.auth)).body;
  assert.ok(list.people.some(p => p.userId === gulnara.me.user.id && p.pendingKzt >= 6500));
  assert.equal((await A().get('/api/admin/payouts').set(admin.auth)).status, 200);
  const all = await A().post('/api/admin/payouts/pay-all').set(owner.auth).send({ userId: gulnara.me.user.id, method: 'cash' });
  assert.ok(all.body.paid >= 1);
  assert.equal((await prisma.payout.findUnique({ where: { cleaningTaskId: t.id } })).status, 'PAID');
  // закончить с неотмеченным — только с комментарием
  const t2 = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, assigneeId: gulnara.me.user.id, date: new Date(isoIn(0) + 'T00:00:00Z') } });
  await A().post(`/api/staff/cleaning/${t2.id}/start`).set(gulnara.auth);
  const f3 = await A().post(`/api/staff/cleaning/${t2.id}/finish`).set(gulnara.auth).send({ note: 'Не было белья на складе' });
  assert.equal(f3.status, 200); assert.equal(f3.body.finishNote, 'Не было белья на складе');
  await A().put('/api/admin/settings').set(owner.auth).send({ cleaningChecklist: null });
});

test('выплаты: работу делал владелец — выплаты нет; напоминание о невыплаченном через 3 часа', async () => {
  const t = await prisma.cleaningTask.create({ data: { accountId: acc.id, apartmentId: apt.id, assigneeId: ownerUser.id, date: new Date(isoIn(0) + 'T00:00:00Z') } });
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/finish`).set(owner.auth).send({ note: 'сам' })).status, 409, 'закончить, не начав, нельзя');
  assert.equal((await A().post(`/api/staff/cleaning/${t.id}/start`).set(owner.auth)).status, 200);
  const f = await A().post(`/api/staff/cleaning/${t.id}/finish`).set(owner.auth).send({ note: 'сам' });
  assert.equal(f.status, 200);
  assert.equal(await prisma.payout.count({ where: { cleaningTaskId: t.id } }), 0, 'владелец сам себе не платит');
  const r = await newRepair({ assigneeId: null });
  assert.equal((await A().post(`/api/admin/repairs/${r.id}/assign`).set(owner.auth).send({ assigneeId: ownerUser.id })).status, 200, 'владелец может взять заявку себе');
  await prisma.repairTask.update({ where: { id: r.id }, data: { status: 'DONE', finalCostKzt: 9000 } });
  await app.locals.payouts.forRepair(r.id);
  assert.equal(await prisma.payout.count({ where: { repairTaskId: r.id } }), 0);
  // напоминание
  const p = await prisma.payout.create({ data: { accountId: acc.id, kind: 'cleaning', userId: gulnara.me.user.id, name: 'Гульнара', title: 'Подготовка тест', amountKzt: 4000 } });
  await app.locals.payouts.remind(new Date(Date.now() + 3600000));
  assert.equal((await prisma.payout.findUnique({ where: { id: p.id } })).remindedAt, null, 'через час — рано');
  await app.locals.payouts.remind(new Date(Date.now() + 3.1 * 3600000));
  assert.ok((await prisma.payout.findUnique({ where: { id: p.id } })).remindedAt, 'через 3 часа — напомнили');
  await events.idle();
  const n = await prisma.notificationLog.findFirst({ where: { event: 'payout.reminder', dedupeKey: { startsWith: `payout.reminder:${p.id}` } } });
  assert.match(n.text, /Не выплачено больше 3 ч/);
  const list = (await A().get('/api/admin/payouts?status=PENDING').set(owner.auth)).body;
  assert.ok(list.items.length > 0);
});

test('трансфер: заказ видят и могут взять только водители, у которых помещаются пассажиры и багаж; внешние водители выключены', async () => {
  const tr = await prisma.transfer.create({ data: { accountId: acc.id, apartmentId: apt.id, direction: 'in', place: 'airport', date: new Date(isoIn(5) + 'T00:00:00Z'), time: '15:40', pax: 6, bags: 5, priceKzt: 15000, guestName: 'Семья', status: 'planned' } });
  const job = await app.locals.dispatch.createForTransfer({ accountId: acc.id, transferId: tr.id });
  await events.idle();
  const offered = await prisma.notificationLog.findMany({ where: { event: 'transfer.offered', dedupeKey: { startsWith: `transfer.offered:${job.id}:` } } });
  const to = offered.map(o => o.recipientId);
  assert.ok(to.includes(kanat.me.user.id), 'минивэн на 7 мест'); assert.ok(!to.includes(ruslan.me.user.id), 'седан на 4 места — нет');
  assert.ok(!(await A().get('/api/staff/transfers').set(ruslan.auth)).body.offers.some(o => o.id === job.id));
  assert.ok((await A().get('/api/staff/transfers').set(kanat.auth)).body.offers.some(o => o.id === job.id));
  assert.equal((await A().post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth)).status, 403);
  // владелец меняет машину водителю — теперь подходит
  assert.equal((await A().patch(`/api/admin/team/${ruslan.me.user.id}`).set(owner.auth).send({ vehicleSeats: 7, vehicleBags: 6, vehicleClass: 'minivan' })).status, 200);
  assert.equal((await A().post(`/api/staff/transfers/${job.id}/accept`).set(ruslan.auth)).status, 200);
  await A().patch(`/api/admin/team/${ruslan.me.user.id}`).set(owner.auth).send({ vehicleSeats: 4, vehicleBags: 3, vehicleClass: 'sedan' });
  // выполнил наёмный водитель → «к оплате»
  await pickupSoon(job.id);
  for (const action of ['picked-up', 'done']) assert.equal((await A().post(`/api/admin/transfer-jobs/${job.id}/status`).set(owner.auth).send({ action })).status, 200);
  await events.idle();
  const p = await prisma.payout.findUnique({ where: { jobId: job.id } });
  assert.equal(p.kind, 'transfer'); assert.ok(p.amountKzt > 0); assert.match(p.title, /^Трансфер /);
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'payout.created', dedupeKey: { startsWith: `payout.created:${p.id}` } } }));
  // внешние водители скрыты и не назначаются
  const drivers = (await A().get('/api/admin/drivers').set(owner.auth)).body;
  assert.deepEqual(drivers.external, []);
  const ext = await prisma.contractor.create({ data: { accountId: acc.id, name: 'Такси тест', type: 'other', canDrive: true } });
  const tr2 = await prisma.transfer.create({ data: { accountId: acc.id, apartmentId: apt.id, direction: 'in', place: 'airport', date: new Date(isoIn(6) + 'T00:00:00Z'), time: '10:00', pax: 1, priceKzt: 8000, status: 'planned' } });
  const j2 = await app.locals.dispatch.createForTransfer({ accountId: acc.id, transferId: tr2.id });
  assert.equal((await A().post(`/api/admin/transfer-jobs/${j2.id}/assign`).set(owner.auth).send({ driverContractorId: ext.id })).status, 400);
  await prisma.contractor.delete({ where: { id: ext.id } });
});
