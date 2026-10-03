// Хук загрузчика Node: '@prisma/client' → Prisma в памяти
const target = new URL('./prisma-client.js', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === '@prisma/client') return { url: target, shortCircuit: true };
  return next(specifier, context);
}
