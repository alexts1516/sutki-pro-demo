// Подключается первым в каждом тесте: отдельная база и папка для файлов.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.UPLOAD_DIR = './uploads-test';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.PAYMENTS_PROVIDER = '';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
