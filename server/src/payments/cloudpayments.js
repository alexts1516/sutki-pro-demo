// CloudPayments (cloudpayments.ru / cloudpayments.kz)
// Документация: https://developers.cloudpayments.ru/ — разделы «Виджет» и «Уведомления».
//
// Как это работает:
//  1. Сайт открывает виджет (скрипт https://widget.cloudpayments.ru/bundles/cloudpayments.js):
//       const widget = new cp.CloudPayments(); widget.start(params)
//     params создаёт наш сервер (createPayment) — publicTerminalId, сумма, валюта, externalId = id платежа.
//  2. Перед списанием CloudPayments шлёт уведомление Check → мы проверяем сумму и отвечаем {"code":0}.
//  3. После оплаты — Pay (успех) или Fail (отказ). Отвечаем {"code":0}.
//  Уведомления приходят POST-запросом (form-urlencoded или JSON). Подлинность проверяем по заголовкам:
//    Content-HMAC   = base64(HMAC-SHA256(сырое тело запроса как пришло, API Secret))
//    X-Content-HMAC = то же, но от URL-декодированного тела.
//  Коды ответа на Check: 0 — принять, 10 — неверный номер заказа, 11 — неверный AccountId,
//  12 — неверная сумма, 13 — платёж не может быть принят, 20 — просрочен.
import crypto from 'node:crypto';
import { safeEqual } from '../lib/tokens.js';

export const CP_CODES = { OK: 0, INVALID_INVOICE: 10, INVALID_ACCOUNT: 11, INVALID_AMOUNT: 12, NOT_ACCEPTED: 13, EXPIRED: 20 };
const hmac = (msg, secret) => crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('base64');

/** Проверка подписи уведомления. rawBody — строка/Buffer ровно в том виде, как пришёл запрос. */
export function verifyCloudPaymentsSignature(rawBody, headers, apiSecret) {
  if (!apiSecret) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
  const got = h['content-hmac'], gotX = h['x-content-hmac'];
  if (got && safeEqual(got, hmac(raw, apiSecret))) return true;
  if (gotX) {
    let decoded = raw;
    try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { /* тело не URL-кодировано */ }
    if (safeEqual(gotX, hmac(decoded, apiSecret)) || safeEqual(gotX, hmac(raw, apiSecret))) return true;
  }
  return false;
}

export function parseCloudPaymentsBody(rawBody, contentType = '') {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  if (contentType.includes('json') || raw.trim().startsWith('{')) { try { return JSON.parse(raw); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

export function createCloudPayments({ publicId, apiSecret }) {
  return {
    name: 'cloudpayments',
    /** Параметры для widget.start(...) на сайте */
    createPayment({ payment, booking, guest, description, lang = 'ru' }) {
      return {
        type: 'widget',
        script: 'https://widget.cloudpayments.ru/bundles/cloudpayments.js',
        params: {
          publicTerminalId: publicId,
          description,
          paymentSchema: 'Single',
          currency: payment.currency,
          amount: payment.amount,
          culture: lang === 'en' ? 'en-US' : 'ru-RU',
          externalId: payment.id,                 // придёт обратно в уведомлениях как InvoiceId
          skin: 'modern',
          userInfo: { accountId: guest?.id || undefined, email: guest?.email || undefined, phone: guest?.phone || undefined },
          metadata: { bookingNumber: booking?.number },
        },
      };
    },
    /** kind: check | pay | fail */
    async handleWebhook({ kind, rawBody, headers, prisma }) {
      if (!verifyCloudPaymentsSignature(rawBody, headers, apiSecret)) {
        return { status: 200, body: { code: CP_CODES.NOT_ACCEPTED }, error: 'bad-signature' };
      }
      const b = parseCloudPaymentsBody(rawBody, headers['content-type']);
      const paymentId = b.InvoiceId || b.ExternalId;
      const payment = paymentId ? await prisma.payment.findFirst({ where: { OR:[{publicRef:String(paymentId)},{id:String(paymentId)}] } }) : null;
      if (!payment || payment.provider !== 'cloudpayments') return { status: 200, body: { code: CP_CODES.INVALID_INVOICE } };
      if (!b.TransactionId) return {status:200,body:{code:CP_CODES.NOT_ACCEPTED}};
      const amountOk = Math.abs(Number(b.Amount) - payment.amount) < 0.01 && (payment.attemptKeyHash ? b.Currency === payment.currency : (!b.Currency || b.Currency === payment.currency));
      if (kind === 'check') {
        if (!amountOk) return { status: 200, body: { code: CP_CODES.INVALID_AMOUNT } };
        if(payment.providerPaymentId && payment.providerPaymentId!==String(b.TransactionId)) return {status:200,body:{code:CP_CODES.NOT_ACCEPTED}};
        if (payment.status === 'succeeded') return { status: 200, body: { code: CP_CODES.NOT_ACCEPTED } };
        return { status: 200, body: { code: CP_CODES.OK }, result: { paymentId: payment.id, status: 'pending', providerPaymentId: String(b.TransactionId || '') } };
      }
      if(payment.providerPaymentId && payment.providerPaymentId!==String(b.TransactionId)) return {status:200,body:{code:CP_CODES.NOT_ACCEPTED}};
      if (kind === 'pay') {
        if (!amountOk) return { status: 200, body: { code: CP_CODES.OK } };
        const st = b.Status === 'Authorized' ? 'pending' : 'succeeded';
        return { status: 200, body: { code: CP_CODES.OK }, result: { paymentId: payment.id, status: st, providerPaymentId: String(b.TransactionId || ''), raw: b } };
      }
      if(kind==='fail' && payment.attemptKeyHash && !amountOk) return {status:200,body:{code:CP_CODES.NOT_ACCEPTED}};
      if (kind === 'fail') return { status: 200, body: { code: CP_CODES.OK }, result: { paymentId: payment.id, status: 'failed', providerPaymentId: String(b.TransactionId), raw: b } };
      return { status: 200, body: { code: CP_CODES.OK } };
    },
  };
}
