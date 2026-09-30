// Первый запуск одной командой: npm run setup
//  1) создаёт .env из .env.example (со случайным JWT_SECRET), если его ещё нет
//  2) создаёт базу и таблицы (prisma migrate deploy)
//  3) заполняет демо-данными (prisma/seed.js)
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  const tpl = fs.readFileSync(path.join(root, '.env.example'), 'utf8').replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`);
  fs.writeFileSync(envPath, tpl);
  console.log('✔ Создан файл .env (секретный ключ сгенерирован автоматически)');
}
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
run('npx prisma migrate deploy');
run('node prisma/seed.js');
console.log('\n✔ Всё готово. Запустите сервер: npm run dev  →  http://localhost:3000/admin/');
