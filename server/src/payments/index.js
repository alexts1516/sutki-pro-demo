// Выбор платёжного провайдера по .env. Нет ключей — оплата картой выключена (возвращается null).
import { createCloudPayments } from './cloudpayments.js';
import { createPaylink } from './paylink.js';
import { createTestPayments } from './test.js';
import { confirmBooking } from '../services/bookings.js';

export function createPaymentProvider(cfg, { publicUrl, fetchImpl } = {}) {
  const p = cfg.provider;
  if (p === 'cloudpayments' && cfg.cloudpayments.publicId && cfg.cloudpayments.apiSecret) return createCloudPayments(cfg.cloudpayments);
  if (p === 'paylink' && cfg.paylink.shopId && cfg.paylink.secretKey) return createPaylink({ ...cfg.paylink, publicUrl, fetchImpl });
  if (p === 'test' && process.env.NODE_ENV !== 'production') return createTestPayments();
  if (p) console.warn(`[payments] PAYMENTS_PROVIDER=${p}, но ключи не заданы — онлайн-оплата выключена`);
  return null;
}

/** Применить результат вебхука: обновить платёж и бронь, отправить событие.
 *  Оплата на сайте = подтверждение: бронь «ждёт оплаты» сама становится подтверждённой (подготовка, заказ водителю). */
export async function applyPaymentResult({ prisma, events, result, dispatch = null }) {
  if (!result?.paymentId) return;
  const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
  if (!payment || payment.status === 'succeeded') return payment;   // повторное уведомление — ничего не делаем
  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: result.status, providerPaymentId: result.providerPaymentId || payment.providerPaymentId, raw: result.raw ?? payment.raw ?? undefined },
  });
  if (result.status === 'succeeded') {
    if (payment.bookingId) {
      const b = await prisma.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus: 'paid' } });
      events?.emit('payment.succeeded', { accountId: payment.accountId, paymentId: payment.id });
      if (b.status === 'request') await confirmBooking({ accountId: payment.accountId, bookingId: b.id, events, dispatch, actor: { type: 'system', name: 'Оплата на сайте' } });
    } else events?.emit('payment.succeeded', { accountId: payment.accountId, paymentId: payment.id });
  }
  return updated;
}
