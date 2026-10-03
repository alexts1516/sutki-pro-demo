// Делает prisma/postgres/schema.prisma из основной схемы (меняет только provider на postgresql).
// Основная схема (SQLite) остаётся единственным источником правды: после правки schema.prisma
// запустите `npm run pg:schema`, а затем `npm run pg:migration -- имя` для новой миграции PostgreSQL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const out = src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
if (out === src) throw new Error('В prisma/schema.prisma не найден provider = "sqlite"');
const header = '// СГЕНЕРИРОВАНО scripts/pg-schema.js из prisma/schema.prisma — не правьте вручную.\n// Та же схема для PostgreSQL. Миграции — в prisma/postgres/migrations.\n';
fs.mkdirSync(path.join(root, 'prisma/postgres'), { recursive: true });
fs.writeFileSync(path.join(root, 'prisma/postgres/schema.prisma'), header + out);
console.log('prisma/postgres/schema.prisma обновлена');
