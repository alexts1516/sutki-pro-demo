// Что отдаём наружу. Гостям — без кодов замков и Wi‑Fi; сотрудникам — только по своим задачам.
import { isoDay } from './dates.js';

export const photoOut = (p) => ({ id: p.id, url: p.url, caption: p.caption, captionEn: p.captionEn, sortOrder: p.sortOrder, isCover: p.isCover });
export const sortPhotos = (list = []) => [...list].sort((a, b) => (b.isCover - a.isCover) || a.sortOrder - b.sortOrder);

export function apartmentPublic(a, lang = 'ru') {
  const photos = sortPhotos(a.photos).map(p => ({ id: p.id, url: p.url, caption: (lang === 'en' && p.captionEn) || p.caption, isCover: p.isCover }));
  return {
    id: a.id, code: a.code, title: (lang === 'en' && a.titleEn) || a.title, complex: a.complex, address: a.address.replace(/,\s*кв\.\s*\d+$/, ''),
    district: a.district, rooms: a.rooms, maxGuests: a.maxGuests, areaM2: a.areaM2, basePriceKzt: a.basePriceKzt,
    description: (lang === 'en' && a.descriptionEn) || a.description,
    pets: { allowed: a.petsAllowed, feeKzt: a.petFeeKzt, note: a.petNote },
    cover: photos[0] || null, photos,
  };
}

export function apartmentAdmin(a) {
  const { accountId, photos, ...rest } = a;
  return { ...rest, photos: sortPhotos(photos).map(photoOut) };
}

export const accessInfo = (a) => ({ address: a.address, entrance: a.entrance, floor: a.floor, intercom: a.intercom, lockCode: a.lockCode, keyboxCode: a.keyboxCode, wifiName: a.wifiName, wifiPassword: a.wifiPassword, accessNote: a.accessNote });

export function bookingOut(b) {
  return {
    id: b.id, number: b.number, status: b.status, source: b.source,
    checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut), checkInTime: b.checkInTime, checkOutTime: b.checkOutTime,
    guestsCount: b.guestsCount, nightlyKzt: b.nightlyKzt, totalKzt: b.totalKzt, currencyShown: b.currencyShown, amountShown: b.amountShown,
    paymentMethod: b.paymentMethod, paymentStatus: b.paymentStatus, pets: b.pets, petFeeKzt: b.petFeeKzt, note: b.note, cleanerName: b.cleanerName,
    apartment: b.apartment ? { id: b.apartment.id, title: b.apartment.title, address: b.apartment.address } : undefined,
    guest: b.guest ? { id: b.guest.id, name: b.guest.name, phone: b.guest.phone, email: b.guest.email, telegramLinked: !!b.guest.telegramChatId } : undefined,
    confirmedAt: b.confirmedAt, createdAt: b.createdAt,
  };
}
