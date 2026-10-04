// Сборка Express-приложения. Всё внешнее (хранилище, бот, оплата) передаётся параметрами —
// так приложение легко тестировать и запускать без токенов.
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config as defaultConfig } from './config.js';
import { prisma } from './db.js';
import { authenticate, requireRole } from './auth/middleware.js';
import { MANAGERS } from './auth/roles.js';
import { HttpError } from './lib/errors.js';
import { isOverlapError, isDeadlockError, toConflict } from './lib/dbErrors.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/admin/settings.js';
import linkKindRouter from './routes/linkKind.js';
import { linkGuard } from './lib/rateLimit.js';
import apartmentsRouter from './routes/admin/apartments.js';
import siteRouter from './routes/admin/site.js';
import operationsRouter from './routes/admin/operations.js';
import teamRouter from './routes/admin/team.js';
import staffRouter from './routes/staff.js';
import publicRouter from './routes/public.js';
import paymentsRouter from './routes/payments.js';
import workRequestsRouter from './routes/admin/workRequests.js';
import taskLinkRouter from './routes/taskLink.js';
import { createWorkflow } from './services/workRequests.js';
import transfersRouter from './routes/admin/transfers.js';
import calendarRouter from './routes/admin/calendar.js';
import staffTransfersRouter from './routes/staffTransfers.js';
import transferLinkRouter from './routes/transferLink.js';
import { createTransferDispatch } from './services/transferJobs.js';
import { createPayouts } from './services/performerPayouts.js';
import { createCleaning } from './services/cleaning.js';
import payoutsRouter from './routes/admin/payouts.js';
import opsRouter from './routes/admin/ops.js';
import { createDefects } from './services/defects.js';

export function createApp({ config = defaultConfig, events, storage, payments = null, telegramWebhook = null, flights = null, logger = console }) {
  const app = express();
  const payouts = createPayouts({ events });   // единые выплаты исполнителям
  const workflow = createWorkflow({ events, payouts });
  const defects = createDefects({ events, workflow });   // недочёты квартир (с подготовки или добавленные вручную)
  const cleaning = createCleaning({ events, payouts, workflow, defects });
  const dispatch = createTransferDispatch({ events, config });
  dispatch.setFlightTracker(flights);   // слежение за рейсами — только если задан ключ AeroDataBox
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // базовые заголовки безопасности
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });

  // вебхуки оплаты — до express.json(), им нужно «сырое» тело
  app.use('/api/payments', paymentsRouter({ payments, events, dispatch, logger }));

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (telegramWebhook) app.post('/api/telegram/webhook', telegramWebhook);

  // CORS только для публичного API — чтобы сайт на GitHub Pages мог его вызывать
  app.use('/api/public', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*'))) {
      res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, telegram: !!telegramWebhook || !!config.telegram.token, payments: payments?.name || null, storage: storage.driver });
  });

  app.use('/api/auth', authRouter({ config }));
  app.use('/api/public/:slug', publicRouter({ events, payments, config, dispatch }));
  const admin = express.Router();
  admin.use(authenticate, requireRole(...MANAGERS));
  admin.use(apartmentsRouter({ storage, config }));
  admin.use(siteRouter({ storage, config }));
  admin.use(operationsRouter({ events, dispatch, cleaning }));
  admin.use(payoutsRouter({ payouts }));
  admin.use(opsRouter({ defects, cleaning, events }));
  admin.use(transfersRouter({ dispatch, config }));
  admin.use(calendarRouter());
  admin.use(teamRouter({ config }));
  admin.use(settingsRouter({ config, storage, flights }));
  admin.use(workRequestsRouter({ workflow, storage, config }));
  app.use('/api/admin', admin);
  app.use('/api/staff/transfers', authenticate, staffTransfersRouter({ dispatch }));
  app.use('/api/staff', authenticate, staffRouter({ events, workflow, storage, config, cleaning }));
  // ссылки без входа: лимит запросов с IP и отдельно — на неверные ссылки (защита от перебора)
  const guard = linkGuard({ max: config.rateLimit?.linkMax ?? 120, badMax: config.rateLimit?.linkBadMax ?? 20, windowMin: config.rateLimit?.linkWindowMin ?? 15 });
  app.use('/api/link', guard, linkKindRouter());
  app.use('/api/task-link', guard, taskLinkRouter({ workflow, storage, config }));
  app.use('/api/transfer-link', guard, transferLinkRouter({ dispatch }));

  // файлы и админка
  if (storage.driver === 'local') app.use('/uploads', express.static(storage.uploadDir, { maxAge: '7d', fallthrough: false }));
  const pub = path.join(config.root, 'public');
  app.get('/', (_req, res) => res.redirect('/admin/'));
  app.use('/admin', express.static(path.join(pub, 'admin'), { extensions: ['html'] }));
  app.use('/app', express.static(path.join(pub, 'app'), { extensions: ['html'] }));     // приложение водителя/мастера/клининга
  app.use('/shared', express.static(path.join(pub, 'shared'), { maxAge: '1h' }));
  app.get('/link/:token', (_req, res) => res.sendFile(path.join(pub, 'link', 'index.html')));   // одна задача по ссылке без входа
  app.use('/link-assets', express.static(path.join(pub, 'link'), { maxAge: '1h' }));
  app.use('/brand-assets', express.static(path.join(config.root, '..', 'assets'), { maxAge: '1h' }));   // стили и шрифты прототипа

  // 404 и ошибки — всегда JSON для /api
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Нет такого адреса API')));
  app.locals.dispatch = dispatch;
  app.locals.payouts = payouts;     // напоминания о невыплаченном — по расписанию   // диспетчер трансферов — для расписания и тестов
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = `Файл слишком большой (максимум ${config.storage.maxUploadMb} МБ)`; }
    else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') { status = 400; message = 'Слишком много файлов или неверное поле формы'; }
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'Неверный JSON'; }
    else if (isOverlapError(err) || isDeadlockError(err)) { const c = toConflict(err); status = c.status; message = c.message; }   // конфликт занятости из базы — не «ошибка сервера»
    if (status >= 500) { logger.error('[error]', req.method, req.originalUrl, err); message = 'Ошибка сервера'; }
    res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
  });
  return app;
}
