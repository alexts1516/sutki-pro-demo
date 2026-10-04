// npm run test:memory — все тесты сервера на Prisma в памяти (demo/prisma-memory.js), как в статическом демо (/v2/).
// Проверяет, что демо в браузере ведёт себя так же, как настоящий сервер с базой.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snap = path.join(os.tmpdir(), `sutki-memory-${process.pid}.json`);
const env = { ...process.env, NODE_ENV: 'test', UPLOAD_DIR: './uploads-test', DATABASE_URL: 'file:./memory-not-used.db' };
const imp = '--import ./demo/node/register.mjs';
fs.rmSync(path.join(root, 'uploads-test'), { recursive: true, force: true });
execSync(`node ${imp} prisma/seed.js`, { cwd: root, env: { ...env, MEMORY_DB_DUMP: snap }, stdio: 'inherit' });
console.log('Снимок демо-данных в памяти готов');
const files = process.argv.slice(2).length ? process.argv.slice(2).join(' ') : 'tests/*.test.js';
try {
  execSync(`node ${imp} --test --test-force-exit --test-concurrency=1 ${files}`, { cwd: root, env: { ...env, MEMORY_DB_SNAPSHOT: snap }, stdio: 'inherit' });
} finally { fs.rmSync(snap, { force: true }); }
