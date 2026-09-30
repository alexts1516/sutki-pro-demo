// Цены трансфера — те же правила, что в прототипе (assets/store.js): за машину, не за человека.
export const TR_PRICES = {
  airport: { standard: { one: 8000, round: 14000 }, minivan: { one: 12000, round: 21000 } },
  station: { standard: { one: 6000, round: 10000 }, minivan: { one: 9000, round: 16000 } },
};
export const TR_SEAT = 2000;   // детское кресло, за поездку
export const TR_NIGHT = 1500;  // ночная надбавка 23:00–06:00, за поездку
const isNight = (hm) => { const h = +String(hm || '').slice(0, 2); return h >= 23 || h < 6; };

/** Цена одной поездки (в одну сторону) */
export function transferLegPrice({ place = 'airport', carClass = 'standard', time, childSeats = 0 }) {
  const p = (TR_PRICES[place] || TR_PRICES.airport)[carClass] || TR_PRICES.airport.standard;
  return p.one + childSeats * TR_SEAT + (isNight(time) ? TR_NIGHT : 0);
}
