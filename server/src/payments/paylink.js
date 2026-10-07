// PayLink (paylink.kz) — платёжный сервис Казахстана. Публичная документация: https://docs.paylink.kz/ru/
//
// Сценарий «Платёжная страница» (проще всего):
//  1. Сервер создаёт токен платежа: POST https://checkout.paylink.kz/ctp/api/checkouts
//     Basic-авторизация (ID магазина : секретный ключ), заголовки Content-Type/Accept: application/json, X-API-Version: 2.
//     Тело: { checkout: { transaction_type: 'payment', test, order: { amount (в тиынах), currency, description, tracking_id },
//             settings: { success_url, fail_url, notification_url, language } } }
//     В ответе checkout.redirect_url — туда отправляем гостя.
//  2. PayLink присылает уведомление на notification_url (JSON, Basic-авторизация теми же ID и ключом;
//     дополнительно заголовок Content-Signature — RSA-SHA256 подпись тела, проверяется публичным ключом магазина).
//     transaction.status: successful | failed | incomplete | expired; tracking_id — наш id платежа.
//  Сумма в минимальных единицах: 12 500 ₸ → 1250000.
import crypto from 'node:crypto';
import { safeEqual } from '../lib/tokens.js';

const CHECKOUT_URL = 'https://checkout.paylink.kz/ctp/api/checkouts';
const basic = (id, key) => 'Basic ' + Buffer.from(`${id}:${key}`).toString('base64');

export function verifyPaylinkNotification({ rawBody, headers, shopId, secretKey, publicKey }) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!shopId || !secretKey || !safeEqual(h.authorization, basic(shopId, secretKey))) return false;
  if (publicKey) {   // подпись необязательна, но если ключ задан — проверяем
    const sig = h['content-signature']; if (!sig) return false;
    const pem = publicKey.includes('BEGIN') ? publicKey
      : `-----BEGIN PUBLIC KEY-----\n${publicKey.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    try { return crypto.verify('sha256', Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)), pem, Buffer.from(sig, 'base64')); }
    catch { return false; }
  }
  return true;
}

export function createPaylink({ shopId, secretKey, publicKey, testMode = true, publicUrl, fetchImpl = globalThis.fetch }) {
  return {
    name: 'paylink',
    guestCheckoutReady: !!publicKey,
    async createPayment({ payment, description, lang = 'ru', returnUrl }) {
      const body = {
        checkout: {
          transaction_type: 'payment', test: !!testMode,
          order: { amount: Math.round(payment.amount * 100), currency: payment.currency, description, tracking_id: payment.id },
          settings: {
            success_url: returnUrl, fail_url: returnUrl, decline_url: returnUrl, cancel_url: returnUrl,
            notification_url: `${publicUrl}/api/payments/paylink/notify`, language: lang === 'en' ? 'en' : 'ru',
          },
        },
      };
      const res = await fetchImpl(CHECKOUT_URL, {
        method: 'POST',
        headers: { Authorization: basic(shopId, secretKey), 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Version': '2' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.checkout?.redirect_url) throw new Error('PayLink: не удалось создать платёж' + (json.message ? `: ${json.message}` : ''));
      return { type: 'redirect', url: json.checkout.redirect_url, token: json.checkout.token };
    },
    async handleWebhook({ rawBody, headers, prisma }) {
      if (!verifyPaylinkNotification({ rawBody, headers, shopId, secretKey, publicKey })) return { status: 401, body: { error: 'bad-signature' }, error: 'bad-signature' };
      let b = {}; try { b = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody); } catch { /* пусто */ }
      const tr = b.transaction || {};
      const trackingId = tr.tracking_id || b.order?.tracking_id;
      const payment = trackingId ? await prisma.payment.findFirst({ where: { OR:[{publicRef:String(trackingId)},{id:String(trackingId)}] } }) : null;
      if (!payment || payment.provider !== 'paylink') return { status: 200, body: { ok: true, ignored: true } };
      const amountOk = tr.amount != null && (Number(tr.amount) === Math.round(payment.amount * 100) && (payment.attemptKeyHash ? tr.currency===payment.currency : (!tr.currency || tr.currency === payment.currency)));
      if(!amountOk || !(tr.uid || b.token) || (payment.providerPaymentId && payment.providerPaymentId!==(tr.uid || b.token))) return {status:200,body:{ok:true,ignored:true}};
      const status = tr.status === 'successful' ? 'succeeded' : ['failed', 'expired', 'declined'].includes(tr.status) || b.expired ? 'failed' : 'pending';
      return { status: 200, body: { ok: true }, result: { paymentId: payment.id, status, providerPaymentId: tr.uid || b.token || null, raw: b } };
    },
  };
}
