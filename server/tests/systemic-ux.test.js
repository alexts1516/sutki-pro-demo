import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request } from './helpers.js';
import { todayIn, addDays } from '../src/lib/dates.js';
const { app } = makeApp();
let account, owner, admin, cleaner, apartment;
const api = () => request(app);
before(async () => {
  account = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  [owner, admin, cleaner] = await Promise.all(['azamat', 'alina', 'gulnara'].map(x => login(app, `${x}@astanastay.example`)));
  apartment = await prisma.apartment.create({ data: { accountId: account.id, title: 'UX regression', address: 'Test', district: 'Test', rooms: 'Студия', maxGuests: 2, basePriceKzt: 10000 } });
});
after(() => prisma.$disconnect());
test('выплаты: admin читает, но все способы отметки запрещены без побочных эффектов', async () => {
  assert.equal((await api().get('/api/admin/payouts').set(admin.auth)).status, 200);
  for (const url of ['/api/admin/payouts/missing/pay', '/api/admin/payouts/pay-all', '/api/admin/repairs/missing/paid', '/api/admin/transfer-jobs/missing/paid']) {
    assert.equal((await api().post(url).set(admin.auth).send({ method: 'transfer', paid: true })).status, 403, url);
    assert.equal((await api().post(url).set(cleaner.auth).send({})).status, 403, url);
  }
});
test('назначение подготовки замыкает состояние; контакт возвращается только в разрешённом manager report', async () => {
  const task = await prisma.cleaningTask.create({ data: { accountId: account.id, apartmentId: apartment.id, date: todayIn(account.timezone) } });
  assert.equal((await api().patch(`/api/admin/cleaning-tasks/${task.id}`).set(cleaner.auth).send({ assigneeId: cleaner.me.user.id })).status, 403);
  const assigned = await api().patch(`/api/admin/cleaning-tasks/${task.id}`).set(admin.auth).send({ assigneeId: cleaner.me.user.id });
  assert.equal(assigned.status, 200); assert.equal(assigned.body.assigneeId, cleaner.me.user.id);
  const report = await api().get(`/api/admin/cleaning-tasks/${task.id}`).set(admin.auth);
  assert.equal(report.status, 200); assert.ok(report.body.assignee.phone);
  await prisma.cleaningTask.update({ where: { id: task.id }, data: { status: 'progress' } });
  assert.equal((await api().patch(`/api/admin/cleaning-tasks/${task.id}`).set(owner.auth).send({ assigneeId: null })).status, 409);
});
test('перенос ремонта сохраняет заявку и приоритет, запрещает занятый период, прошлое и начатые/закрытые работы', async () => {
  const today = todayIn(account.timezone), day = addDays(today, 400);
  const task = await prisma.repairTask.create({ data: { accountId: account.id, apartmentId: apartment.id, title: 'UX move', date: day, blockDays: 2 } });
  const url = `/api/admin/repairs/${task.id}/date`, target = addDays(day, 5).toISOString().slice(0, 10);
  assert.equal((await api().patch(url).set(cleaner.auth).send({ date: target })).status, 403);
  const moved = await api().patch(url).set(admin.auth).send({ date: target });
  assert.equal(moved.status, 200); assert.equal(moved.body.id, task.id);
  assert.ok(moved.body.events.some(e => e.type === 'rescheduled'));
  assert.equal((await api().patch(url).set(owner.auth).send({ date: '2099-02-31' })).status, 400);
  const stored = await prisma.repairTask.findUnique({ where: { id: task.id } });
  assert.equal(+stored.createdAt, +task.createdAt); assert.equal(stored.blockDays, 2);
  assert.equal((await api().patch(url).set(owner.auth).send({ date: addDays(today, -1).toISOString().slice(0, 10) })).status, 400);
  const booking = await prisma.booking.create({ data: { accountId: account.id, apartmentId: apartment.id, number: 99999001, token: 'ux-test-booking', source: 'site', status: 'confirmed', guestsCount: 1, checkIn: addDays(day, 20), checkOut: addDays(day, 22), nightlyKzt: 10000, totalKzt: 20000 } });
  assert.equal((await api().patch(url).set(owner.auth).send({ date: addDays(day, 19).toISOString().slice(0, 10) })).status, 409, 'два дня ремонта пересекают бронь');
  assert.equal((await prisma.booking.findUnique({ where: { id: booking.id } })).status, 'confirmed');
  for (const status of ['IN_PROGRESS', 'DONE', 'CANCELLED']) {
    await prisma.repairTask.update({ where: { id: task.id }, data: { status } });
    assert.equal((await api().patch(url).set(owner.auth).send({ date: target })).status, 409, status);
  }
});
