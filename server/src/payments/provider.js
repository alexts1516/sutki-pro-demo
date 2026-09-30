/**
 * Общий интерфейс платёжного провайдера. Каждый адаптер (CloudPayments, PayLink) реализует:
 *
 *   name: string                          — 'cloudpayments' | 'paylink'
 *   createPayment({ payment, booking, guest, description, lang })
 *       → { type: 'widget', script, params }   — открыть виджет на сайте (CloudPayments)
 *       → { type: 'redirect', url }             — перенаправить гостя на страницу оплаты (PayLink)
 *   handleWebhook({ kind, rawBody, headers, prisma })
 *       → { status: 200, body: {...}, result?: { paymentId, status: 'succeeded'|'failed'|'pending', amount } }
 *
 * Провайдер включается только при заданных ключах в .env (PAYMENTS_PROVIDER + ключи).
 * Ни один адаптер не делает запросов к банку, пока не включён.
 */
export const PAYMENT_STATUSES = ['created', 'pending', 'succeeded', 'failed', 'refunded'];
