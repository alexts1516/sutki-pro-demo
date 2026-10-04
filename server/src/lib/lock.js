// Очередь по ключу внутри ОДНОГО процесса: следующий вызов с тем же ключом ждёт, пока закончится предыдущий.
// Только для SQLite и демо в памяти (один процесс). На PostgreSQL одновременность упорядочивает сама база
// (блокировка строки квартиры + ограничение booking_no_overlap) — см. services/bookings.js → withApartmentTx.
const locks = new Map();
export async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release; const cur = new Promise(r => { release = r; });
  const chain = prev.then(() => cur);
  locks.set(key, chain);
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === chain) locks.delete(key); }
}
