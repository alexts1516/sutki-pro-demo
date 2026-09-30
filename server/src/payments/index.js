// Выбор платёжного провайдера по .env. Нет ключей — оплата картой выключена (возвращается null).
import { createCloudPayments } from './cloudpayments.js';
import { createPaylink } from './paylink.js';

export function createPaymentProvider(cfg, { publicUrl, fetchImpl } = {}) {
  const p = cfg.provider;
  if (p === 'cloudpayments' && cfg.cloudpayments.publicId && cfg.cloudpayments.apiSecret) return createCloudPayments(cfg.cloudpayments);
  if (p === 'paylink' && cfg.paylink.shopId && cfg.paylink.secretKey) return createPaylink({ ...cfg.paylink, publicUrl, fetchImpl });
  if (p) console.warn(`[payments] PAYMENTS_PROVIDER=${p}, но ключи не заданы — онлайн-оплата выключена`);
  return null;
}

/** Применить результат вебхука: обновить платёж и бронь, отправить событие */
export async function applyPaymentResult({ prisma, events, result }) {
  if (!result?.paymentId) return;
  const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
  if (!payment || payment.status === 'succeeded') return payment;   // повторное уведомление — ничего не делаем
  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: result.status, providerPaymentId: result.providerPaymentId || payment.providerPaymentId, raw: result.raw ?? payment.raw ?? undefined },
  });
  if (result.status === 'succeeded') {
    if (payment.bookingId) await prisma.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus: 'paid' } });
    events?.emit('payment.succeeded', { accountId: payment.accountId, paymentId: payment.id });
  }
  return updated;
}
