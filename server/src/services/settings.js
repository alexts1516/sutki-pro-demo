// Настройки владельца (одна запись на аккаунт). Нет записи — действуют значения по умолчанию:
// комиссия не настроена (водителю 100% цены), везёт владелец — вся сумма бизнесу, уведомления менеджерам — владельцу и админам,
// сметы одобряют владелец и админ, слежение за рейсами включено (работает только с ключом AeroDataBox).
import { prisma } from '../db.js';

export const PAYOUT_MODES = ['PERCENT', 'FIXED'];
export const MANAGER_NOTIFY = ['OWNER', 'ADMIN', 'BOTH'];
export const APPROVAL_BY = ['OWNER_ONLY', 'OWNER_AND_ADMIN'];
export const DEFAULT_SETTINGS = {
  transferPayoutMode: 'PERCENT', ownerCommissionPercent: null, driverFixedKzt: null, commissionConfiguredAt: null,
  managerNotify: 'BOTH', approvalBy: 'OWNER_AND_ADMIN', flightTracking: true, ownerDrivesKeepsAll: true,
  cleaningChecklist: null, cleaningRateKzt: null, cleaningRates: null, payoutReminderHours: 3, driverStartWindowMin: 120,
};

export async function getSettings(accountId, db = prisma) {
  const s = await db.accountSettings.findUnique({ where: { accountId } });
  return { ...DEFAULT_SETTINGS, ...(s || {}), accountId };
}

export async function saveSettings(accountId, data, db = prisma) {
  const cur = await db.accountSettings.findUnique({ where: { accountId } });
  const touchesCommission = ['transferPayoutMode', 'ownerCommissionPercent', 'driverFixedKzt'].some(k => data[k] !== undefined);
  const patch = { ...data };
  if (touchesCommission && !cur?.commissionConfiguredAt) patch.commissionConfiguredAt = new Date();
  return db.accountSettings.upsert({ where: { accountId }, update: patch, create: { accountId, ...patch } });
}

/** Какие роли получают уведомления «для менеджера». ADMIN без активных админов — владельцу (чтобы сигнал не потерялся). */
export async function managerRoles(accountId, db = prisma) {
  const { managerNotify } = await getSettings(accountId, db);
  if (managerNotify === 'OWNER') return ['owner'];
  if (managerNotify === 'ADMIN') {
    const admins = await db.membership.count({ where: { accountId, role: 'admin', active: true } });
    return admins ? ['admin'] : ['owner'];
  }
  return ['owner', 'admin'];
}

/** Может ли эта роль одобрять сметы и доп. расходы */
export async function canApprove(accountId, role, db = prisma) {
  if (role === 'owner') return true;
  if (role !== 'admin') return false;
  return (await getSettings(accountId, db)).approvalBy === 'OWNER_AND_ADMIN';
}
