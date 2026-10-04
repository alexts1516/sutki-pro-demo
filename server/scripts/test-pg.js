// Прогон всех тестов на PostgreSQL: TEST_DATABASE_URL=postgresql://user:pass@host:5432/sutki_test npm run test:pg
// К имени базы добавляется метка времени (sutki_test_t1700000000) — каждый прогон идёт на новой пустой базе,
// существующие базы не трогаются; старые тестовые базы можно удалить вручную.
// Временно генерирует Prisma Client для PostgreSQL, а в конце возвращает клиент для SQLite (основной режим).
import { execSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL || '';
if (!/^postgres(ql)?:/.test(url)) {
  console.error('Укажите TEST_DATABASE_URL=postgresql://user:pass@host:5432/sutki_test');
  process.exit(2);
}
const u = new URL(url);
u.pathname = `${u.pathname.replace(/\/$/, '') || '/sutki_test'}_t${Math.floor(Date.now() / 1000)}`;
process.env.TEST_DATABASE_URL = u.toString();
console.log('Тестовая база PostgreSQL:', u.pathname.slice(1));
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
let code = 0;
try {
  run('node scripts/pg-schema.js');
  run('npx prisma generate --schema prisma/postgres/schema.prisma');
  const adminUrl = new URL(u); adminUrl.pathname = '/postgres';
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin', '--url', adminUrl.toString()], { cwd: root, input: `CREATE DATABASE "${u.pathname.slice(1).replaceAll('"', '""')}";`, stdio: ['pipe', 'inherit', 'inherit'] });
  run('node scripts/test-db.js');
  run('node --test --test-force-exit --test-concurrency=1 tests/*.test.js');
} catch { code = 1; } finally {
  run('npx prisma generate');   // назад на SQLite
}
process.exit(code);
