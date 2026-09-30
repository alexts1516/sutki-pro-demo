// Перевод цены из тенге в валюту гостя по курсам аккаунта.
export const SYMBOLS = { KZT: '₸', RUB: '₽', USD: '$', EUR: '€' };
export function convertKzt(amountKzt, code, rates, roundStep = {}) {
  if (!code || code === 'KZT') return amountKzt;
  const rate = rates[code]; if (!rate) return null;
  const step = roundStep[code] || 1;
  return Math.round(amountKzt / rate / step) * step;
}
