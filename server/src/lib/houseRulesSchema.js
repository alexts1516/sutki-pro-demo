import { z } from 'zod';
import { RULE_GROUPS } from '../../public/shared/house-rules.js';
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional();
const detail=z.object({title:z.string().trim().max(160).optional(),titleEn:z.string().trim().max(160).optional(),explanation:z.string().trim().max(2000).optional(),explanationEn:z.string().trim().max(2000).optional(),explanationEnSource:z.string().trim().max(2000).optional()});
export const ruleValuesSchema=z.object({
  checkIn:time,checkOut:time,quietFrom:time,quietTo:time,
  checkInMethod:z.enum(['code','personal','other']).nullable().optional(),
  smokingAllowed:z.boolean().nullable().optional(),partiesAllowed:z.boolean().nullable().optional(),
  additional:z.string().trim().max(2000).optional(),additionalEn:z.string().trim().max(2000).optional(),
  details:z.object(Object.fromEntries(RULE_GROUPS.map(([key])=>[key,detail.optional()]))).optional(),
});
export const apartmentRulesSchema=ruleValuesSchema.extend({overrides:ruleValuesSchema.optional()});
