// Настройки владельца.
//   GET /api/admin/settings   — владелец и админ (админ только смотрит): комиссия с трансферов, кому уведомления, кто одобряет сметы,
//                               а также что подключено на сервере (Telegram, слежение за рейсами, хранилище фото)
//   PUT /api/admin/settings   — только владелец: { transferPayoutMode: PERCENT|FIXED, ownerCommissionPercent 0–100, driverFixedKzt,
//                               managerNotify: OWNER|ADMIN|BOTH, approvalBy: OWNER_ONLY|OWNER_AND_ADMIN, flightTracking,
//                               ownerDrivesKeepsAll — везёт владелец: выплаты нет, вся сумма бизнесу,
//                               cleaningChecklist [{label, photo}] — шаблон чек-листа подготовки, cleaningRateKzt / cleaningRates {размер: ₸} — оплата подготовки,
//                               payoutReminderHours — через сколько часов напомнить о невыплаченном (0 — не напоминать),
//                               driverStartWindowMin — за сколько минут до подачи водителю открывается «Выехал» }
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../auth/middleware.js';
import { badRequest, parse } from '../../lib/errors.js';
import { getSettings, saveSettings, PAYOUT_MODES, MANAGER_NOTIFY, APPROVAL_BY } from '../../services/settings.js';
import { accountRuleLabel } from '../../services/payouts.js';
import { templateOf } from '../../services/cleaning.js';

export default function settingsRouter({ config, storage, flights = null }) {
  const r = Router();
  const out = async (req) => {
    const s = await getSettings(req.accountId);
    return {
      transferPayoutMode: s.transferPayoutMode, ownerCommissionPercent: s.ownerCommissionPercent, driverFixedKzt: s.driverFixedKzt,
      commissionConfigured: !!s.commissionConfiguredAt, commissionLabel: accountRuleLabel(s),
      managerNotify: s.managerNotify, approvalBy: s.approvalBy, flightTracking: s.flightTracking, ownerDrivesKeepsAll: s.ownerDrivesKeepsAll,
      cleaningChecklist: templateOf(s), cleaningRateKzt: s.cleaningRateKzt, cleaningRates: s.cleaningRates || {}, payoutReminderHours: s.payoutReminderHours, driverStartWindowMin: s.driverStartWindowMin,
      canEdit: req.role === 'owner',
      server: {
        telegram: !!config.telegram.token, telegramBot: config.telegram.username || null,
        flightProvider: flights?.name || null, storage: storage?.driver || 'local',
      },
    };
  };
  r.get('/settings', async (req, res) => res.json(await out(req)));
  r.put('/settings', requireRole('owner'), async (req, res) => {
    const d = parse(z.object({
      transferPayoutMode: z.enum(PAYOUT_MODES).optional(),
      ownerCommissionPercent: z.number().min(0, 'Комиссия от 0 до 100%').max(100, 'Комиссия от 0 до 100%').nullable().optional(),
      driverFixedKzt: z.number().int().min(0).max(10_000_000).nullable().optional(),
      managerNotify: z.enum(MANAGER_NOTIFY).optional(), approvalBy: z.enum(APPROVAL_BY).optional(), flightTracking: z.boolean().optional(), ownerDrivesKeepsAll: z.boolean().optional(),
      cleaningChecklist: z.array(z.object({ label: z.string().trim().min(1).max(80), photo: z.boolean().default(false) })).max(40).nullable().optional(),
      cleaningRateKzt: z.number().int().min(0).max(1_000_000).nullable().optional(),
      cleaningRates: z.record(z.string().max(30), z.number().int().min(0).max(1_000_000)).nullable().optional(),
      payoutReminderHours: z.number().int().min(0).max(168).optional(),
      driverStartWindowMin: z.number().int().min(15, 'Не меньше 15 минут').max(720, 'Не больше 12 часов').optional(),
    }), req.body);
    const cur = await getSettings(req.accountId);
    const mode = d.transferPayoutMode || cur.transferPayoutMode;
    const fixed = d.driverFixedKzt !== undefined ? d.driverFixedKzt : cur.driverFixedKzt;
    if (mode === 'FIXED' && fixed == null) throw badRequest('Для фиксированной ставки укажите сумму водителю за поездку');
    await saveSettings(req.accountId, d);
    res.json(await out(req));
  });
  return r;
}
