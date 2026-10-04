// Простая шина событий: код API сообщает «что случилось» (events.emit('booking.requested', {...})),
// а сервис уведомлений сам решает, кому и что написать. Ошибки уведомлений не ломают запрос гостя.
export function createEventBus({ logger = console } = {}) {
  const handlers = new Map();
  const pending = new Set();
  return {
    on(name, fn) { (handlers.get(name) || handlers.set(name, []).get(name)).push(fn); },
    onAny(fn) { this.on('*', fn); },
    emit(name, payload) {
      const list = [...(handlers.get(name) || []), ...(handlers.get('*') || [])];
      for (const fn of list) {
        const p = Promise.resolve().then(() => fn(payload, name)).catch(e => logger.error(`[events] ${name}:`, e.message));
        pending.add(p); p.finally(() => pending.delete(p));
      }
    },
    /** Outbox: дождаться именно этого события и передать ошибку для повтора. Обычный emit сохраняет прежнее поведение. */
    async emitAsync(name, payload) {
      const list = [...(handlers.get(name) || []), ...(handlers.get('*') || [])];
      const results = await Promise.allSettled(list.map(fn => Promise.resolve().then(() => fn(payload, name))));
      const failed = results.find(r => r.status === 'rejected');
      if (failed) throw failed.reason;
    },
    /** Дождаться обработки всех событий (удобно в тестах) */
    async idle() { while (pending.size) await Promise.all([...pending]); },
  };
}
