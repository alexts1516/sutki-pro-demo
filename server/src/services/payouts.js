// Выплата водителю и комиссия бизнеса с трансфера.
//   выплата водителю = цена для гостя − комиссия бизнеса (или фиксированная ставка)
// Приоритет правил: 1) вручную в карточке заказа  2) своя ставка водителя (фикс важнее процента)
//                   3) настройка аккаунта (процент комиссии или фиксированная ставка водителю).
// Пока владелец ничего не настроил — комиссия 0%, водитель получает всю цену.
const round100 = (n) => Math.round(n / 100) * 100;
const pct = (p) => Math.min(100, Math.max(0, Number(p) || 0));

/**
 * @param priceKzt   цена трансфера для гостя
 * @param settings   getSettings(accountId)
 * @param driver     { payoutPercent, payoutFixedKzt } — участник команды или внешний подрядчик (или null — водитель ещё не выбран)
 * @param manualKzt  выплата, заданная вручную (null — считать по правилам)
 * @returns { payoutKzt, commissionKzt, rule, percent }
 */
export function computePayout({ priceKzt, settings, driver = null, manualKzt = null }) {
  const price = Math.max(0, Math.round(priceKzt || 0));
  let payout, rule, percent = null;
  if (manualKzt !== null && manualKzt !== undefined) { payout = manualKzt; rule = 'manual'; }
  else if (driver && driver.payoutFixedKzt != null) { payout = driver.payoutFixedKzt; rule = 'driver'; }
  else if (driver && driver.payoutPercent != null) { percent = pct(driver.payoutPercent); payout = round100(price * (100 - percent) / 100); rule = 'driver'; }
  else if (settings?.transferPayoutMode === 'FIXED' && settings.driverFixedKzt != null) { payout = settings.driverFixedKzt; rule = 'account'; }
  else { percent = pct(settings?.ownerCommissionPercent); payout = round100(price * (100 - percent) / 100); rule = 'account'; }
  payout = Math.max(0, Math.round(payout));
  return { payoutKzt: payout, commissionKzt: price - payout, rule, percent };
}

export const RULE_RU = { account: 'по настройке аккаунта', driver: 'ставка водителя', manual: 'вручную' };

/** Подпись правила аккаунта для людей: «комиссия 20%» / «водителю 8 000 ₸» / «не настроено» */
export function accountRuleLabel(s) {
  if (!s.commissionConfiguredAt) return 'не настроено — водитель получает 100% цены';
  if (s.transferPayoutMode === 'FIXED' && s.driverFixedKzt != null) return `водителю фиксированно ${s.driverFixedKzt} ₸`;
  return `комиссия бизнеса ${pct(s.ownerCommissionPercent)}%`;
}
