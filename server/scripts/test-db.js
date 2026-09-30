// Готовит отдельную тестовую базу (prisma/test.db) с демо-данными. Рабочую dev.db не трогает.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: 'file:./test.db', UPLOAD_DIR: './uploads-test', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
for (const f of ['prisma/test.db', 'prisma/test.db-journal']) fs.rmSync(path.join(root, f), { force: true });
fs.rmSync(path.join(root, 'uploads-test'), { recursive: true, force: true });
execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'ignore' });
execSync('node prisma/seed.js', { cwd: root, env, stdio: 'inherit' });
console.log('Тестовая база готова');
