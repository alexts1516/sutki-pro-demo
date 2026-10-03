// Подмена @prisma/client в Node: Prisma в памяти (demo/prisma-memory.js) вместо базы.
// Используется проверкой npm run test:memory — те же тесты сервера, но на «базе» статического демо.
//   MEMORY_DB_SNAPSHOT — загрузить снимок (JSON) при старте; MEMORY_DB_DUMP — записать снимок при $disconnect (после сида).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchema } from '../schema-parse.js';
import { createMemoryPrisma, PrismaClientKnownRequestError } from '../prisma-memory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const models = parseSchema(fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8'));
let shared = null;

export class PrismaClient {
  constructor() {
    if (!shared) {
      const snap = process.env.MEMORY_DB_SNAPSHOT;
      const state = snap && fs.existsSync(snap) ? JSON.parse(fs.readFileSync(snap, 'utf8')) : null;
      shared = createMemoryPrisma({ models, state });
      const disconnect = shared.$disconnect;
      shared.$disconnect = async () => {
        if (process.env.MEMORY_DB_DUMP) fs.writeFileSync(process.env.MEMORY_DB_DUMP, JSON.stringify(shared.$dump()));
        return disconnect();
      };
    }
    return shared;
  }
}
export const Prisma = { PrismaClientKnownRequestError };
export default { PrismaClient, Prisma };
