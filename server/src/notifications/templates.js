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

const ST_RU = { NEW: 'Новая', VISIT_INSPECTION: 'Выезд / осмотр', AWAITING_OWNER_APPROVAL: 'Ждёт одобрения сметы', REJECTED: 'Смета отклонена', APPROVED: 'Смета одобрена', IN_PROGRESS: 'В работе', DONE: 'Выполнена', CANCELLED: 'Отменена' };
const METHOD = { ru: { REMOTE: 'без выезда', PHOTOS: 'по фото', VISIT: 'после осмотра' }, en: { REMOTE: 'remote, no visit', PHOTOS: 'from photos', VISIT: 'after inspection' } };
const OCC = { ru: { OWNER_PRESENT: 'владелец будет в квартире', EMPTY: 'квартира пустая', UNKNOWN: 'пока неизвестно, кто будет' }, en: { OWNER_PRESENT: 'the owner will be there', EMPTY: 'the apartment will be empty', UNKNOWN: 'not known yet who will be there' } };
const total = (x) => x.workKzt + (x.partsKzt || 0);
const range = (x) => money(total(x)) + (x.maxKzt ? ' – ' + money(x.maxKzt) : '');
const hm = (d) => d ? new Date(d).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }) : '';
// трансфер: d.transfer — поездка, d.job — заказ водителю, d.trip — { from, to }
const J = (d) => d.job || {}, T = (d) => d.trip || {};
// выплата водителю в сообщении: везёт владелец / человек «от бизнеса» — «без выплаты»
const NOPAY = ['owner', 'business'];
const pay = (d, ru, prefix) => NOPAY.includes(J(d).payoutRule) ? `\n💵 ${ru ? 'Без выплаты — вся сумма бизнесу' : 'No payout — the full amount stays with the business'}`
  : J(d).payoutKzt != null ? `\n💵 ${prefix}${money(J(d).payoutKzt)}` : '';
const when = (d, l) => `${DIR[l][d.transfer.direction]} · ${day(d.transfer.date, l)} ${d.transfer.time}${d.transfer.flight ? (l === 'en' ? ' · flight ' : ' · рейс ') + e(d.transfer.flight) : ''}`;
const way = (d) => T(d).from ? `\n📍 ${e(T(d).from)} → ${e(T(d).to)}` : '';
const pax = (d, l) => l === 'en'
  ? `👤 ${e(d.transfer.guestName || '')} · ${d.transfer.pax} pax · ${d.transfer.bags ?? 0} bags${d.transfer.childSeats ? ` · child seats: ${d.transfer.childSeats}` : ''}`
  : `👤 ${e(d.transfer.guestName || '')} · ${d.transfer.pax} пасс. · багаж ${d.transfer.bags ?? 0}${d.transfer.childSeats ? ` · детских кресел: ${d.transfer.childSeats}` : ''}`;
const kv = (a) => (a?.code ? `кв. ${e(a.code)}` : e(a?.title || ''));
const ticks = (t) => { const l = t.checklist || []; return `${l.filter(x => x.done).length}/${l.length}`; };
// выплата исполнителю: «Гульнара закончила подготовку кв. 12 — к оплате 5 000 ₸»
const fem = (n) => /[аяАЯ]$/.test(String(n || '').trim().split(/\s+/)[0] || '');
const payoutLine = (d) => {
  const n = d.payout.name || 'Исполнитель', f = fem(n), done = f ? 'закончила' : 'закончил';
  const what = d.payout.kind === 'cleaning' ? `${done} подготовку ${kv(d.apartment)}` : d.payout.kind === 'repair' ? `${done} работу «${e(d.task?.title || '')}» ${kv(d.apartment)}` : `${f ? 'выполнила' : 'выполнил'} ${e((d.payout.title || 'трансфер').replace(/^Трансфер/, 'трансфер'))}`;
  return `${e(n)} ${what} — к оплате <b>${money(d.payout.amountKzt)}</b>`;
};
const aptNo = (a) => `${e(a.title)}${a.address ? `\n📍 ${e(a.address)}` : ''}`;

const specialDetails = (d, l) => `🏠 ${e(d.apartment.title)}\n📅 ${day(d.booking.checkIn, l)} → ${day(d.booking.checkOut, l)}${d.guest?.name ? `\n👤 ${e(d.guest.name)}` : ''}`;
const holdTime = d => d.booking.holdUntil ? new Intl.DateTimeFormat('ru-RU', { timeZone: d.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d.booking.holdUntil)) : '—';
const bookingStatus = (s, l) => (l === 'en' ? { request: 'request', confirmed: 'confirmed', cancelled: 'cancelled', completed: 'completed' } : { request: 'заявка', confirmed: 'подтверждена', cancelled: 'отменена', completed: 'завершена' })[s] || s;

export const templates = {
  ru: {
    'link.started': d => `👤 <b>Гость начал оформление особой брони №${d.booking.number}</b>\n${specialDetails(d, 'ru')}\n⏰ Даты удерживаются до ${holdTime(d)}`,
    'link.completed': d => `✅ <b>Особая бронь №${d.booking.number} подтверждена</b>\n${specialDetails(d, 'ru')}\n💳 ${money(d.booking.totalKzt)}\nПодготовка и дальнейшая работа — в обычном операционном потоке.`,
    'link.expired': d => `⌛ <b>Особая бронь №${d.booking.number} истекла</b> — гость не завершил оформление, даты освобождены.\n${specialDetails(d, 'ru')}`,
    'link.conflict': d => `🚨 <b>Конфликт по особой брони №${d.booking.number}</b>: ремонт пересекается с бронью.\n${specialDetails(d, 'ru')}\nСтатус брони: ${e(bookingStatus(d.booking.status, 'ru'))}.\nОткройте «Сегодня» и решите конфликт.`,
    'payment.orphaned': d => `🚨 <b>Оплата без доступной брони №${d.booking.number} — требуется возврат</b>\n${specialDetails(d, 'ru')}\n💳 ${money(d.payment.amountKzt)}\nОплата получена, но бронь восстановить нельзя. Откройте «Сегодня» и оформите возврат.`,
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
      `${d.transfer.driverName ? `👨‍✈️ Водитель: ${e(d.transfer.driverName)}${J(d).vehicle ? `, ${e(J(d).vehicle)}` : ''}\n` : ''}${d.transfer.sign ? `🪧 Табличка: ${e(d.transfer.sign)}\n` : ''}💳 ${money(d.transfer.priceKzt)}`,
    'transfer.offered': d => `🚗 <b>Новый заказ на трансфер — кто возьмёт?</b>\n${when(d, 'ru')}${way(d)}\n${pax(d, 'ru')}` +
      `${J(d).notes ? `\n💬 ${e(J(d).notes)}` : ''}${pay(d, true, 'Вам за поездку: ')}\n\nНажмите «Беру» под сообщением или в приложении команды (/app). Заказ получает первый. Номер квартиры и телефон гостя — после «Беру».`,
    'transfer.accepted': d => `✅ <b>Трансфер взял ${e(J(d).driverName)}</b>${J(d).vehicle ? ` (${e(J(d).vehicle)})` : ''}\n${when(d, 'ru')}${way(d)}\n${pax(d, 'ru')}${d.booking ? `\nБронь №${d.booking.number}` : ''}`,
    'transfer.driver_assigned': d => `🚗 <b>Вам назначен трансфер</b>\n${when(d, 'ru')}${way(d)}\n${pax(d, 'ru')}` +
      `${d.transfer.guestPhone ? `\n📞 Гость: ${e(d.transfer.guestPhone)}` : ''}${d.transfer.sign ? `\n🪧 Табличка: ${e(d.transfer.sign)}` : ''}` +
      `${J(d).meetingPoint ? `\n📌 Встреча: ${e(J(d).meetingPoint)}` : ''}${J(d).freeWaitMin ? `\n⏱ Бесплатное ожидание: ${J(d).freeWaitMin} мин` : ''}${pay(d, true, '')}` +
      `${d.link ? `\n\nОтмечайте шаги по ссылке: ${e(d.link)}` : ''}`,
    'transfer.driver_removed': d => `↩️ <b>Трансфер передан другому водителю</b>\n${when(d, 'ru')}${way(d)}\nЕхать не нужно.`,
    'transfer.unassigned': d => `${d.urgent ? '🚨 <b>Срочно: трансфер без водителя</b>' : '⚠️ <b>Никто не взял трансфер</b>'}${d.reason ? ` (${e(d.reason)})` : ''}\n${when(d, 'ru')}${way(d)}\n${pax(d, 'ru')}\n\nНазначьте водителя вручную: админка → «Трансферы».`,
    'transfer.released': d => `↩️ <b>${e(d.byName || 'Водитель')} отказался от трансфера</b>${d.reason ? `\n💬 ${e(d.reason)}` : ''}\n${when(d, 'ru')}${way(d)}\nЗаказ снова предложен всем водителям.`,
    'transfer.updated': d => `🕒 <b>Изменения в трансфере</b>${d.byName ? ` (${e(d.byName)})` : ''}\n${d.reason ? `✈️ ${e(d.reason)}\n` : ''}${d.before ? `Было: ${e(d.before)}\nСтало: ${e(d.after)}\n` : ''}${when(d, 'ru')}${way(d)}\n${pax(d, 'ru')}`,
    'transfer.cancelled': d => `🚫 <b>Трансфер отменён</b>${J(d).cancelReason ? ` — ${e(J(d).cancelReason)}` : ''}\n${when(d, 'ru')}${way(d)}\nЕхать не нужно.`,
    'transfer.reminder': d => `⏰ <b>Скоро подача</b>\n${when(d, 'ru')}${way(d)}\n${pax(d, 'ru')}${d.transfer.guestPhone ? `\n📞 ${e(d.transfer.guestPhone)}` : ''}${d.transfer.sign ? `\n🪧 Табличка: ${e(d.transfer.sign)}` : ''}` +
      `${d.transfer.flight ? '\nПроверьте рейс — если задерживается, поменяйте время в приложении.' : ''}`,
    'transfer.en_route': d => `🚗 <b>Водитель выехал</b>\n${e(J(d).driverName || '')}${J(d).vehicle ? `, ${e(J(d).vehicle)}` : ''}${J(d).etaAt ? `\nБудет примерно в ${hm(J(d).etaAt)}` : ''}`,
    'transfer.driver_arrived': d => `📍 <b>Водитель на месте</b>\n${e(J(d).driverName || '')}${J(d).vehicle ? `, ${e(J(d).vehicle)}` : ''}${d.transfer.sign ? `\n🪧 Табличка: ${e(d.transfer.sign)}` : ''}` +
      `${J(d).meetingPoint ? `\n📌 ${e(J(d).meetingPoint)}` : ''}${J(d).freeWaitMin ? `\n⏱ Бесплатно ждёт ${J(d).freeWaitMin} мин` : ''}`,
    'cleaning.reported': d => `✨ <b>Подготовка ${kv(d.apartment)} — ${e(d.assignee?.name || '—')}: ${d.task.status === 'done' ? 'готово' : 'обновлено'}</b>` +
      `${d.task.startedAt || d.task.doneAt ? `\n🕐 ${hm(d.task.startedAt) || '—'} – ${hm(d.task.doneAt) || '—'}` : ''}${(d.task.checklist || []).length ? `\n✅ Чек-лист: ${ticks(d.task)}` : ''}` +
      `${(d.task.problems || []).length ? `\n⚠️ Проблем: ${d.task.problems.length}` : ''}${d.task.finishNote ? `\n📝 Не всё отмечено: ${e(d.task.finishNote)}` : ''}${d.task.report && d.task.report !== d.task.finishNote ? `\n💬 ${e(d.task.report)}` : ''}`,
    'cleaning.problem': d => `⚠️ <b>${d.problem.urgent ? 'Срочный недочёт' : 'Недочёт'} — ${kv(d.apartment)}</b>${d.problem.urgent ? '\n⛔ Квартира не готова, пока не решите' : ''}\n👤 ${e(d.problem.byName || d.assignee?.name || '—')}\n💬 ${e(d.problem.text)}${d.problem.photoIds?.length ? `\n📷 Фото: ${d.problem.photoIds.length}` : ''}\n\nВ админке: «Сегодня» → «Заявка мастеру», «Сделаю сам» или «Решено».`,
    'repair.declined': d => `↩️ <b>Мастер отказался от заявки</b>\n🔧 ${e(d.task.title)} · ${kv(d.apartment)}\n👤 ${e(d.by || '—')}\n💬 ${e(d.reason || '')}\n\nВыберите другого мастера в админке.`,
    'payout.created': d => `💵 ${payoutLine(d)}\n\nОтметьте выплату кнопкой ниже или в админке → «Выплаты».`,
    'payout.reminder': d => `⏰ <b>Не выплачено больше ${d.hours} ч</b>\n${payoutLine(d)}\n\nОтметьте выплату кнопкой ниже или в админке → «Выплаты».`,
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
    'link.started': d => `👤 <b>Guest started special booking #${d.booking.number}</b>\n${specialDetails(d, 'en')}\n⏰ Dates held until ${holdTime(d)}`,
    'link.completed': d => `✅ <b>Special booking #${d.booking.number} confirmed</b>\n${specialDetails(d, 'en')}\n💳 ${money(d.booking.totalKzt)}\nPreparation and further operations follow the standard booking workflow.`,
    'link.expired': d => `⌛ <b>Special booking #${d.booking.number} expired</b> — the guest did not finish; dates released.\n${specialDetails(d, 'en')}`,
    'link.conflict': d => `🚨 <b>Conflict for special booking #${d.booking.number}</b>: repair overlaps the booking.\n${specialDetails(d, 'en')}\nBooking status: ${e(bookingStatus(d.booking.status, 'en'))}.\nOpen Today and resolve the conflict.`,
    'payment.orphaned': d => `🚨 <b>Payment without available booking #${d.booking.number} — refund required</b>\n${specialDetails(d, 'en')}\n💳 ${money(d.payment.amountKzt)}\nPayment received, but the booking cannot be restored. Open Today and arrange a refund.`,
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
      `${d.transfer.driverName ? `👨‍✈️ Driver: ${e(d.transfer.driverName)}${J(d).vehicle ? `, ${e(J(d).vehicle)}` : ''}\n` : ''}${d.transfer.sign ? `🪧 Name sign: ${e(d.transfer.sign)}\n` : ''}💳 ${money(d.transfer.priceKzt)}`,
    'transfer.offered': d => `🚗 <b>New transfer job — who takes it?</b>\n${when(d, 'en')}${way(d)}\n${pax(d, 'en')}` +
      `${J(d).notes ? `\n💬 ${e(J(d).notes)}` : ''}${pay(d, false, 'Your pay: ')}\n\nTap “Take it” below or in the team app (/app). First to accept gets it. Apartment number and guest phone are shown after you accept.`,
    'transfer.accepted': d => `✅ <b>${e(J(d).driverName)} took the transfer</b>${J(d).vehicle ? ` (${e(J(d).vehicle)})` : ''}\n${when(d, 'en')}${way(d)}\n${pax(d, 'en')}${d.booking ? `\nBooking #${d.booking.number}` : ''}`,
    'transfer.driver_assigned': d => `🚗 <b>You are assigned a transfer</b>\n${when(d, 'en')}${way(d)}\n${pax(d, 'en')}` +
      `${d.transfer.guestPhone ? `\n📞 Guest: ${e(d.transfer.guestPhone)}` : ''}${d.transfer.sign ? `\n🪧 Name sign: ${e(d.transfer.sign)}` : ''}` +
      `${J(d).meetingPoint ? `\n📌 Meeting point: ${e(J(d).meetingPoint)}` : ''}${J(d).freeWaitMin ? `\n⏱ Free waiting: ${J(d).freeWaitMin} min` : ''}${pay(d, false, '')}` +
      `${d.link ? `\n\nUpdate the steps via the link: ${e(d.link)}` : ''}`,
    'transfer.driver_removed': d => `↩️ <b>The transfer was given to another driver</b>\n${when(d, 'en')}${way(d)}\nNo need to go.`,
    'transfer.unassigned': d => `${d.urgent ? '🚨 <b>Urgent: transfer has no driver</b>' : '⚠️ <b>Nobody took the transfer</b>'}${d.reason ? ` (${e(d.reason)})` : ''}\n${when(d, 'en')}${way(d)}\n${pax(d, 'en')}\n\nAssign a driver manually: admin → “Transfers”.`,
    'transfer.released': d => `↩️ <b>${e(d.byName || 'The driver')} dropped the transfer</b>${d.reason ? `\n💬 ${e(d.reason)}` : ''}\n${when(d, 'en')}${way(d)}\nOffered to all drivers again.`,
    'transfer.updated': d => `🕒 <b>Transfer changed</b>${d.byName ? ` (${e(d.byName)})` : ''}\n${d.reason ? `✈️ ${e(d.reason)}\n` : ''}${d.before ? `Was: ${e(d.before)}\nNow: ${e(d.after)}\n` : ''}${when(d, 'en')}${way(d)}\n${pax(d, 'en')}`,
    'transfer.cancelled': d => `🚫 <b>Transfer cancelled</b>${J(d).cancelReason ? ` — ${e(J(d).cancelReason)}` : ''}\n${when(d, 'en')}${way(d)}\nNo need to go.`,
    'transfer.reminder': d => `⏰ <b>Pickup soon</b>\n${when(d, 'en')}${way(d)}\n${pax(d, 'en')}${d.transfer.guestPhone ? `\n📞 ${e(d.transfer.guestPhone)}` : ''}${d.transfer.sign ? `\n🪧 Name sign: ${e(d.transfer.sign)}` : ''}` +
      `${d.transfer.flight ? '\nCheck the flight — if it is delayed, change the time in the app.' : ''}`,
    'transfer.en_route': d => `🚗 <b>Your driver is on the way</b>\n${e(J(d).driverName || '')}${J(d).vehicle ? `, ${e(J(d).vehicle)}` : ''}${J(d).etaAt ? `\nExpected around ${hm(J(d).etaAt)}` : ''}`,
    'transfer.driver_arrived': d => `📍 <b>Your driver has arrived</b>\n${e(J(d).driverName || '')}${J(d).vehicle ? `, ${e(J(d).vehicle)}` : ''}${d.transfer.sign ? `\n🪧 Name sign: ${e(d.transfer.sign)}` : ''}` +
      `${J(d).meetingPoint ? `\n📌 ${e(J(d).meetingPoint)}` : ''}${J(d).freeWaitMin ? `\n⏱ Free waiting: ${J(d).freeWaitMin} min` : ''}`,
    'cleaning.problem': d => `⚠️ <b>Problem found during preparation</b> · ${e(d.apartment.titleEn || d.apartment.title)}\n💬 ${e(d.problem.text)}`,
    'repair.declined': d => `↩️ <b>The handyman declined the request</b>\n🔧 ${e(d.task.title)}\n💬 ${e(d.reason || '')}\n\nPick another handyman in the admin panel.`,
    'payout.created': d => `💵 ${e(d.payout.name || '')}: ${e(d.payout.title || '')} — to pay <b>${money(d.payout.amountKzt)}</b>`,
    'payout.reminder': d => `⏰ <b>Unpaid for over ${d.hours} h</b>\n${e(d.payout.name || '')}: ${e(d.payout.title || '')} — ${money(d.payout.amountKzt)}`,
    'cleaning.reported': d => `✨ <b>Preparation ${d.task.status === 'done' ? 'finished' : 'updated'}</b>\n🏠 ${e(d.apartment.titleEn || d.apartment.title)}\n👤 ${e(d.assignee?.name || '—')}${d.task.report ? `\n💬 ${e(d.task.report)}` : ''}`,
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
