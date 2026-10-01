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
import authRoutes from './routes/auth.js';
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

export function createApp({ config = defaultConfig, events, storage, payments = null, telegramWebhook = null, logger = console }) {
  const app = express();
  const workflow = createWorkflow({ events });
  const dispatch = createTransferDispatch({ events, config });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // базовые заголовки безопасности
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });

  // вебхуки оплаты — до express.json(), им нужно «сырое» тело
  app.use('/api/payments', paymentsRouter({ payments, events, logger }));

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

  app.use('/api/auth', authRoutes);
  app.use('/api/public/:slug', publicRouter({ events, payments, config, dispatch }));
  const admin = express.Router();
  admin.use(authenticate, requireRole(...MANAGERS));
  admin.use(apartmentsRouter({ storage, config }));
  admin.use(siteRouter({ storage, config }));
  admin.use(operationsRouter({ events, dispatch }));
  admin.use(transfersRouter({ dispatch, config }));
  admin.use(calendarRouter());
  admin.use(teamRouter({ config }));
  admin.use(workRequestsRouter({ workflow, storage, config }));
  app.use('/api/admin', admin);
  app.use('/api/staff/transfers', authenticate, staffTransfersRouter({ dispatch }));
  app.use('/api/staff', authenticate, staffRouter({ events, workflow, storage, config }));
  app.use('/api/task-link', taskLinkRouter({ workflow, storage, config }));
  app.use('/api/transfer-link', transferLinkRouter({ dispatch }));

  // файлы и админка
  if (storage.driver === 'local') app.use('/uploads', express.static(storage.uploadDir, { maxAge: '7d', fallthrough: false }));
  const pub = path.join(config.root, 'public');
  app.get('/', (_req, res) => res.redirect('/admin/'));
  app.use('/admin', express.static(path.join(pub, 'admin'), { extensions: ['html'] }));
  app.use('/brand-assets', express.static(path.join(config.root, '..', 'assets'), { maxAge: '1h' }));   // стили и шрифты прототипа

  // 404 и ошибки — всегда JSON для /api
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Нет такого адреса API')));
  app.locals.dispatch = dispatch;   // диспетчер трансферов — для расписания и тестов
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = `Файл слишком большой (максимум ${config.storage.maxUploadMb} МБ)`; }
    else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') { status = 400; message = 'Слишком много файлов или неверное поле формы'; }
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'Неверный JSON'; }
    if (status >= 500) { logger.error('[error]', req.method, req.originalUrl, err); message = 'Ошибка сервера'; }
    res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
  });
  return app;
}
