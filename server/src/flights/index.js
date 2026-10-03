// Слежение за рейсами — необязательный адаптер. Без ключа (AERODATABOX_API_KEY) выключено: время подачи
// меняют водитель или админ вручную, в карточке — ссылка «проверить рейс». Тесты живые запросы не делают.
//
// Интерфейс адаптера: { name, async arrival({ flight, date, airport }) → { status, scheduledAt, expectedAt, landed } | null }
import { createAeroDataBox } from './aerodatabox.js';

export function createFlightTracker(cfg = {}, deps = {}) {
  if (cfg.aerodataboxKey) return createAeroDataBox({ key: cfg.aerodataboxKey, host: cfg.aerodataboxHost, ...deps });
  return null;
}
