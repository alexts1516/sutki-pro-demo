// Настройки «сервера» в статическом демо: Telegram, оплата, S3 и рейсы выключены — ничего никуда не уходит.
// Адрес демо — папка v2 на GitHub Pages (или где открыт файл), вычисляется по адресу demo.js.
const base = (() => {
  try { return new URL('..', import.meta.url).href.replace(/\/$/, ''); } catch { return ''; }
})();

export const config = {
  root: '/demo', env: 'demo', isTest: false, isDemo: true, port: 0,
  publicUrl: base,
  jwtSecret: 'static-demo-no-secret-static-demo-no-secret',
  defaultAccountSlug: 'astana-stay',
  corsOrigins: [],
  storage: { driver: 'local', uploadDir: '/uploads', maxUploadMb: 15, s3: {} },
  telegram: { token: '', username: '', mode: 'polling' },
  transfers: { offerTimeoutMin: 30, escalateBeforeHours: 3, reminderBeforeMin: 120 },
  flights: { aerodataboxKey: '', aerodataboxHost: '' },
  rateLimit: { loginMax: 50, loginWindowMin: 15, ipMax: 300, linkMax: 1000, linkBadMax: 200, linkWindowMin: 15 },
  payments: { provider: '', cloudpayments: {}, paylink: {} },
};
