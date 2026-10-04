// Шаг 8: административная проекция, приоритет ранее принятой брони и actionable Today.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request } from './helpers.js';
import { todayView } from '../src/services/ops.js';
import { todayIn, addDays, isoDay } from '../src/lib/dates.js';
let app, owner, acc, apt, offset = 100;
before(async () => {
  ({ app } = makeApp()); owner = await login(app, 'azamat@astanastay.example');
  acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  apt = await prisma.apartment.create({ data: { accountId: acc.id, title: 'Шаг 8', address: 'Тест', district: 'Есиль', rooms: '1', basePriceKzt: 20000, maxGuests: 4 } });
});
after(async () => { await prisma.apartment.delete({ where: { id: apt.id } }).catch(() => {}); await prisma.$disconnect(); });
const post = (p, body = {}) => request(app).post('/api/admin' + p).set(owner.auth).send(body);
async function create(extra = {}) {
  const today = todayIn(acc.timezone); const n = offset; offset += 5;
  const r = await post('/booking-links', { apartmentId: apt.id, checkIn: isoDay(addDays(today, n)), checkOut: isoDay(addDays(today, n + 2)), guestsCount: 2, terms: 'cash_on_arrival', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return { ...r.body, token: r.body.url.split('/link/')[1] };
}
const guest = async c => {
  const r = await request(app).post(`/api/special-link/${c.token}/guest`).send({ name: 'Тестовый гость', phone: '+77015556677', acceptTerms: true }); assert.equal(r.status, 200);
  return request(app).post(`/api/special-link/${c.token}/submit`).send({});
};
const attention = async (c, role = 'owner') => { const v = await todayView(acc.id, { role }); return v.items.filter(i => i.ref === c.link.bookingId); };
test('шаг 8: список и карточка содержат LinkOut, история вне двух месяцев; секреты не возвращаются', async () => {
  const c = await create();
  const list = await request(app).get('/api/admin/bookings?source=link').set(owner.auth);
  const b = list.body.find(b => b.id === c.link.bookingId); assert.ok(b); assert.equal(b.link.stage, 'waiting_guest');
  const card = await request(app).get(`/api/admin/bookings/${b.id}`).set(owner.auth); assert.equal(card.body.link.id, c.link.id);
  for (const data of [b, card.body]) { const s = JSON.stringify(data); assert.ok(!s.includes(c.token)); assert.ok(!s.includes('tokenHash')); assert.ok(!s.includes('termsHash')); }
});
test('шаг 8: Today молчит при 24 ч; ≤3 ч action; ≤1 ч critical; истечение закрывает и освобождает', async () => {
  const c = await create(); assert.equal((await attention(c)).length, 0);
  for (const [hours, level] of [[3, 'action'], [1, 'critical']]) {
    await prisma.booking.update({ where: { id: c.link.bookingId }, data: { holdUntil: new Date(Date.now() + hours * 3600000) } });
    const items = await attention(c); assert.equal(items.find(i => i.kind === 'link_expiring')?.level, level);
  }
  await prisma.booking.update({ where: { id: c.link.bookingId }, data: { holdUntil: new Date(Date.now() - 1000) } });
  assert.equal((await attention(c)).length, 0);
  const b = await prisma.booking.findUnique({ where: { id: c.link.bookingId }, include: { link: true } }); assert.equal(b.status, 'cancelled'); assert.equal(b.link.status, 'expired');
});
test('шаг 8: extra-check появляется после отправки; отметка завершает обычную Booking', async () => {
  const c = await create({ extraCheckRequired: true, extraCheckNote: 'Подтвердите звонком' });
  assert.equal((await attention(c)).length, 0); assert.equal((await guest(c)).status, 200);
  assert.ok((await attention(c)).some(i => i.kind === 'link_waiting_admin'));
  assert.equal((await post(`/booking-links/${c.link.id}/extra-check`)).status, 200);
  assert.equal((await prisma.booking.findUnique({ where: { id: c.link.bookingId } })).status, 'confirmed');
  assert.equal((await attention(c)).length, 0);
});
test('шаг 8: поздний ремонт не мешает гостю, конфликт виден owner/admin до и после подтверждения; одна подготовка', async () => {
  const c = await create(); const b = await prisma.booking.findUnique({ where: { id: c.link.bookingId } });
  const rep = await prisma.repairTask.create({ data: { accountId: acc.id, apartmentId: apt.id, title: 'Поздний ремонт', date: b.checkIn, blockDays: 1, createdAt: new Date(+b.createdAt + 1) } });
  try {
    for (const role of ['owner', 'admin']) assert.ok((await attention(c, role)).some(i => i.kind === 'link_conflict'));
    const g = await guest(c); assert.equal(g.status, 200, JSON.stringify(g.body)); assert.equal(g.body.status, 'completed');
    for (const role of ['owner', 'admin']) assert.ok((await attention(c, role)).some(i => i.kind === 'link_conflict'));
    assert.equal(await prisma.cleaningTask.count({ where: { bookingId: b.id } }), 1);
  } finally { await prisma.repairTask.delete({ where: { id: rep.id } }); }
  assert.ok(!(await attention(c)).some(i => i.kind === 'link_conflict'));
});
test('шаг 8: существующий ремонт запрещает создание без появления Booking', async () => {
  const today = todayIn(acc.timezone); const checkIn = addDays(today, offset); offset += 5; const checkOut = addDays(checkIn, 2);
  const rep = await prisma.repairTask.create({ data: { accountId: acc.id, apartmentId: apt.id, title: 'До брони', date: checkIn, blockDays: 2 } });
  const before = await prisma.booking.count({ where: { apartmentId: apt.id } });
  try { const r = await post('/booking-links', { apartmentId: apt.id, checkIn: isoDay(checkIn), checkOut: isoDay(checkOut), guestsCount: 1, terms: 'cash_on_arrival' }); assert.equal(r.status, 409); assert.equal(await prisma.booking.count({ where: { apartmentId: apt.id } }), before); }
  finally { await prisma.repairTask.delete({ where: { id: rep.id } }); }
});
test('шаг 8: Today ожидает отметку deposit только после гостя; существующая отметка подтверждает', async () => {
  const c = await create({ terms: 'deposit', depositKzt: 5000 }); assert.equal((await attention(c)).length, 0);
  assert.equal((await guest(c)).status, 200); assert.ok((await attention(c)).some(i => i.kind === 'link_waiting_admin' && i.problem.includes('залога')));
  assert.equal((await post(`/booking-links/${c.link.id}/deposit`)).status, 200); assert.equal((await prisma.booking.findUnique({ where: { id: c.link.bookingId } })).status, 'confirmed');
});
