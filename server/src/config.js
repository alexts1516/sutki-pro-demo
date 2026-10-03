// Все настройки сервера из переменных окружения (.env). Ничего секретного в коде.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);

const isTest = env.NODE_ENV === 'test';
let jwtSecret = env.JWT_SECRET || '';
if (jwtSecret.length < 32) {
  if (env.NODE_ENV === 'production') throw new Error('JWT_SECRET должен быть длиной не меньше 32 символов');
  jwtSecret = 'dev-only-secret-change-me-dev-only-secret-change-me';
  if (!isTest) console.warn('[config] JWT_SECRET не задан — используется временный ключ для разработки');
}

export const config = {
  root: ROOT,
  env: env.NODE_ENV || 'development',
  isTest,
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  jwtSecret,
  defaultAccountSlug: env.DEFAULT_ACCOUNT_SLUG || 'astana-stay',
  corsOrigins: list(env.CORS_ORIGINS),
  storage: {
    driver: env.STORAGE_DRIVER || 'local',
    uploadDir: path.resolve(ROOT, env.UPLOAD_DIR || './uploads'),
    maxUploadMb: Number(env.MAX_UPLOAD_MB || 15),
    // S3-совместимое хранилище (Amazon S3, Cloudflare R2, Yandex Object Storage, MinIO): STORAGE_DRIVER=s3
    s3: {
      bucket: env.S3_BUCKET || '', region: env.S3_REGION || 'us-east-1', endpoint: (env.S3_ENDPOINT || '').replace(/\/$/, ''), publicUrl: (env.S3_PUBLIC_URL || '').replace(/\/$/, ''),
      accessKeyId: env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || '', secretAccessKey: env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || '',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    },
  },
  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || '',
    username: (env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    mode: env.TELEGRAM_MODE === 'webhook' ? 'webhook' : 'polling',
  },
  // Трансферы «как в Uber»: сколько ждём, пока кто-то возьмёт заказ, и когда звать хозяина/админа
  transfers: {
    offerTimeoutMin: Number(env.TRANSFER_OFFER_TIMEOUT_MIN || 30),        // никто не взял за N минут → эскалация
    escalateBeforeHours: Number(env.TRANSFER_ESCALATE_BEFORE_HOURS || 3), // или до подачи осталось меньше X часов
    reminderBeforeMin: Number(env.TRANSFER_REMINDER_BEFORE_MIN || 120),   // напоминание водителю перед подачей
  },
  // Слежение за рейсами (необязательно). Без ключа выключено — время подачи меняют водитель или админ вручную.
  flights: {
    aerodataboxKey: env.AERODATABOX_API_KEY || '',
    aerodataboxHost: env.AERODATABOX_HOST || 'aerodatabox.p.rapidapi.com',
  },
  // Ограничение попыток входа и запросов к ссылкам без входа (в памяти процесса)
  rateLimit: {
    loginMax: Number(env.LOGIN_MAX_ATTEMPTS || 5),          // неудачных попыток на логин+IP за окно
    loginWindowMin: Number(env.LOGIN_WINDOW_MIN || 15),
    ipMax: Number(env.AUTH_IP_MAX || 30),                   // любых попыток входа с одного IP за окно
    linkMax: Number(env.LINK_RATE_MAX || 120),              // запросов к /api/task-link и /api/transfer-link с одного IP за окно
    linkBadMax: Number(env.LINK_BAD_MAX || 20),             // неверных ссылок (404) с одного IP за окно
    linkWindowMin: Number(env.LINK_WINDOW_MIN || 15),
  },
  payments: {
    provider: (env.PAYMENTS_PROVIDER || '').toLowerCase(),
    cloudpayments: { publicId: env.CLOUDPAYMENTS_PUBLIC_ID || '', apiSecret: env.CLOUDPAYMENTS_API_SECRET || '' },
    paylink: {
      shopId: env.PAYLINK_SHOP_ID || '', secretKey: env.PAYLINK_SECRET_KEY || '',
      publicKey: env.PAYLINK_PUBLIC_KEY || '', testMode: env.PAYLINK_TEST_MODE !== 'false',
    },
  },
};
