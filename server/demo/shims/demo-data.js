// Демо-данные прототипа для сида в браузере: те же, что читает prisma/demo-data.js из ../assets (data.js, store.js),
// но заранее выгруженные в JSON при сборке (scripts/build-static-demo.js).
import data from '../generated/prototype-data.json';

export function loadPrototypeData() {
  const d = JSON.parse(JSON.stringify(data));
  return { ...d, FX_DEFAULT: () => JSON.parse(JSON.stringify(data.fx)), aptDoor: (a) => ({ ...data.doors[a.id] }), aptPets: (a) => ({ ...data.pets[a.id] }) };
}
