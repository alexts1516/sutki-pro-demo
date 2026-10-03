// Готовит отдельную тестовую базу с демо-данными. Рабочую dev.db не трогает.
//   по умолчанию — SQLite prisma/test.db;
//   TEST_DATABASE_URL=postgresql://… — новая пустая база PostgreSQL (схема prisma/postgres). Ничего не удаляет:
//   migrate deploy сам создаёт базу, если её нет (npm run test:pg каждый раз берёт новое имя базы).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgUrl = process.env.TEST_DATABASE_URL || '';
const pg = /^postgres(ql)?:/.test(pgUrl);
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: pg ? pgUrl : 'file:./test.db', UPLOAD_DIR: './uploads-test', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
fs.rmSync(path.join(root, 'uploads-test'), { recursive: true, force: true });
if (pg) {
  execSync('npx prisma migrate deploy --schema prisma/postgres/schema.prisma', { cwd: root, env, stdio: 'ignore' });
} else {
  for (const f of ['prisma/test.db', 'prisma/test.db-journal']) fs.rmSync(path.join(root, f), { force: true });
  execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'ignore' });
}
execSync('node prisma/seed.js', { cwd: root, env, stdio: 'inherit' });
console.log(`Тестовая база готова (${pg ? 'PostgreSQL' : 'SQLite'})`);
