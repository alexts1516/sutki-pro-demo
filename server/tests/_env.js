// Подключается первым в каждом тесте: отдельная база и папка для файлов.
process.env.NODE_ENV = 'test';
// TEST_DATABASE_URL=postgresql://… — прогон на PostgreSQL (npm run test:pg), иначе SQLite prisma/test.db
process.env.DATABASE_URL = /^postgres(ql)?:/.test(process.env.TEST_DATABASE_URL || '') ? process.env.TEST_DATABASE_URL : 'file:./test.db';
process.env.UPLOAD_DIR = './uploads-test';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.PAYMENTS_PROVIDER = '';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
