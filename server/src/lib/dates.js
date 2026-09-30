// Даты заезда/выезда храним как полночь UTC нужного дня — так проще считать ночи.
export const DAY_MS = 86400000;
export const toDay = (d) => { const x = new Date(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); };
export const parseDay = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const d = new Date(s + 'T00:00:00Z'); return isNaN(d) ? null : d;
};
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY_MS);
export const nights = (ci, co) => Math.round((new Date(co) - new Date(ci)) / DAY_MS);
/** «Сегодня» в часовом поясе бизнеса (по умолчанию Астана, UTC+5) как полночь UTC */
export const todayIn = (tz = 'Asia/Almaty', now = new Date()) => {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parseDay(s);
};
