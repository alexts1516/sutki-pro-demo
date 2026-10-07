import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import crypto from 'node:crypto';
import { safeEqual } from '../lib/tokens.js';
import { randomToken } from '../lib/tokens.js';
import { digest, scopedDigest, accessSecret, fingerprint, paymentGuest, safeIntent } from '../lib/publicDtos.js';
import { createBookingRequest, withApartmentTx, extendHold } from './bookings.js';
export const validSecret = s => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const proofSignature = (config,slug,nonce) => crypto.createHmac('sha256',config.publicAccessSecret || config.jwtSecret).update(JSON.stringify(['public-operation',slug,nonce])).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function issueOperationKey(config,slug){ const nonce=randomToken(32); return nonce+'.'+proofSignature(config,slug,nonce); }
export function operationKey(req,config) {
  const key=req.get('Idempotency-Key')||''; const [nonce,signature]=key.split('.');
  if(!validSecret(nonce)||!validSecret(signature)||key.split('.').length!==2||!safeEqual(signature,proofSignature(config,req.params.slug,nonce))) throw new HttpError(400,'Получите новый ключ операции');
  return key;
}
export async function findGuestBooking(accountId, token) {
  if (!validSecret(token)) throw new HttpError(404, 'Бронь не найдена');
  const b = await prisma.booking.findFirst({ where: { accountId, guestAccessHash: digest(token) }, include: { apartment: true, guest: true, transfers: true } });
  if (!b || b.source !== 'site') throw new HttpError(404, 'Бронь не найдена');
  return b;
}
export async function checkout({ accountId, apartment, data, guestData, key, config, holdUntil, amountShown }) {
  const checkoutKeyHash = scopedDigest(accountId, key), checkoutRequestHash = fingerprint(data);
  const token = accessSecret(config, accountId, key);
  const replay = async () => {
    const b = await prisma.booking.findUnique({ where: { checkoutKeyHash }, include: { apartment: true, guest: true } });
    if (!b) return null;
    if (b.checkoutRequestHash !== checkoutRequestHash) throw new HttpError(409, 'Ключ операции уже использован с другими условиями');
    if (b.guestAccessHash !== digest(token)) throw new HttpError(409, 'Доступ к этой операции нужно восстановить');
    return b;
  };
  const existing = await replay(); if (existing) return { booking: existing, token, replayed: true };
  try {
    const booking = await createBookingRequest({ accountId, apartment, checkIn: new Date(data.checkIn+'T00:00:00Z'), checkOut: new Date(data.checkOut+'T00:00:00Z'), guestsCount: data.guests,
      pets: data.pets, note: data.comment, paymentMethod: 'card', currencyShown: data.currency, amountShown, holdUntil,
      onCreated: async (tx,b) => {
        const guest = await tx.guest.create({ data: { accountId, ...guestData } });
        return tx.booking.update({ where: { id: b.id }, data: { guestId: guest.id, guestAccessHash: digest(token), checkoutKeyHash, checkoutRequestHash,
          ...(data.earlyCheckIn && data.earlyCheckIn < b.checkInTime ? { earlyCheckIn: data.earlyCheckIn, earlyCheckInStatus: 'requested' } : {}) }, include: { apartment: true, guest: true } });
      } });
    return { booking, token, replayed: false };
  } catch (e) { const b = await replay(); if (b) return { booking: b, token, replayed: true }; throw e; }
}
export async function startAttempt({ booking, key, payments, config, slug }) {
  const attemptKeyHash = scopedDigest(booking.accountId, JSON.stringify([booking.id,key]));
  const claim = await withApartmentTx(booking.apartmentId, async tx => {
    const existing = await tx.payment.findUnique({ where: { attemptKeyHash } });
    if (existing) return { payment: existing, owner: false };
    const b = await tx.booking.findUnique({ where: { id: booking.id } });
    if (b.paymentStatus === 'paid') return { refuse: 'Бронь уже оплачена' };
    if (!['request','confirmed'].includes(b.status)) return { refuse: 'Время оплаты истекло или бронь отменена' };
    const active = await tx.payment.findFirst({ where: { bookingId: b.id, OR: [{ status: { in: ['created','pending'] } }, { initState: { in: ['starting','uncertain'] } }] } });
    if (active) return { refuse: 'Предыдущая попытка ещё обрабатывается' };
    const holdUntil = extendHold(b);
    if (holdUntil) await tx.booking.update({ where: { id:b.id }, data:{holdUntil} });
    return { owner: true, payment: await tx.payment.create({ data: { accountId: b.accountId, bookingId: b.id, provider: payments.name, publicRef: randomToken(32), attemptKeyHash,
      initState: 'starting', status: 'created', amountKzt: b.totalKzt, currency:'KZT', amount:b.totalKzt } }) };
  });
  if (claim.refuse) throw new HttpError(409, claim.refuse);
  if (!claim.owner) return (claim.payment.intent || ['succeeded','failed'].includes(claim.payment.status)) ? { code:201, body:{...paymentGuest(claim.payment),bookingStatus:(await txlessBooking(claim.payment.bookingId)).status} } : { code:202, body:{paymentRef:claim.payment.publicRef,status:'processing'} };
  const p=claim.payment;
  try {
    const intent=await payments.createPayment({ payment:{...p,id:p.publicRef},booking,guest:{...booking.guest,id:undefined},description:`Бронь №${booking.number}`,lang:booking.guest?.locale||'ru',
      returnUrl:`${config.publicUrl}/api/public/${slug}/payment-return` });
    const stored=await prisma.payment.update({where:{id:p.id},data:{intent:safeIntent(intent,p.publicRef),initState:'ready'}});
    return {code:201,body:{...paymentGuest(await prisma.payment.findUnique({where:{id:stored.id}})),bookingStatus:(await txlessBooking(stored.bookingId)).status}};
  } catch {
    // Unknown external result is deliberately not retried: no second provider call/charge.
    await prisma.payment.update({where:{id:p.id},data:{initState:'uncertain'}});
    return {code:202,body:{paymentRef:p.publicRef,status:'processing'}};
  }
}

const txlessBooking = id => prisma.booking.findUnique({where:{id},select:{status:true}});
