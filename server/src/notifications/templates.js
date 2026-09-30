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
    'repair.reported': d => `🔧 <b>Ремонт: ${e(d.task.title)}</b> — ${d.task.status === 'done' ? 'выполнено' : 'в работе'}\n🏠 ${e(d.apartment.title)}\n👤 ${e(d.assignee?.name || d.task.assigneeLabel || '—')}` +
      `${d.task.report ? `\n💬 ${e(d.task.report)}` : ''}`,
    'estimate.submitted': d => `🧾 <b>Смета ждёт одобрения</b>\n🔧 ${e(d.task.title)} · ${e(d.apartment.title)}\nРабота ${money(d.estimate.workKzt)} + материалы ${money(d.estimate.partsKzt)} = <b>${money(d.estimate.workKzt + d.estimate.partsKzt)}</b>` +
      `${d.estimate.items ? `\n📦 ${e(d.estimate.items)}` : ''}${d.estimate.byName ? `\n👤 ${e(d.estimate.byName)}` : ''}\n\nОдобрите или отклоните в админке.`,
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
    'repair.reported': d => `🔧 <b>Repair: ${e(d.task.title)}</b> — ${d.task.status === 'done' ? 'done' : 'in progress'}\n🏠 ${e(d.apartment.titleEn || d.apartment.title)}\n👤 ${e(d.assignee?.name || d.task.assigneeLabel || '—')}${d.task.report ? `\n💬 ${e(d.task.report)}` : ''}`,
    'estimate.submitted': d => `🧾 <b>Estimate awaiting approval</b>\n🔧 ${e(d.task.title)} · ${e(d.apartment.titleEn || d.apartment.title)}\nLabour ${money(d.estimate.workKzt)} + parts ${money(d.estimate.partsKzt)} = <b>${money(d.estimate.workKzt + d.estimate.partsKzt)}</b>` +
      `${d.estimate.items ? `\n📦 ${e(d.estimate.items)}` : ''}${d.estimate.byName ? `\n👤 ${e(d.estimate.byName)}` : ''}\n\nApprove or reject it in the admin panel.`,
    'payment.succeeded': d => `💳 <b>Payment received</b> · booking #${d.booking?.number ?? '—'}\n${money(d.payment.amountKzt)} via ${e(d.payment.provider)}`,
    'telegram.linked': d => `🔗 Telegram connected. Notifications${d.accountName ? ` from “${e(d.accountName)}”` : ''} will arrive here.`,
  },
};

export function render(event, lang, data) {
  const t = (templates[lang] || templates.ru)[event] || templates.ru[event];
  if (!t) throw new Error(`Нет шаблона уведомления для события ${event}`);
  return t(data);
}
