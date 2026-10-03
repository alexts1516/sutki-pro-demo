// Ограничение частоты запросов в памяти процесса (без Redis). Для одного сервера этого достаточно;
// при нескольких копиях сервера — вынести счётчики в Redis (см. README_SERVER.md).
import { HttpError } from './errors.js';

export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset <= now) hits.delete(k); }, Math.min(windowMs, 60000));
  sweep.unref?.();
  const get = (key) => { const h = hits.get(key); return h && h.reset > Date.now() ? h : null; };
  return {
    /** сколько секунд ждать, если лимит исчерпан; 0 — можно */
    blockedFor(key) { const h = get(key); return h && h.count >= max ? Math.ceil((h.reset - Date.now()) / 1000) : 0; },
    hit(key) { const h = get(key); if (h) h.count++; else hits.set(key, { count: 1, reset: Date.now() + windowMs }); },
    reset(key) { hits.delete(key); },
  };
}

export const tooMany = (res, seconds, msg) => {
  res.set('Retry-After', String(seconds));
  return new HttpError(429, `${msg} Попробуйте через ${Math.max(1, Math.ceil(seconds / 60))} мин.`);
};

/** Ссылки без входа: общий лимит запросов с IP и отдельный — на неверные ссылки (перебор токенов) */
export function linkGuard({ max, badMax, windowMin }) {
  const all = createLimiter({ max, windowMs: windowMin * 60000 });
  const bad = createLimiter({ max: badMax, windowMs: windowMin * 60000 });
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const wait = bad.blockedFor(ip) || all.blockedFor(ip);
    if (wait) throw tooMany(res, wait, 'Слишком много запросов.');
    all.hit(ip);
    res.on('finish', () => { if (res.statusCode === 404) bad.hit(ip); });
    next();
  };
}
