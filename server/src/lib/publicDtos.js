// Public allow-lists. A public reference is not a database primary key or an access capability.
import crypto from 'node:crypto';
import { isoDay } from './dates.js';
export const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export const scopedDigest = (accountId, value) => digest(JSON.stringify([accountId, value]));
export const publicRef = (config, accountId, id) => crypto.createHmac('sha256', config.publicAccessSecret || config.jwtSecret).update(JSON.stringify(['apartment', accountId, id])).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const accessSecret = (config, accountId, key) => crypto.createHmac('sha256', config.publicAccessSecret || config.jwtSecret).update(JSON.stringify(['booking-access', accountId, key])).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const fingerprint = data => digest(JSON.stringify(Object.keys(data).sort().map(k => [k, data[k]])));
const photo = (p,config,accountId,slug) => p ? { url: (p.url.startsWith('data:') || p.url.includes('/demo/assets/')) ? p.url : `/api/public/${encodeURIComponent(slug)}/photos/${publicRef(config,accountId,'photo:'+p.id)}`, caption:p.caption,isCover:!!p.isCover } : null;
export function apartmentGuest(a, config, accountId, slug) {
  return { ref: publicRef(config, accountId, a.id), title: [a.rooms, a.complex || a.district].filter(Boolean).join(' · '), district: a.district, rooms: a.rooms,
    maxGuests: a.maxGuests, areaM2: a.areaM2, basePriceKzt: a.basePriceKzt, description: a.description,
    pets: { allowed: !!a.pets?.allowed, feeKzt: a.pets?.feeKzt || 0, note: a.pets?.note || null },
    cover: photo(a.cover,config,accountId,slug), photos: (a.photos || []).map(p=>photo(p,config,accountId,slug)), ...(a.available === undefined ? {} : { available: a.available }), ...(a.quote ? { quote: a.quote } : {}) };
}
export function bookingGuest(b) {
  return { number: b.number, status: b.status, checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut), checkInTime: b.checkInTime, checkOutTime: b.checkOutTime,
    guestsCount: b.guestsCount, nights: Math.round((new Date(b.checkOut)-new Date(b.checkIn))/86400000), nightlyKzt: b.nightlyKzt, totalKzt: b.totalKzt, currency: b.currencyShown, amountShown: b.amountShown,
    paymentMethod: b.paymentMethod, paymentStatus: b.paymentStatus, holdUntil: b.holdUntil, pets: !!b.pets, petFeeKzt: b.petFeeKzt,
    apartment: b.apartment ? { title: [b.apartment.rooms, b.apartment.complex || b.apartment.district].filter(Boolean).join(' · '), ...(b.status === 'confirmed' ? { address: b.apartment.address } : {}) } : undefined };
}
export function bookingPageGuest({ booking:b, brand, payment, orphaned=false, now=new Date() }) {
  const past = b.status === 'completed' || new Date(b.checkOut) <= now;
  const failed = ['failed','cancelled'].includes(payment?.status);
  const state = past ? 'completed' : orphaned ? 'payment_orphaned' : b.status === 'confirmed' ? 'confirmed' : b.status === 'request' ? (failed ? 'payment_failed' : 'payment_pending') : 'cancelled';
  const confirmed = state === 'confirmed';
  const apartment = { title: [b.apartment.rooms,b.apartment.complex||b.apartment.district].filter(Boolean).join(' · ') };
  if(confirmed) apartment.address=b.apartment.address;
  const out = {
    number:b.number,state,status:b.status,checkIn:isoDay(b.checkIn),checkOut:isoDay(b.checkOut),checkInTime:b.checkInTime,checkOutTime:b.checkOutTime,
    guestsCount:b.guestsCount,totalKzt:b.totalKzt,payment:{status:payment?.status||b.paymentStatus,paidKzt:payment?.status==='succeeded'?payment.amountKzt:null},apartment,
    contact:{phone:brand.contacts?.phone||null,telegram:brand.contacts?.telegram||null,whatsapp:brand.contacts?.whatsapp||null,email:brand.contacts?.email||null},
    transfers:(b.transfers||[]).map(t=>({direction:t.direction,place:t.place,date:isoDay(t.date),time:t.time,status:t.status,flight:t.flight||null})),
    nextAction:confirmed?'follow_checkin':state==='payment_pending'?'wait_payment':state==='payment_failed'?'retry_payment':state==='payment_orphaned'?'contact_support':state==='completed'?'stay_complete':'contact_support',
  };
  if(confirmed) out.instructions={entrance:b.apartment.entrance||null,floor:b.apartment.floor??null,intercom:b.apartment.intercom||null,lockCode:b.apartment.lockCode||null,keyboxCode:b.apartment.keyboxCode||null,wifiName:b.apartment.wifiName||null,wifiPassword:b.apartment.wifiPassword||null,note:b.apartment.accessNote||null};
  return out;
}
export function paymentGuest(p) {
  const intent = p.intent || {};
  return { paymentRef: p.publicRef, status: p.status, ...intent, ...(p.status === 'succeeded' ? { paid: true } : {}) };
}
export function safeIntent(intent, ref) {
  if (intent.type === 'redirect') return { type: 'redirect', url: intent.url };
  if (intent.type !== 'widget') throw new Error('Unsupported payment intent');
  const p = intent.params || {};
  return { type: 'widget', script: intent.script, params: { publicTerminalId: p.publicTerminalId, description: p.description, paymentSchema: p.paymentSchema,
    currency: p.currency, amount: p.amount, culture: p.culture, externalId: ref, skin: p.skin,
    userInfo: { email: p.userInfo?.email, phone: p.userInfo?.phone }, metadata: { bookingNumber: p.metadata?.bookingNumber } } };
}
