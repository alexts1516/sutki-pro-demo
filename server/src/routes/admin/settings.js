// Настройки владельца.
//   GET /api/admin/settings   — владелец и админ (админ только смотрит): комиссия с трансферов, кому уведомления, кто одобряет сметы,
//                               а также что подключено на сервере (Telegram, слежение за рейсами, хранилище фото)
//   PUT /api/admin/settings   — только владелец: { transferPayoutMode: PERCENT|FIXED, ownerCommissionPercent 0–100, driverFixedKzt,
//                               managerNotify: OWNER|ADMIN|BOTH, approvalBy: OWNER_ONLY|OWNER_AND_ADMIN, flightTracking }
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../auth/middleware.js';
import { badRequest, parse } from '../../lib/errors.js';
import { getSettings, saveSettings, PAYOUT_MODES, MANAGER_NOTIFY, APPROVAL_BY } from '../../services/settings.js';
import { accountRuleLabel } from '../../services/payouts.js';

export default function settingsRouter({ config, storage, flights = null }) {
  const r = Router();
  const out = async (req) => {
    const s = await getSettings(req.accountId);
    return {
      transferPayoutMode: s.transferPayoutMode, ownerCommissionPercent: s.ownerCommissionPercent, driverFixedKzt: s.driverFixedKzt,
      commissionConfigured: !!s.commissionConfiguredAt, commissionLabel: accountRuleLabel(s),
      managerNotify: s.managerNotify, approvalBy: s.approvalBy, flightTracking: s.flightTracking,
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
      managerNotify: z.enum(MANAGER_NOTIFY).optional(), approvalBy: z.enum(APPROVAL_BY).optional(), flightTracking: z.boolean().optional(),
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
