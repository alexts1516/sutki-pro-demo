// «Транспорт» — куда физически уходит сообщение.
// telegram — через бота (нужен TELEGRAM_BOT_TOKEN); console — просто печать в консоль (бот выключен).
export function telegramTransport(api) {
  return {
    name: 'telegram',
    async send(chatId, text) {
      await api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    },
  };
}
export function consoleTransport({ quiet = false } = {}) {
  return {
    name: 'console',
    async send(chatId, text, to = '') { if (!quiet) console.log(`[уведомление${to ? ' для ' + to : ''} → ${chatId || 'журнал'}]\n${text}\n`); },
  };
}
