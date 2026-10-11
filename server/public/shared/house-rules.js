// One vocabulary and inheritance contract for owner editor and public rendering.
export const RULE_GROUPS = [
  ['stay','Заезд и выезд',['checkIn','checkOut']],
  ['arrival','Способ заселения',['checkInMethod']],
  ['pets','Животные',[]],
  ['smoking','Курение',['smokingAllowed']],
  ['parties','Вечеринки',['partiesAllowed']],
  ['quiet','Тишина',['quietFrom','quietTo']],
  ['additional','Дополнительные условия',['additional','additionalEn']],
];
export const TEXT_FIELDS = ['title','titleEn','explanation','explanationEn'];
export function ruleOverrides(r = {}) {
  if (r.overrides) return r.overrides;
  // Older per-apartment rules remain explicit exceptions; empty values inherit.
  const result = {details:{}};
  for (const [key,,fields] of RULE_GROUPS) {
    for (const field of fields) if(r[field]!=null && r[field]!=='') result[field]=r[field];
    const d=r.details?.[key];
    if(d) { const filled=Object.fromEntries(TEXT_FIELDS.filter(f=>d[f]).map(f=>[f,d[f]])); if(Object.keys(filled).length)result.details[key]=filled; }
  }
  return result;
}
export function resolveRules(template = {}, stored = {}) {
  const own = ruleOverrides(stored), details = {};
  for (const [key] of RULE_GROUPS) details[key]={...(template.details?.[key]||{}),...(own.details?.[key]||{})};
  return {...template,...own,details};
}
