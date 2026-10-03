// @prisma/client в браузере: одна общая «база» в памяти (demo/prisma-memory.js) по схеме prisma/schema.prisma
import { createMemoryPrisma, PrismaClientKnownRequestError } from '../prisma-memory.js';
import models from '../generated/models.json';

export class PrismaClient {
  constructor() {
    if (!globalThis.__demoPrisma) globalThis.__demoPrisma = createMemoryPrisma({ models, onChange: () => globalThis.__demoChanged?.() });
    return globalThis.__demoPrisma;
  }
}
export const Prisma = { PrismaClientKnownRequestError };
export default { PrismaClient, Prisma };
