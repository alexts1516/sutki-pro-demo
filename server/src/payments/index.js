// Выбор платёжного провайдера по .env. Нет ключей — оплата картой выключена (возвращается null).
import { createCloudPayments } from './cloudpayments.js';
import { createPaylink } from './paylink.js';
import { createTestPayments } from './test.js';
import { withApartmentTx, confirmRequestInTx, confirmKeys, isAvailable } from '../services/bookings.js';
import { enqueue, runOutbox } from '../services/outbox.js';
import { hook } from '../lib/testHooks.js';

export function createPaymentProvider(cfg, { publicUrl, fetchImpl } = {}) {
  const p = cfg.provider;
  if (p === 'cloudpayments' && cfg.cloudpayments.publicId && cfg.cloudpayments.apiSecret) return createCloudPayments(cfg.cloudpayments);
  if (p === 'paylink' && cfg.paylink.shopId && cfg.paylink.secretKey) return createPaylink({ ...cfg.paylink, publicUrl, fetchImpl });
  if (p === 'test' && process.env.NODE_ENV !== 'production') return createTestPayments();
  if (p) console.warn(`[payments] PAYMENTS_PROVIDER=${p}, но ключи не заданы — онлайн-оплата выключена`);
  return null;
}

export const orphanKey = (paymentId) => `event:payment.orphaned:${paymentId}`;

/** Применить результат вебхука: обновить платёж и бронь, отправить событие.
 *  Оплата на сайте = подтверждение: бронь «ждёт оплаты» сама становится подтверждённой (подготовка, заказ водителю).
 *  Проход 4, шаг 4: успешная оплата брони — одной транзакцией квартиры (withApartmentTx), повтор вебхука ничего не меняет:
 *   - заявка с живым удержанием → подтверждение (общее ядро confirmRequestInTx — то же, что в confirmBooking);
 *   - удержание истекло, даты свободны → бронь восстанавливается и подтверждается;
 *   - удержание истекло, даты заняты (или бронь отменили) → второй брони нет, платёж записан, одна строка журнала
 *     event:payment.orphaned → пункт «Критично» в «Сегодня»: «Оплата без брони — верните деньги». Возврат — вручную. */
export async function applyPaymentResult({ prisma, events, result, dispatch = null }) {
  if (!result?.paymentId) return;
  const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
  if(!payment) return;
  if(result.providerPaymentId){ const bind=await prisma.payment.updateMany({where:{id:payment.id,OR:[{providerPaymentId:null},{providerPaymentId:result.providerPaymentId}]},data:{providerPaymentId:result.providerPaymentId}}); if(!bind.count) return {rejectedOperation:true}; }
  if(payment.status==='succeeded') return payment;   // повторное уведомление — ничего не делаем
  const data = { ...(payment.attemptKeyHash ? {initState:'ready'} : {}), status: result.status, providerPaymentId: result.providerPaymentId || payment.providerPaymentId, raw: result.raw ?? payment.raw ?? undefined };
  if (result.status !== 'succeeded') {   // pending / failed — условная запись: уже успешный платёж не откатываем
    await prisma.payment.updateMany({ where: { id: payment.id, status: { not: 'succeeded' } }, data });
    return prisma.payment.findUnique({ where: { id: payment.id } });
  }
  const booking = payment.bookingId ? await prisma.booking.findUnique({ where: { id: payment.bookingId }, select: { apartmentId: true } }) : null;
  if (!booking) {   // оплата без брони (или бронь удалена) — как раньше
    const won = await prisma.payment.updateMany({ where: { id: payment.id, status: { not: 'succeeded' } }, data });
    if (won.count) events?.emit('payment.succeeded', { accountId: payment.accountId, paymentId: payment.id });
    return prisma.payment.findUnique({ where: { id: payment.id } });
  }
  const keys = [`event:payment.succeeded:${payment.id}`];
  const outcome = await withApartmentTx(booking.apartmentId, async (tx) => {   // здесь же снимаются истёкшие удержания квартиры
    const won = await tx.payment.updateMany({ where: { id: payment.id, status: { not: 'succeeded' } }, data });
    if (!won.count) return 'repeat';   // параллельный повтор вебхука уже всё сделал
    await enqueue(tx, { accountId: payment.accountId, kind: 'event', payload: { name: 'payment.succeeded', data: { accountId: payment.accountId, paymentId: payment.id } }, dedupeKey: keys[0] });
    const b = await tx.booking.findUnique({ where: { id: payment.bookingId } });
    const actor = { type: 'system', name: 'Оплата на сайте' };
    if (b.status === 'request') {   // удержание живо (истёкшее уже снято выше) или без срока
      await tx.booking.update({ where: { id: b.id }, data: { paymentStatus: 'paid' } });
      await confirmRequestInTx(tx, b, { actor });
      keys.push(...confirmKeys(b.id));
      return 'confirmed';
    }
    if (b.status === 'confirmed' || b.status === 'completed') {
      await tx.booking.update({ where: { id: b.id }, data: { paymentStatus: 'paid' } });
      return 'paid';
    }
    // отменена: восстановить можно только бронь, снятую по истечению удержания, и только если даты свободны
    const expired = !!(await tx.outboxEvent.findUnique({ where: { dedupeKey: `event:booking.hold_expired:${b.id}` }, select: { id: true } }));
    if (expired && await isAvailable(b.accountId, b.apartmentId, b.checkIn, b.checkOut, b.id, tx)) {
      const back = await tx.booking.update({ where: { id: b.id }, data: { status: 'request', paymentStatus: 'paid', holdUntil: null } });
      await confirmRequestInTx(tx, back, { actor });
      keys.push(...confirmKeys(b.id));
      return 'restored';
    }
    await tx.booking.update({ where: { id: b.id }, data: { paymentStatus: 'paid' } });   // деньги получены — их надо вернуть
    await enqueue(tx, {
      accountId: payment.accountId, kind: 'event', dedupeKey: orphanKey(payment.id),
      payload: { name: 'payment.orphaned', data: { accountId: payment.accountId, paymentId: payment.id, bookingId: b.id, amountKzt: payment.amountKzt, reason: expired ? 'dates_taken' : 'booking_cancelled' } },
    });
    keys.push(orphanKey(payment.id));
    return 'orphaned';
  });
  await hook('paymentAfterCommit', { paymentId: payment.id, outcome });   // тест: «падение» после коммита
  if (outcome !== 'repeat') await runOutbox({ events, dispatch, keys }).catch(() => {});   // лучшее усилие; иначе — планировщик
  const out = await prisma.payment.findUnique({ where: { id: payment.id } });
  return Object.assign(out, { outcome });
}
