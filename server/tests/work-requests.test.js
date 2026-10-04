// Заявки мастерам: машина состояний, сметы (без выезда / по фото / после осмотра), quickJob, доп. расходы,
// «кто будет в квартире», изоляция исполнителей и то, что мастер видит только адрес и номер квартиры.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, png } from './helpers.js';

const { app, events } = makeApp();
let acc, apt, owner, admin, marat, erlan, electric, ownerB, contractor;
const A = () => request(app);

before(async () => {
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, code: { not: null }, lockCode: { not: null } }, orderBy: { sortOrder: 'asc' } });
  await prisma.apartment.update({ where: { id: apt.id }, data: { intercom: '45В', wifiPassword: 'wifi-secret-777', keyboxCode: 'KB-9911', lockCode: 'LK-4455' } });
  owner = await login(app, 'azamat@astanastay.example');
  admin = await login(app, 'alina@astanastay.example');
  marat = await login(app, 'marat@astanastay.example');
  erlan = await login(app, 'erlan@astanastay.example');
  electric = await login(app, 'electric@astanastay.example');
  ownerB = await login(app, 'owner@demo-b.example');
  contractor = await prisma.contractor.findFirst({ where: { accountId: acc.id, name: 'Master Electric' } });
});
after(() => prisma.$disconnect());

const create = async (who, body) => {
  const r = await A().post('/api/admin/repairs').set(who.auth).send({ apartmentId: apt.id, title: 'Тестовая заявка', description: 'Описание проблемы', type: 'elec', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
};
const st = (who, id, step, body = {}) => A().post(`/api/staff/repairs/${id}/${step}`).set(who.auth).send(body);
const card = (who, id) => A().get(`/api/staff/repairs/${id}`).set(who.auth);
const adminCard = async (id) => (await A().get(`/api/admin/repairs/${id}`).set(owner.auth)).body;
const lastEstimate = (t) => t.estimates.at(-1);
const SECRETS = /LK-4455|wifi-secret-777|KB-9911|45В|lockCode|wifiPassword|keyboxCode|intercom|keySafe/;

test('смета без выезда с материалами → одобрение → работа → выполнено; сумма уходит в финансы', async () => {
  const t = await create(owner, { contractorId: contractor.id, title: 'Повесить бра' });
  assert.equal(t.status, 'NEW'); assert.equal(t.statusLabel, 'Новая');
  const e = await st(electric, t.id, 'estimate', { method: 'REMOTE', labourKzt: 10000, materialsIncluded: true, materialsKzt: 4000, maxKzt: 16000, items: 'Бра, дюбели', comment: 'Если стена бетон — ближе к верхней цене' });
  assert.equal(e.status, 201);
  assert.equal(e.body.status, 'AWAITING_OWNER_APPROVAL'); assert.equal(e.body.statusLabel, 'Ждёт одобрения сметы');
  const est = lastEstimate(e.body);
  assert.deepEqual([est.method, est.labourKzt, est.materialsKzt, est.totalKzt, est.maxKzt, est.materialsIncluded, est.preliminary], ['REMOTE', 10000, 4000, 14000, 16000, true, true]);
  // материалы без флага — ошибка; материалы необязательны
  const t2 = await create(owner, { contractorId: contractor.id });
  assert.equal((await st(electric, t2.id, 'estimate', { method: 'REMOTE', labourKzt: 5000, materialsKzt: 100 })).status, 400);
  const noMat = await st(electric, t2.id, 'estimate', { method: 'REMOTE', labourKzt: 5000 });
  assert.equal(lastEstimate(noMat.body).materialsKzt, null); assert.equal(lastEstimate(noMat.body).totalKzt, 5000);

  const ap = await A().post(`/api/admin/estimates/${est.id}/approve`).set(owner.auth);
  assert.equal(ap.body.status, 'APPROVED'); assert.equal(ap.body.costKzt, 14000);
  assert.equal((await st(electric, t.id, 'start')).body.status, 'IN_PROGRESS');
  assert.equal((await st(electric, t.id, 'complete', { report: 'Без цены' })).status, 400, 'итоговая цена обязательна');
  const done = await st(electric, t.id, 'complete', { finalCostKzt: 15000, report: 'Повесил бра, проверил' });
  assert.equal(done.body.status, 'DONE'); assert.equal(done.body.payableKzt, 15000);
  const full = await adminCard(t.id);
  assert.equal(full.costKzt, 15000);
  assert.deepEqual(full.events.map(x => x.type), ['created', 'occupancy_changed', 'estimate_submitted', 'approved', 'started', 'completed']);   // смета без выезда — «приехал» не нужен
  assert.ok(full.events.every(x => x.actorName && x.createdAt), 'у каждого шага есть кто и когда');
  assert.equal(full.events.find(x => x.type === 'approved').actorType, 'owner');
  const month = new Date(full.date).toISOString().slice(0, 7);
  const fin = await A().get(`/api/admin/finance?month=${month}`).set(owner.auth);
  assert.ok(fin.body.repairsKzt >= 15000);
});

test('без одобренной сметы начать нельзя ни в одном статусе; отказ → новая смета', async () => {
  const t = await create(admin, { contractorId: contractor.id });
  assert.equal((await st(electric, t.id, 'start')).status, 409, 'NEW');
  const e = await st(electric, t.id, 'estimate', { method: 'REMOTE', labourKzt: 30000 });
  assert.equal((await st(electric, t.id, 'start')).status, 409, 'AWAITING_OWNER_APPROVAL');
  assert.equal((await A().post(`/api/admin/estimates/${lastEstimate(e.body).id}/reject`).set(owner.auth).send({})).status, 400, 'причина отказа обязательна');
  const rj = await A().post(`/api/admin/estimates/${lastEstimate(e.body).id}/reject`).set(owner.auth).send({ reason: 'Дорого' });
  assert.equal(rj.body.status, 'REJECTED'); assert.equal(lastEstimate(rj.body).rejectReason, 'Дорого');
  const r1 = await st(electric, t.id, 'start');
  assert.equal(r1.status, 409); assert.match(r1.body.error, /без одобренной хозяином сметы/);
  const e2 = await st(electric, t.id, 'estimate', { method: 'REMOTE', labourKzt: 20000 });
  assert.equal(e2.body.status, 'AWAITING_OWNER_APPROVAL'); assert.equal(e2.body.estimates.length, 2);
  // владелец/админ не может «начать» за мастера — шаги только у исполнителя
  assert.equal((await st(owner, t.id, 'start')).status, 403);
  // не-quickJob в выезде без сметы — тоже нельзя
  const t3 = await create(owner, { contractorId: contractor.id });
  await st(electric, t3.id, 'arrive', { note: 'На месте' });
  assert.equal((await card(electric, t3.id)).body.status, 'VISIT_INSPECTION');
  assert.equal((await st(electric, t3.id, 'start')).status, 409);
});

test('путь с выездом: нужен выезд → приезд → осмотр → смета → одобрение → работа', async () => {
  const t = await create(owner, { contractorId: contractor.id });
  const v = await st(electric, t.id, 'request-visit', { note: 'Нужно посмотреть щиток' });
  assert.equal(v.body.status, 'VISIT_INSPECTION'); assert.ok(v.body.visitRequestedAt);
  assert.equal((await st(electric, t.id, 'estimate', { method: 'VISIT', labourKzt: 9000 })).status, 409, 'смета после осмотра — только после приезда');
  assert.equal((await st(electric, t.id, 'estimate', { method: 'REMOTE', labourKzt: 9000 })).status, 409, 'в выезде — только смета VISIT');
  assert.equal((await st(electric, t.id, 'inspect', { notes: 'x' })).status, 400);
  assert.equal((await st(electric, t.id, 'inspect', { notes: 'Осмотр до приезда' })).status, 409);
  const ar = await st(electric, t.id, 'arrive', { note: 'Приехал в 10:05' });
  assert.ok(ar.body.arrivedAt);
  await st(electric, t.id, 'inspect', { notes: 'Окислилась клемма автомата' });
  const e = await st(electric, t.id, 'estimate', { method: 'VISIT', labourKzt: 7000, materialsIncluded: true, materialsKzt: 4500 });
  assert.equal(lastEstimate(e.body).method, 'VISIT');
  await A().post(`/api/admin/estimates/${lastEstimate(e.body).id}/approve`).set(admin.auth);
  assert.equal((await st(electric, t.id, 'start')).body.status, 'IN_PROGRESS');
  const types = (await adminCard(t.id)).events.map(x => x.type);
  for (const k of ['visit_requested', 'arrived', 'inspected', 'estimate_submitted', 'approved', 'started']) assert.ok(types.includes(k), k);
});

test('quickJob: без сметы, но только после отметки приезда; итог обязателен', async () => {
  const t = await create(owner, { contractorId: contractor.id, title: 'Заменить лампочку', quickJob: true });
  assert.equal(t.quickJob, true);
  const s0 = await st(electric, t.id, 'start');
  assert.equal(s0.status, 409); assert.match(s0.body.error, /отметьте приезд/);
  await st(electric, t.id, 'arrive');
  const s1 = await st(electric, t.id, 'start');
  assert.equal(s1.status, 200); assert.equal(s1.body.status, 'IN_PROGRESS'); assert.equal(s1.body.estimates.length, 0);
  const d = await st(electric, t.id, 'complete', { finalCostKzt: 2500, report: 'Заменил лампу E27' });
  assert.equal(d.body.status, 'DONE');
  const full = await adminCard(t.id);
  assert.equal(full.costKzt, 2500);
  assert.deepEqual(full.events.find(x => x.type === 'started').data, { quickJob: true });
  assert.ok(full.events.some(x => x.type === 'arrived'));
  // обычная заявка так не может
  const n = await create(owner, { contractorId: contractor.id });
  await st(electric, n.id, 'arrive');
  assert.equal((await st(electric, n.id, 'start')).status, 409);
});

test('доп. расходы: одобренный прибавляется, отклонённый нет; нерешённый не мешает завершить, но мешает оплате', async () => {
  const t = await create(owner, { contractorId: contractor.id });
  const e = await st(electric, t.id, 'estimate', { method: 'REMOTE', labourKzt: 10000 });
  assert.equal((await st(electric, t.id, 'extras', { amountKzt: 1000, description: 'Кабель', reason: 'Не по вине' })).status, 409, 'до начала работ нельзя');
  await A().post(`/api/admin/estimates/${lastEstimate(e.body).id}/approve`).set(owner.auth);
  await st(electric, t.id, 'start');
  const ph = await A().post(`/api/staff/repairs/${t.id}/photos`).set(electric.auth).field('kind', 'receipt').attach('photos', png(), { filename: 'check.png', contentType: 'image/png' });
  assert.equal(ph.status, 201);
  const x1 = await st(electric, t.id, 'extras', { amountKzt: 6000, description: 'Замена шины', reason: 'Подгорела, видно только при вскрытии', photoIds: [ph.body[0].id] });
  assert.equal(x1.status, 201);
  const x2 = await st(electric, t.id, 'extras', { amountKzt: 3000, description: 'Ещё автомат', reason: 'Старый треснул' });
  const x3 = await st(electric, t.id, 'extras', { amountKzt: 1500, description: 'Клеммы', reason: 'Скрутки' });
  const [e1, e2, e3] = x3.body.extras;
  assert.equal(e1.photos.length, 1, 'чек прикреплён к расходу');
  assert.equal((await A().post(`/api/admin/extras/${e1.id}/approve`).set(electric.auth)).status, 403, 'мастер сам себе не одобряет');
  assert.equal((await A().post(`/api/admin/extras/${e2.id}/reject`).set(owner.auth).send({})).status, 400, 'причина отказа обязательна');
  let c = (await A().post(`/api/admin/extras/${e1.id}/approve`).set(owner.auth)).body;
  assert.equal(c.costKzt, 16000);
  c = (await A().post(`/api/admin/extras/${e2.id}/reject`).set(admin.auth).send({ note: 'Автомат был исправен' })).body;
  assert.equal(c.costKzt, 16000, 'отклонённый не прибавляется');
  const done = await st(electric, t.id, 'complete', { finalCostKzt: 11000, report: 'Готово' });
  assert.equal(done.body.status, 'DONE', 'нерешённый расход не мешает завершению');
  assert.equal(done.body.payableKzt, 17000);
  const p1 = await A().post(`/api/admin/repairs/${t.id}/paid`).set(owner.auth);
  assert.equal(p1.status, 409); assert.match(p1.body.error, /доп\. расходы/);
  c = (await A().post(`/api/admin/extras/${e3.id}/approve`).set(owner.auth)).body;
  assert.equal(c.costKzt, 18500); assert.equal(c.payableKzt, 18500);
  const p2 = await A().post(`/api/admin/repairs/${t.id}/paid`).set(owner.auth);
  assert.equal(p2.status, 200); assert.equal(p2.body.paid, true);
  assert.equal((await A().post(`/api/admin/extras/${e3.id}/approve`).set(owner.auth)).status, 409);
  const types = p2.body.events.map(x => x.type);
  assert.deepEqual(types.filter(x => x.startsWith('extra')), ['extra_submitted', 'extra_submitted', 'extra_submitted', 'extra_approved', 'extra_rejected', 'extra_approved']);
  await events.idle();
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'extra.submitted', recipientType: 'owner', text: { contains: 'Замена шины' } } }), 'владелец уведомлён');
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'extra.decided', recipientType: 'master', recipientId: electric.me.user.id } }), 'мастер уведомлён');
});

test('смета по фото: фото видит только назначенный мастер; фото → смета → одобрение; фото → нужен выезд', async () => {
  const t = await create(owner, { assigneeId: marat.me.user.id, title: 'Капает смеситель', type: 'plumb' });
  assert.equal((await st(marat, t.id, 'estimate', { method: 'PHOTOS', labourKzt: 5000 })).status, 409, 'без фото проблемы смета по фото невозможна');
  const up = await A().post(`/api/admin/repairs/${t.id}/photos`).set(admin.auth)
    .attach('photos', png(10, 8, [10, 120, 200]), { filename: 'a.png', contentType: 'image/png' }).field('captions', 'Смеситель')
    .attach('photos', png(10, 8, [200, 120, 10]), { filename: 'b.png', contentType: 'image/png' }).field('captions', 'Под раковиной');
  assert.equal(up.status, 201); assert.equal(up.body.photos.filter(p => p.kind === 'problem').length, 2);
  assert.equal(up.body.photos[0].caption, 'Смеситель');
  // мастер не может загрузить «фото проблемы»
  assert.equal((await A().post(`/api/staff/repairs/${t.id}/photos`).set(marat.auth).field('kind', 'problem').attach('photos', png(), { filename: 'x.png', contentType: 'image/png' })).status, 400);
  const mine = await card(marat, t.id);
  assert.equal(mine.body.photos.length, 2); assert.ok(mine.body.actions.includes('estimate:PHOTOS'));
  assert.equal((await card(erlan, t.id)).status, 403, 'чужой мастер не видит');
  assert.equal((await card(electric, t.id)).status, 403, 'подрядчик не видит');
  const list = await A().get('/api/staff/tasks').set(erlan.auth);
  assert.ok(!list.body.repairs.some(x => x.id === t.id));
  const e = await st(marat, t.id, 'estimate', { method: 'PHOTOS', labourKzt: 6000, materialsIncluded: true, materialsKzt: 2000, comment: 'По фото — картридж' });
  assert.equal(lastEstimate(e.body).method, 'PHOTOS');
  const ap = await A().post(`/api/admin/estimates/${lastEstimate(e.body).id}/approve`).set(owner.auth);
  assert.equal(ap.body.status, 'APPROVED');
  await events.idle();
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'estimate.submitted', recipientType: 'owner', text: { contains: 'по фото' } } }));

  // по фото не понять → мастер просит выезд
  const t2 = await create(owner, { assigneeId: marat.me.user.id, title: 'Шумит труба' });
  await A().post(`/api/admin/repairs/${t2.id}/photos`).set(owner.auth).attach('photos', png(), { filename: 'c.png', contentType: 'image/png' });
  const v = await st(marat, t2.id, 'request-visit', { note: 'По фото не видно, откуда шум' });
  assert.equal(v.body.status, 'VISIT_INSPECTION');
  const evv = v.body.events.find(x => x.type === 'visit_requested');
  assert.equal(evv.note, 'По фото не видно, откуда шум'); assert.equal(evv.actorType, 'master');
  assert.equal((await st(marat, t2.id, 'estimate', { method: 'PHOTOS', labourKzt: 1 })).status, 409, 'после запроса выезда — смета только после осмотра');
  await events.idle();
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'repair.visit_requested', text: { contains: 'По фото не видно' } } }));
});

test('мастер видит только адрес и номер квартиры — и только по своим активным заявкам', async () => {
  const t = await create(owner, { contractorId: contractor.id });
  const c = await card(electric, t.id);
  assert.equal(c.status, 200);
  assert.deepEqual(Object.keys(c.body.access).sort(), ['address', 'apartmentNumber']);
  assert.equal(c.body.access.address, apt.address); assert.equal(c.body.access.apartmentNumber, apt.code);
  assert.deepEqual(Object.keys(c.body.apartment).sort(), ['complex', 'id', 'title']);
  assert.doesNotMatch(JSON.stringify(c.body), SECRETS);
  assert.doesNotMatch(JSON.stringify((await A().get('/api/staff/tasks').set(electric.auth)).body), SECRETS);
  assert.ok(!('costKzt' in c.body) && !('paid' in c.body) && !('link' in c.body));
  // ответы на шаги — тоже без лишнего
  assert.doesNotMatch(JSON.stringify((await st(electric, t.id, 'arrive')).body), SECRETS);
  // после закрытия — адреса нет
  await A().post(`/api/admin/repairs/${t.id}/cancel`).set(owner.auth).send({ reason: 'Тест' });
  const closed = await card(electric, t.id);
  assert.equal(closed.body.status, 'CANCELLED'); assert.equal(closed.body.access, null); assert.deepEqual(closed.body.actions, []);
  // чужие — 403
  assert.equal((await card(marat, t.id)).status, 403);
  // ссылка на задачу: то же самое без входа; после закрытия — 410
  const t2 = await create(owner, { contractorId: contractor.id });
  const token = (await adminCard(t2.id)).link.token;
  const viaLink = await A().get(`/api/task-link/${token}`);
  assert.equal(viaLink.status, 200); assert.deepEqual(Object.keys(viaLink.body.access).sort(), ['address', 'apartmentNumber']);
  assert.doesNotMatch(JSON.stringify(viaLink.body), SECRETS);
  assert.equal((await A().post(`/api/task-link/${token}/start`)).status, 409, 'по ссылке тоже нельзя начать без сметы');
  const e = await A().post(`/api/task-link/${token}/estimate`).send({ method: 'REMOTE', labourKzt: 4000 });
  assert.equal(e.status, 201); assert.equal(e.body.events.at(-1).actorType, 'link'); assert.equal(e.body.events.at(-1).actorName, 'Master Electric');
  await A().post(`/api/admin/repairs/${t2.id}/cancel`).set(owner.auth).send({});
  assert.equal((await A().get(`/api/task-link/${token}`)).status, 410);
  assert.equal((await A().get('/api/task-link/not-a-real-token-123456')).status, 404);
});

test('изоляция: подрядчик видит только свои заявки, другой аккаунт — ничего', async () => {
  const list = await A().get('/api/staff/tasks').set(electric.auth);
  const ids = list.body.repairs.map(x => x.id);
  const own = await prisma.repairTask.findMany({ where: { contractorId: contractor.id, status: { notIn: ['DONE', 'CANCELLED'] } }, select: { id: true } });
  assert.deepEqual(ids.sort(), own.map(x => x.id).sort());
  assert.ok(list.body.repairs.every(x => x.executor?.name === 'Master Electric'));
  const maratTask = await prisma.repairTask.findFirst({ where: { assigneeId: marat.me.user.id } });
  assert.equal((await card(electric, maratTask.id)).status, 403);
  assert.equal((await A().get('/api/admin/repairs').set(electric.auth)).status, 403, 'мастер не ходит в админку');
  const meTask = await prisma.repairTask.findFirst({ where: { contractorId: contractor.id } });
  assert.equal((await A().get(`/api/admin/repairs/${meTask.id}`).set(ownerB.auth)).status, 404);
  assert.equal((await card(ownerB, meTask.id)).status, 404);
});

test('«Кто будет в квартире»: правят владелец и админ, побеждает последнее изменение; мастер только читает', async () => {
  const t = await create(owner, { contractorId: contractor.id, occupancy: 'EMPTY', accessInstructions: 'Ключ у консьержа, блок G-1' });
  assert.equal(t.occupancy.status, 'EMPTY'); assert.equal(t.occupancy.updatedBy.name, owner.me.user.name);
  let m = (await card(electric, t.id)).body;
  assert.equal(m.occupancy.status, 'EMPTY'); assert.equal(m.occupancy.label, 'Квартира пустая');
  assert.equal(m.occupancy.accessInstructions, 'Ключ у консьержа, блок G-1'); assert.equal(m.occupancy.updatedBy.name, owner.me.user.name);

  const a1 = await A().patch(`/api/admin/repairs/${t.id}/occupancy`).set(admin.auth).send({ occupancy: 'OWNER_PRESENT' });
  assert.equal(a1.status, 200); assert.equal(a1.body.occupancy.status, 'OWNER_PRESENT');
  assert.equal(a1.body.occupancy.updatedBy.id, admin.me.user.id);
  assert.equal(a1.body.occupancy.accessInstructions, 'Ключ у консьержа, блок G-1', 'значение хранится');
  m = (await card(electric, t.id)).body;
  assert.equal(m.occupancy.status, 'OWNER_PRESENT'); assert.equal(m.occupancy.updatedBy.name, admin.me.user.name);
  assert.ok(!('accessInstructions' in m.occupancy), 'не EMPTY — инструкции мастеру не показываются');
  assert.doesNotMatch(JSON.stringify(m), /консьержа/);

  await new Promise(r => setTimeout(r, 5));
  const o1 = await A().patch(`/api/admin/repairs/${t.id}/occupancy`).set(owner.auth).send({ occupancy: 'EMPTY', accessInstructions: 'Ключ в почтовом ящике' });
  assert.equal(o1.body.occupancy.updatedBy.id, owner.me.user.id);
  assert.ok(new Date(o1.body.occupancy.updatedAt) > new Date(a1.body.occupancy.updatedAt));
  m = (await card(electric, t.id)).body;
  assert.equal(m.occupancy.accessInstructions, 'Ключ в почтовом ящике');
  const a2 = await A().patch(`/api/admin/repairs/${t.id}/occupancy`).set(admin.auth).send({ occupancy: 'UNKNOWN' });
  assert.equal(a2.body.occupancy.status, 'UNKNOWN'); assert.equal(a2.body.occupancy.updatedBy.id, admin.me.user.id);
  assert.equal(a2.body.events.filter(x => x.type === 'occupancy_changed').length, 4);
  assert.deepEqual(a2.body.events.filter(x => x.type === 'occupancy_changed').map(x => x.actorType), ['owner', 'admin', 'owner', 'admin']);

  // мастер не может менять: ни через админку, ни через приложение команды
  assert.equal((await A().patch(`/api/admin/repairs/${t.id}/occupancy`).set(electric.auth).send({ occupancy: 'EMPTY' })).status, 403);
  assert.equal((await A().patch(`/api/staff/repairs/${t.id}/occupancy`).set(electric.auth).send({ occupancy: 'EMPTY' })).status, 404);
  assert.equal((await A().post(`/api/staff/repairs/${t.id}/occupancy`).set(electric.auth).send({ occupancy: 'EMPTY' })).status, 404);
  // чужой мастер не видит
  assert.equal((await card(marat, t.id)).status, 403);
  // после закрытия заявки инструкции мастеру не отдаются даже при EMPTY
  await A().patch(`/api/admin/repairs/${t.id}/occupancy`).set(owner.auth).send({ occupancy: 'EMPTY' });
  await A().post(`/api/admin/repairs/${t.id}/cancel`).set(owner.auth).send({});
  assert.ok(!('accessInstructions' in (await card(electric, t.id)).body.occupancy));
  await events.idle();
  assert.ok(await prisma.notificationLog.findFirst({ where: { event: 'repair.occupancy_changed', recipientId: electric.me.user.id } }), 'мастеру уходит уведомление');
});

test('админка: список с русскими статусами и фильтром', async () => {
  const all = await A().get('/api/admin/repairs').set(admin.auth);
  assert.equal(all.status, 200);
  const statuses = new Set(all.body.map(x => x.status));
  for (const s of ['NEW', 'VISIT_INSPECTION', 'AWAITING_OWNER_APPROVAL', 'REJECTED', 'APPROVED', 'IN_PROGRESS', 'DONE', 'CANCELLED']) assert.ok(statuses.has(s), s);
  assert.ok(all.body.every(x => x.statusLabel));
  const aw = await A().get('/api/admin/repairs?status=AWAITING_OWNER_APPROVAL').set(admin.auth);
  assert.ok(aw.body.length > 0 && aw.body.every(x => x.status === 'AWAITING_OWNER_APPROVAL' && x.statusLabel === 'Ждёт одобрения сметы'));
  assert.ok(aw.body.some(x => x.pendingEstimate));
});
