// Тексты уведомлений на русском и английском. Формат — HTML для Telegram (<b>, <i>, <a>).
// Чтобы поменять формулировку — правьте здесь. d — данные события (см. service.js).
const e = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const money = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸';
const MON = { ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
const day = (d, l) => { const x = new Date(d); return l === 'en' ? `${MON.en[x.getUTCMonth()]} ${x.getUTCDate()}` : `${x.getUTCDate()} ${MON.ru[x.getUTCMonth()]}`; };
const SRC = { site: 'сайт', airbnb: 'Airbnb', booking: 'Booking', telegram: 'Telegram', whatsapp: 'WhatsApp', direct: 'напрямую' };
const PAY = { ru: { card: 'картой онлайн', cash: 'наличными при заселении', kaspi: 'Kaspi перевод', telegram: 'через Telegram', transfer: 'переводом' }, en: { card: 'card online', cash: 'cash at check-in', kaspi: 'Kaspi transfer', telegram: 'via Telegram', transfer: 'bank transfer' } };
const DIR = { ru: { in: 'Встреча', out: 'Проводы' }, en: { in: 'Pick-up', out: 'Drop-off' } };
const PLACE = { ru: { airport: 'аэропорт', station: 'вокзал' }, en: { airport: 'airport', station: 'railway station' } };

const ST_RU = { NEW: 'Новая', VISIT_INSPECTION: 'Выезд / осмотр', AWAITING_OWNER_APPROVAL: 'Ожидает подтверждения хозяина', REJECTED: 'Смета отклонена', APPROVED: 'Смета одобрена', IN_PROGRESS: 'В работе', DONE: 'Выполнена', CANCELLED: 'Отменена' };
const METHOD = { ru: { REMOTE: 'без выезда', PHOTOS: 'по фото', VISIT: 'после осмотра' }, en: { REMOTE: 'remote, no visit', PHOTOS: 'from photos', VISIT: 'after inspection' } };
const OCC = { ru: { OWNER_PRESENT: 'владелец будет в квартире', EMPTY: 'квартира пустая', UNKNOWN: 'пока неизвестно, кто будет' }, en: { OWNER_PRESENT: 'the owner will be there', EMPTY: 'the apartment will be empty', UNKNOWN: 'not known yet who will be there' } };
const total = (x) => x.workKzt + (x.partsKzt || 0);
const range = (x) => money(total(x)) + (x.maxKzt ? ' – ' + money(x.maxKzt) : '');
const aptNo = (a) => `${e(a.title)}${a.address ? `\n📍 ${e(a.address)}` : ''}`;

export const templates = {
  ru: {
    'booking.requested': d => `🆕 <b>Новая заявка №${d.booking.number}</b> (${SRC[d.booking.source] || d.booking.source})\n` +
      `🏠 ${e(d.apartment.title)}\n📅 ${day(d.booking.checkIn, 'ru')} → ${day(d.booking.checkOut, 'ru')} · ${d.nights} ноч. · ${d.booking.guestsCount} гост.\n` +
      `👤 ${e(d.guest?.name)} ${e(d.guest?.phone || '')}\n💳 ${money(d.booking.totalKzt)}${d.booking.paymentMethod ? ' · ' + (PAY.ru[d.booking.paymentMethod] || d.booking.paymentMethod) : ''}` +
      `${d.booking.note ? `\n💬 «${e(d.booking.note)}»` : ''}\n\nПодтвердите заявку в админке.`,
    'booking.confirmed': d => `✅ <b>Бронь №${d.booking.number} подтверждена</b>\n🏠 ${e(d.apartment.title)}\n📍 ${e(d.apartment.address)}\n` +
      `📅 Заезд ${day(d.booking.checkIn, 'ru')} с ${d.booking.checkInTime}, выезд ${day(d.booking.checkOut, 'ru')} до ${d.booking.checkOutTime}\n` +
      `💳 ${money(d.booking.totalKzt)}\n\nЗа день до заезда пришлём инструкцию, как попасть в квартиру.`,
    'checkin.upcoming': d => `🔑 <b>${d.when === 'today' ? 'Сегодня' : 'Завтра'} заезд</b> · бронь №${d.booking.number}\n🏠 ${e(d.apartment.title)}\n` +
      `👤 ${e(d.guest?.name)} · ${d.booking.guestsCount} гост. · ${d.booking.checkInTime}\n` +
      `${d.transfer ? `🚗 Трансфер ${d.transfer.time}${d.transfer.flight ? ', рейс ' + e(d.transfer.flight) : ''}\n` : ''}` +
      `${d.booking.paymentStatus !== 'paid' ? '⚠️ Не оплачено полностью' : '💳 Оплачено'}`,
    'guest.checkin_instructions': d => `🔑 <b>Инструкция по заселению</b> · бронь №${d.booking.number}\n📍 ${e(d.apartment.address)}\n` +
      `${d.apartment.entrance ? `🚪 Подъезд ${e(d.apartment.entrance)}${d.apartment.floor ? `, этаж ${d.apartment.floor}` : ''}\n` : ''}` +
      `${d.apartment.intercom ? `🔔 Домофон: ${e(d.apartment.intercom)}\n` : ''}${d.apartment.lockCode ? `🔢 Код замка: <b>${e(d.apartment.lockCode)}</b>\n` : ''}` +
      `${d.apartment.keyboxCode ? `🗝 Ключница: ${e(d.apartment.keyboxCode)}\n` : ''}${d.apartment.wifiName ? `📶 Wi‑Fi: ${e(d.apartment.wifiName)}${d.apartment.wifiPassword ? ' / ' + e(d.apartment.wifiPassword) : ''}\n` : ''}` +
      `⏰ Заезд с ${d.booking.checkInTime}, выезд до ${d.booking.checkOutTime}`,
    'transfer.requested': d => `🚗 <b>Заказ трансфера</b>${d.booking ? ` к брони №${d.booking.number}` : ''}\n` +
      `${DIR.ru[d.transfer.direction]} · ${PLACE.ru[d.transfer.place]} · ${day(d.transfer.date, 'ru')} ${d.transfer.time}${d.transfer.flight ? ' · ' + e(d.transfer.flight) : ''}\n` +
      `👤 ${e(d.transfer.guestName || d.guest?.name)} ${e(d.transfer.guestPhone || '')} · ${d.transfer.pax} пасс.\n💳 ${money(d.transfer.priceKzt)}\n\nНазначьте водителя в админке.`,
    'transfer.assigned': d => `🚗 <b>Трансфер подтверждён</b>\n${DIR.ru[d.transfer.direction]} · ${day(d.transfer.date, 'ru')} ${d.transfer.time}${d.transfer.flight ? ' · рейс ' + e(d.transfer.flight) : ''}\n` +
      `${d.transfer.driverName ? `👨‍✈️ Водитель: ${e(d.transfer.driverName)}\n` : ''}${d.transfer.sign ? `🪧 Табличка: ${e(d.transfer.sign)}\n` : ''}💳 ${money(d.transfer.priceKzt)}`,
    'cleaning.reported': d => `🧹 <b>Уборка ${d.task.status === 'done' ? 'завершена' : 'обновлена'}</b>\n🏠 ${e(d.apartment.title)}\n👤 ${e(d.assignee?.name || '—')}` +
      `${d.task.report ? `\n💬 ${e(d.task.report)}` : ''}`,
    'repair.assigned': d => `🛠 <b>Новая заявка</b>${d.task.quickJob ? ' · простая работа' : ''}\n🔧 ${e(d.task.title)}\n🏠 ${aptNo(d.apartment)}\n👥 ${OCC.ru[d.task.occupancy] || ''}` +
      `${d.task.description ? `\n💬 ${e(d.task.description)}` : ''}\n\nОцените без выезда, по фото или запросите выезд.`,
    'repair.visit_requested': d => `🚗 <b>Мастеру нужен выезд</b>\n🔧 ${e(d.task.title)} · ${e(d.apartment.title)}\n👤 ${e(d.assignee?.name || '—')}${d.note ? `\n💬 ${e(d.note)}` : ''}\n\nУкажите, кто будет в квартире.`,
    'estimate.submitted': d => `🧾 <b>Смета ждёт одобрения</b> (${METHOD.ru[d.estimate.method] || ''}, предварительная)\n🔧 ${e(d.task.title)} · ${e(d.apartment.title)}\n` +
      `Работа ${money(d.estimate.workKzt)}${d.estimate.materialsIncluded ? ` + материалы ${money(d.estimate.partsKzt)}` : ' · материалы отдельно'} = <b>${range(d.estimate)}</b>` +
      `${d.estimate.items ? `\n📦 ${e(d.estimate.items)}` : ''}${d.estimate.comment ? `\n💬 ${e(d.estimate.comment)}` : ''}${d.estimate.byName ? `\n👤 ${e(d.estimate.byName)}` : ''}\n\nОдобрите или отклоните в админке.`,
    'estimate.decided': d => d.estimate.status === 'approved'
      ? `✅ <b>Смета одобрена</b>: ${range(d.estimate)}\n🔧 ${e(d.task.title)} · ${e(d.apartment.title)}\nМожно начинать работу.`
      : `↩️ <b>Смета отклонена</b>\n🔧 ${e(d.task.title)} · ${e(d.apartment.title)}${d.estimate.rejectReason ? `\n💬 ${e(d.estimate.rejectReason)}` : ''}\nПришлите новую смету или запросите выезд.`,
    'extra.submitted': d => `➕ <b>Доп. расход ждёт решения</b>: ${money(d.extra.amountKzt)}\n🔧 ${e(d.task.title)} · ${e(d.apartment.title)}\n📝 ${e(d.extra.description)}\n❓ ${e(d.extra.reason)}${d.extra.byName ? `\n👤 ${e(d.extra.byName)}` : ''}`,
    'extra.decided': d => `${d.extra.status === 'APPROVED' ? '✅ <b>Доп. расход одобрен</b>' : '❌ <b>Доп. расход отклонён</b>'}: ${money(d.extra.amountKzt)}\n🔧 ${e(d.task.title)}\n📝 ${e(d.extra.description)}${d.extra.decisionNote ? `\n💬 ${e(d.extra.decisionNote)}` : ''}`,
    'repair.reported': d => `🔧 <b>Заявка: ${e(d.task.title)}</b> — ${ST_RU[d.task.status] || d.task.status}\n🏠 ${e(d.apartment.title)}\n👤 ${e(d.assignee?.name || d.task.assigneeLabel || '—')}` +
      `${d.task.finalCostKzt != null ? `\n💳 Итог: ${money(d.task.finalCostKzt)}` : ''}${d.task.report ? `\n💬 ${e(d.task.report)}` : ''}`,
    'repair.cancelled': d => `🚫 <b>Заявка отменена</b>\n🔧 ${e(d.task.title)} · ${e(d.apartment.title)}${d.task.cancelReason ? `\n💬 ${e(d.task.cancelReason)}` : ''}`,
    'repair.occupancy_changed': d => `👥 <b>${e(d.task.title)}</b>: ${OCC.ru[d.task.occupancy]}\n🏠 ${e(d.apartment.title)}${d.task.occupancy === 'EMPTY' && d.task.accessInstructions ? `\n🔑 Как попасть: ${e(d.task.accessInstructions)}` : ''}`,
    'payment.succeeded': d => `💳 <b>Оплата получена</b> · бронь №${d.booking?.number ?? '—'}\n${money(d.payment.amountKzt)} через ${e(d.payment.provider)}`,
    'telegram.linked': d => `🔗 Telegram подключён. Теперь сюда будут приходить уведомления${d.accountName ? ` «${e(d.accountName)}»` : ''}.`,
  },
  en: {
    'booking.requested': d => `🆕 <b>New request #${d.booking.number}</b> (${d.booking.source})\n🏠 ${e(d.apartment.titleEn || d.apartment.title)}\n` +
      `📅 ${day(d.booking.checkIn, 'en')} → ${day(d.booking.checkOut, 'en')} · ${d.nights} nights · ${d.booking.guestsCount} guests\n👤 ${e(d.guest?.name)} ${e(d.guest?.phone || '')}\n` +
      `💳 ${money(d.booking.totalKzt)}${d.booking.paymentMethod ? ' · ' + (PAY.en[d.booking.paymentMethod] || d.booking.paymentMethod) : ''}${d.booking.note ? `\n💬 “${e(d.booking.note)}”` : ''}\n\nPlease confirm it in the admin panel.`,
    'booking.confirmed': d => `✅ <b>Booking #${d.booking.number} is confirmed</b>\n🏠 ${e(d.apartment.titleEn || d.apartment.title)}\n📍 ${e(d.apartment.address)}\n` +
      `📅 Check-in ${day(d.booking.checkIn, 'en')} from ${d.booking.checkInTime}, check-out ${day(d.booking.checkOut, 'en')} by ${d.booking.checkOutTime}\n💳 ${money(d.booking.totalKzt)}\n\nWe will send check-in instructions the day before arrival.`,
    'checkin.upcoming': d => `🔑 <b>Check-in ${d.when}</b> · booking #${d.booking.number}\n🏠 ${e(d.apartment.titleEn || d.apartment.title)}\n👤 ${e(d.guest?.name)} · ${d.booking.guestsCount} guests · ${d.booking.checkInTime}\n` +
      `${d.transfer ? `🚗 Transfer ${d.transfer.time}${d.transfer.flight ? ', flight ' + e(d.transfer.flight) : ''}\n` : ''}${d.booking.paymentStatus !== 'paid' ? '⚠️ Not fully paid' : '💳 Paid'}`,
    'guest.checkin_instructions': d => `🔑 <b>Check-in instructions</b> · booking #${d.booking.number}\n📍 ${e(d.apartment.address)}\n` +
      `${d.apartment.entrance ? `🚪 Entrance ${e(d.apartment.entrance)}${d.apartment.floor ? `, floor ${d.apartment.floor}` : ''}\n` : ''}${d.apartment.intercom ? `🔔 Intercom: ${e(d.apartment.intercom)}\n` : ''}` +
      `${d.apartment.lockCode ? `🔢 Door code: <b>${e(d.apartment.lockCode)}</b>\n` : ''}${d.apartment.keyboxCode ? `🗝 Key box: ${e(d.apartment.keyboxCode)}\n` : ''}` +
      `${d.apartment.wifiName ? `📶 Wi‑Fi: ${e(d.apartment.wifiName)}${d.apartment.wifiPassword ? ' / ' + e(d.apartment.wifiPassword) : ''}\n` : ''}⏰ Check-in from ${d.booking.checkInTime}, check-out by ${d.booking.checkOutTime}`,
    'transfer.requested': d => `🚗 <b>Transfer order</b>${d.booking ? ` for booking #${d.booking.number}` : ''}\n${DIR.en[d.transfer.direction]} · ${PLACE.en[d.transfer.place]} · ${day(d.transfer.date, 'en')} ${d.transfer.time}${d.transfer.flight ? ' · ' + e(d.transfer.flight) : ''}\n` +
      `👤 ${e(d.transfer.guestName || d.guest?.name)} ${e(d.transfer.guestPhone || '')} · ${d.transfer.pax} pax\n💳 ${money(d.transfer.priceKzt)}\n\nAssign a driver in the admin panel.`,
    'transfer.assigned': d => `🚗 <b>Your transfer is confirmed</b>\n${DIR.en[d.transfer.direction]} · ${day(d.transfer.date, 'en')} ${d.transfer.time}${d.transfer.flight ? ' · flight ' + e(d.transfer.flight) : ''}\n` +
      `${d.transfer.driverName ? `👨‍✈️ Driver: ${e(d.transfer.driverName)}\n` : ''}${d.transfer.sign ? `🪧 Name sign: ${e(d.transfer.sign)}\n` : ''}💳 ${money(d.transfer.priceKzt)}`,
    'cleaning.reported': d => `🧹 <b>Cleaning ${d.task.status === 'done' ? 'finished' : 'updated'}</b>\n🏠 ${e(d.apartment.titleEn || d.apartment.title)}\n👤 ${e(d.assignee?.name || '—')}${d.task.report ? `\n💬 ${e(d.task.report)}` : ''}`,
    'repair.assigned': d => `🛠 <b>New work request</b>${d.task.quickJob ? ' · quick job' : ''}\n🔧 ${e(d.task.title)}\n🏠 ${aptNo(d.apartment)}\n👥 ${OCC.en[d.task.occupancy] || ''}` +
      `${d.task.description ? `\n💬 ${e(d.task.description)}` : ''}\n\nEstimate remotely, from photos, or request a visit.`,
    'repair.visit_requested': d => `🚗 <b>The handyman needs a visit</b>\n🔧 ${e(d.task.title)} · ${e(d.apartment.titleEn || d.apartment.title)}\n👤 ${e(d.assignee?.name || '—')}${d.note ? `\n💬 ${e(d.note)}` : ''}\n\nSet who will be in the apartment.`,
    'estimate.submitted': d => `🧾 <b>Estimate awaiting approval</b> (${METHOD.en[d.estimate.method] || ''}, preliminary)\n🔧 ${e(d.task.title)} · ${e(d.apartment.titleEn || d.apartment.title)}\n` +
      `Labour ${money(d.estimate.workKzt)}${d.estimate.materialsIncluded ? ` + materials ${money(d.estimate.partsKzt)}` : ' · materials extra'} = <b>${range(d.estimate)}</b>` +
      `${d.estimate.items ? `\n📦 ${e(d.estimate.items)}` : ''}${d.estimate.comment ? `\n💬 ${e(d.estimate.comment)}` : ''}${d.estimate.byName ? `\n👤 ${e(d.estimate.byName)}` : ''}\n\nApprove or reject it in the admin panel.`,
    'estimate.decided': d => d.estimate.status === 'approved'
      ? `✅ <b>Estimate approved</b>: ${range(d.estimate)}\n🔧 ${e(d.task.title)}\nYou can start the work.`
      : `↩️ <b>Estimate rejected</b>\n🔧 ${e(d.task.title)}${d.estimate.rejectReason ? `\n💬 ${e(d.estimate.rejectReason)}` : ''}\nSend a new estimate or request a visit.`,
    'extra.submitted': d => `➕ <b>Extra expense awaiting decision</b>: ${money(d.extra.amountKzt)}\n🔧 ${e(d.task.title)}\n📝 ${e(d.extra.description)}\n❓ ${e(d.extra.reason)}${d.extra.byName ? `\n👤 ${e(d.extra.byName)}` : ''}`,
    'extra.decided': d => `${d.extra.status === 'APPROVED' ? '✅ <b>Extra expense approved</b>' : '❌ <b>Extra expense rejected</b>'}: ${money(d.extra.amountKzt)}\n🔧 ${e(d.task.title)}${d.extra.decisionNote ? `\n💬 ${e(d.extra.decisionNote)}` : ''}`,
    'repair.reported': d => `🔧 <b>Work request: ${e(d.task.title)}</b> — ${String(d.task.status).toLowerCase().replace(/_/g, ' ')}\n🏠 ${e(d.apartment.titleEn || d.apartment.title)}\n👤 ${e(d.assignee?.name || d.task.assigneeLabel || '—')}` +
      `${d.task.finalCostKzt != null ? `\n💳 Final: ${money(d.task.finalCostKzt)}` : ''}${d.task.report ? `\n💬 ${e(d.task.report)}` : ''}`,
    'repair.cancelled': d => `🚫 <b>Work request cancelled</b>\n🔧 ${e(d.task.title)}${d.task.cancelReason ? `\n💬 ${e(d.task.cancelReason)}` : ''}`,
    'repair.occupancy_changed': d => `👥 <b>${e(d.task.title)}</b>: ${OCC.en[d.task.occupancy]}${d.task.occupancy === 'EMPTY' && d.task.accessInstructions ? `\n🔑 How to get in: ${e(d.task.accessInstructions)}` : ''}`,
    'payment.succeeded': d => `💳 <b>Payment received</b> · booking #${d.booking?.number ?? '—'}\n${money(d.payment.amountKzt)} via ${e(d.payment.provider)}`,
    'telegram.linked': d => `🔗 Telegram connected. Notifications${d.accountName ? ` from “${e(d.accountName)}”` : ''} will arrive here.`,
  },
};

export function render(event, lang, data) {
  const t = (templates[lang] || templates.ru)[event] || templates.ru[event];
  if (!t) throw new Error(`Нет шаблона уведомления для события ${event}`);
  return t(data);
}
