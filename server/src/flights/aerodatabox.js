// AeroDataBox (через RapidAPI): GET /flights/number/{номер}/{дата}?dateLocalRole=Arrival
// В ответе — массив рейсов; у прилёта arrival.scheduledTime / revisedTime / predictedTime с полями utc и local
// (формат времени после изменений API от 01.10.2023: https://aerodatabox.com/breaking-changes-2023-10).
const STATUS_RU = {
  Expected: 'по расписанию', EnRoute: 'в полёте', CheckIn: 'регистрация', Boarding: 'посадка', GateClosed: 'посадка закончена',
  Departed: 'вылетел', Delayed: 'задерживается', Approaching: 'заходит на посадку', Arrived: 'приземлился', Canceled: 'отменён',
  Diverted: 'ушёл на запасной', CanceledUncertain: 'возможно отменён', Unknown: 'нет данных',
};
const parseTime = (t) => { const s = t?.utc; if (!s) return null; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? null : d; };

export function parseArrival(list, airport = 'NQZ') {
  const flights = Array.isArray(list) ? list : list ? [list] : [];
  if (!flights.length) return null;
  const f = flights.find(x => x.arrival?.airport?.iata === airport) || flights[0];
  const a = f.arrival || {};
  const scheduledAt = parseTime(a.scheduledTime);
  const expectedAt = parseTime(a.revisedTime) || parseTime(a.predictedTime) || scheduledAt;
  return { status: STATUS_RU[f.status] || f.status || 'нет данных', rawStatus: f.status || null, scheduledAt, expectedAt, landed: f.status === 'Arrived', cancelled: /Cancel/.test(f.status || '') };
}

export function createAeroDataBox({ key, host = 'aerodatabox.p.rapidapi.com', fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  return {
    name: 'aerodatabox',
    async arrival({ flight, date, airport = 'NQZ' }) {
      const num = String(flight || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(num)) return null;
      const url = `https://${host}/flights/number/${encodeURIComponent(num)}/${date}?dateLocalRole=Arrival&withAircraftImage=false&withLocation=false`;
      const res = await fetchImpl(url, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 204 || res.status === 404) return null;
      if (!res.ok) throw new Error(`AeroDataBox ${res.status}`);
      return parseArrival(await res.json(), airport);
    },
  };
}
