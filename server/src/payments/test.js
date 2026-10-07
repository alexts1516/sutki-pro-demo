// Подписанный test provider для разработки и автотестов. Создание intent не подтверждает оплату:
// результат применяется только после HMAC-проверенного callback, как у реального provider.
import crypto from 'node:crypto';
import { safeEqual } from '../lib/tokens.js';

const sign = (raw, secret) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

export function createTestPayments({ callbackSecret = 'dev-test-provider-callback-secret', publicUrl = '' } = {}) {
  return {
    name: 'test',
    async createPayment({ payment, returnUrl }) {
      const target = new URL(returnUrl, publicUrl || 'http://localhost');
      target.searchParams.set('paymentRef', payment.id);
      return { type: 'redirect', url: target.toString() };
    },
    async handleWebhook({ rawBody, headers, prisma }) {
      const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
      const got = headers?.['x-test-signature'];
      if (!callbackSecret || !got || !safeEqual(got, sign(raw, callbackSecret))) return { status: 401, body: { error: 'bad-signature' }, error: 'bad-signature' };
      let body = {}; try { body = JSON.parse(raw); } catch { return { status: 400, body: { error: 'bad-body' } }; }
      const payment = body.paymentRef ? await prisma.payment.findUnique({ where: { publicRef: String(body.paymentRef) } }) : null;
      if (!payment || payment.provider !== 'test') return { status: 200, body: { ok: true, ignored: true } };
      const amountOk = Number(body.amount) === payment.amount && body.currency === payment.currency;
      const providerPaymentId = typeof body.operationId === 'string' && body.operationId ? body.operationId : null;
      const status = ['succeeded','failed','cancelled','pending'].includes(body.status) ? body.status : null;
      if (!amountOk || !providerPaymentId || !status) return { status: 200, body: { ok: true, ignored: true } };
      return { status: 200, body: { ok: true }, result: { paymentId: payment.id, status, providerPaymentId, raw: body } };
    },
  };
}
