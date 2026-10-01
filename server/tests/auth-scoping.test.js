// Вход, роли и изоляция аккаунтов.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request } from './helpers.js';

const { app } = makeApp();
let owner, admin, cleaner, master, ownerB, accA;
before(async () => {
  owner = await login(app, 'azamat@astanastay.example');
  admin = await login(app, 'alina@astanastay.example');
  cleaner = await login(app, 'gulnara@astanastay.example');
  master = await login(app, 'marat@astanastay.example');
  ownerB = await login(app, 'owner@demo-b.example');
  accA = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
});
after(() => prisma.$disconnect());

test('вход: неверный пароль → 401, без токена → 401, битый токен → 401', async () => {
  assert.equal((await request(app).post('/api/auth/login').send({ login: 'azamat@astanastay.example', password: 'wrong' })).status, 401);
  assert.equal((await request(app).get('/api/admin/apartments')).status, 401);
  assert.equal((await request(app).get('/api/admin/apartments').set('Authorization', 'Bearer abc.def.ghi')).status, 401);
});

test('вход по телефону и /me с ролью', async () => {
  const r = await request(app).post('/api/auth/login').send({ login: '+7 702 311 45 67', password: 'demo12345' });
  assert.equal(r.status, 200); assert.equal(r.body.role, 'admin');
  const me = await request(app).get('/api/auth/me').set(owner.auth);
  assert.equal(me.body.role, 'owner'); assert.equal(me.body.account.slug, 'astana-stay');
});

test('cookie-сессия работает для админки в браузере', async () => {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ login: 'azamat@astanastay.example', password: 'demo12345' });
  assert.match(r.headers['set-cookie'].join(';'), /sp_token=.*HttpOnly/i);
  assert.equal((await agent.get('/api/admin/apartments')).status, 200);
  await agent.post('/api/auth/logout');
});

test('клининг и мастер не видят админку и финансы', async () => {
  for (const u of [cleaner, master]) {
    for (const p of ['/api/admin/apartments', '/api/admin/finance', '/api/admin/bookings', '/api/admin/payments', '/api/admin/site-texts', '/api/admin/team']) {
      assert.equal((await request(app).get(p).set(u.auth)).status, 403, `${u.me.role} ${p}`);
    }
  }
});

test('администратор не видит финансы и платежи, владелец видит', async () => {
  assert.equal((await request(app).get('/api/admin/finance').set(admin.auth)).status, 403);
  assert.equal((await request(app).get('/api/admin/payments').set(admin.auth)).status, 403);
  assert.equal((await request(app).put('/api/admin/currency').set(admin.auth).send({ rates: { USD: 1 } })).status, 403);
  const f = await request(app).get('/api/admin/finance').set(owner.auth);
  assert.equal(f.status, 200); assert.ok(f.body.revenueKzt > 0);
});

test('клининг видит только свои уборки, без денег; чужую — 403', async () => {
  const r = await request(app).get('/api/staff/tasks').set(cleaner.auth);
  assert.equal(r.status, 200);
  assert.ok(r.body.cleaning.length > 0, 'есть свои уборки');
  assert.ok(r.body.cleaning.every(t => t.assigneeId === cleaner.me.user.id));
  assert.deepEqual(r.body.repairs, []);
  assert.doesNotMatch(JSON.stringify(r.body), /totalKzt|nightlyKzt|costKzt|revenue/);
  const other = await prisma.cleaningTask.findFirst({ where: { accountId: accA.id, NOT: { assigneeId: cleaner.me.user.id } } });
  assert.equal((await request(app).get(`/api/staff/cleaning/${other.id}`).set(cleaner.auth)).status, 403);
  assert.equal((await request(app).post(`/api/staff/cleaning/${other.id}/status`).set(cleaner.auth).send({ status: 'done' })).status, 403);
  const mine = r.body.cleaning[0];
  const card = await request(app).get(`/api/staff/cleaning/${mine.id}`).set(cleaner.auth);
  assert.equal(card.status, 200); assert.ok(card.body.access.lockCode, 'исполнитель видит код замка');
});

test('мастер видит только свои заявки, без стоимости', async () => {
  const r = await request(app).get('/api/staff/tasks').set(master.auth);
  assert.ok(r.body.repairs.length > 0);
  const mine = await prisma.repairTask.findMany({ where: { assigneeId: master.me.user.id }, select: { id: true } });
  assert.ok(r.body.repairs.every(t => mine.some(m => m.id === t.id)));
  assert.ok(r.body.repairs.every(t => !('costKzt' in t) && !('paid' in t)));
  assert.deepEqual(r.body.cleaning, []);
  const other = await prisma.repairTask.findFirst({ where: { accountId: accA.id, OR: [{ assigneeId: null }, { NOT: { assigneeId: master.me.user.id } }] } });
  assert.equal((await request(app).get(`/api/staff/repairs/${other.id}`).set(master.auth)).status, 403);
  assert.equal((await request(app).post(`/api/staff/repairs/${other.id}/start`).set(master.auth)).status, 403);
});

test('аккаунт Б не видит данные аккаунта А (и наоборот)', async () => {
  const listB = await request(app).get('/api/admin/apartments').set(ownerB.auth);
  assert.equal(listB.body.length, 2);
  const aptA = await prisma.apartment.findFirst({ where: { accountId: accA.id }, include: { photos: true } });
  assert.equal((await request(app).get(`/api/admin/apartments/${aptA.id}`).set(ownerB.auth)).status, 404);
  assert.equal((await request(app).patch(`/api/admin/apartments/${aptA.id}`).set(ownerB.auth).send({ title: 'взлом' })).status, 404);
  assert.equal((await request(app).delete(`/api/admin/photos/${aptA.photos[0].id}`).set(ownerB.auth)).status, 404);
  const bookA = await prisma.booking.findFirst({ where: { accountId: accA.id, status: 'request' } });
  assert.equal((await request(app).post(`/api/admin/bookings/${bookA.id}/confirm`).set(ownerB.auth)).status, 404);
  const bookingsB = await request(app).get('/api/admin/bookings').set(ownerB.auth);
  assert.ok(bookingsB.body.every(b => b.number === 1001));
  const notifB = await request(app).get('/api/admin/notifications').set(ownerB.auth);
  assert.ok(notifB.body.every(n => n.accountId !== accA.id));
  const pubB = await request(app).get('/api/public/demo-b/apartments');
  assert.equal(pubB.body.length, 2);
  assert.equal((await request(app).get(`/api/public/demo-b/apartments/${aptA.id}`)).status, 404);
  const listA = await request(app).get('/api/admin/apartments').set(owner.auth);
  assert.ok(listA.body.length >= 24 && listA.body.every(a => !a.title.startsWith('Алматы')));
});

test('отключённый сотрудник теряет доступ сразу; админ не может отключить владельца', async () => {
  const u = await prisma.user.findUnique({ where: { email: 'svetlana@astanastay.example' } });
  const s = await login(app, 'svetlana@astanastay.example');
  assert.equal((await request(app).patch(`/api/admin/team/${u.id}`).set(admin.auth).send({ active: false })).status, 200);
  assert.equal((await request(app).get('/api/staff/tasks').set(s.auth)).status, 401);
  await request(app).patch(`/api/admin/team/${u.id}`).set(admin.auth).send({ active: true });
  assert.equal((await request(app).patch(`/api/admin/team/${owner.me.user.id}`).set(admin.auth).send({ active: false })).status, 403);
  assert.equal((await request(app).post('/api/admin/team').set(admin.auth).send({ name: 'Новый Админ', email: 'x@astanastay.example', password: '12345678', role: 'admin' })).status, 403);
});

test('мягкая проверка сессии: без входа 200 { authenticated:false }, после входа — профиль', async () => {
  const anon = await request(app).get('/api/auth/session');
  assert.equal(anon.status, 200); assert.equal(anon.body.authenticated, false);
  const bad = await request(app).get('/api/auth/session').set('Cookie', 'sp_token=broken');
  assert.equal(bad.status, 200); assert.equal(bad.body.authenticated, false);
  const s = await request(app).get('/api/auth/session').set(owner.auth);
  assert.equal(s.status, 200); assert.equal(s.body.authenticated, true); assert.equal(s.body.role, 'owner');
});
