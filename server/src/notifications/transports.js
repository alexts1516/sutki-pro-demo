// «Транспорт» — куда физически уходит сообщение.
// telegram — через бота (нужен TELEGRAM_BOT_TOKEN); console — просто печать в консоль (бот выключен).
export function telegramTransport(api) {
  return {
    name: 'telegram',
    /** buttons — кнопки под сообщением: [[{ text, data }]] (callback_data до 64 байт) */
    async send(chatId, text, { buttons = null } = {}) {
      const extra = buttons ? { reply_markup: { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.text, callback_data: b.data }))) } } : {};
      await api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
    },
  };
}
export function consoleTransport({ quiet = false } = {}) {
  return {
    name: 'console',
    async send(chatId, text, to = '') { if (!quiet) console.log(`[уведомление${to ? ' для ' + to : ''} → ${chatId || 'журнал'}]\n${text}\n`); },
  };
}
