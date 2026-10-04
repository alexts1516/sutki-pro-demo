// Приёмка исходного demo seed до остальных тестов, изменяющих общую тестовую базу.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from './helpers.js';
import { reconcileBookings } from '../src/services/bookings.js';
import { termsHashOf, missing } from '../src/services/bookingLinks.js';
import { todayIn, addDays } from '../src/lib/dates.js';

after(() => prisma.$disconnect());
test('финальный demo seed: confirmed имеют подготовку сразу, reconciliation не достраивает их', async () => {
  const bookings = await prisma.booking.findMany({ where: { status: 'confirmed' }, include: { cleanings: true } });
  assert.ok(bookings.length > 200);
  for (const b of bookings) {
    assert.ok(b.cleanings.length, `№${b.number}: нет подготовки`);
    assert.equal(b.cleanings.filter(t => t.autoKey === `turnover:${b.id}`).length, 1);
  }
  assert.equal((await reconcileBookings()).preps, 0);
});
test('финальный demo seed: cash, ждём гостя / доп. подтверждение / completed, сроки переживают следующий день', async () => {
  const account = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  const links = await prisma.bookingLink.findMany({ where: { accountId: account.id }, include: { booking: { include: { guest: true } } } });
  assert.equal(links.length, 3);
  const waiting = links.find(l => l.extraCheckRequired);
  assert.equal(waiting.booking.status, 'request');
  assert.equal(waiting.termsHash, termsHashOf(waiting.booking, waiting));
  assert.ok(waiting.submittedAt && !waiting.extraCheckedAt);
  assert.deepEqual(missing(waiting, waiting.booking), ['extra_check']);
  assert.ok(links.some(l => l.status === 'active' && !l.guestStartedAt));
  assert.ok(links.some(l => l.status === 'completed' && l.booking.status === 'confirmed'));
  for (const l of links) {
    assert.equal(l.terms, 'cash_on_arrival'); assert.equal(l.depositKzt, null);
    assert.match(l.tokenHash, /^[a-f0-9]{64}$/);
    assert.ok(l.booking.checkIn > addDays(todayIn(account.timezone), 30));
    if (l.status === 'active') assert.ok(l.booking.holdUntil > new Date(Date.now() + 24 * 3600000));
  }
  const confirmed = links.find(l => l.status === 'completed');
  const repair = await prisma.repairTask.findFirst({ where: { apartmentId: confirmed.booking.apartmentId, date: confirmed.booking.checkIn } });
  assert.ok(repair.createdAt > confirmed.booking.createdAt);
});
