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
/** Смещение часового пояса tz в минутах для момента date (Asia/Almaty → +300) */
export function tzOffsetMin(tz = 'Asia/Almaty', date = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const g = (k) => +p.find(x => x.type === k).value;
  return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - date.getTime()) / 60000);
}
/** Момент времени: день (полночь UTC) + «ЧЧ:ММ» по местному времени аккаунта */
export function atLocal(day, hm = '12:00', tz = 'Asia/Almaty') {
  const [h, m] = String(hm).split(':').map(Number);
  const guess = new Date(new Date(day).getTime() + ((h || 0) * 60 + (m || 0)) * 60000);
  return new Date(guess.getTime() - tzOffsetMin(tz, guess) * 60000);
}
