// Ошибка с HTTP-кодом: throw new HttpError(404, 'Квартира не найдена')
export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const notFound = (what = 'Не найдено') => new HttpError(404, what);
export const forbidden = (msg = 'Недостаточно прав') => new HttpError(403, msg);
export const badRequest = (msg, details) => new HttpError(400, msg, details);

// Проверка входных данных через zod: const data = parse(schema, req.body)
export function parse(schema, input) {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest('Проверьте данные', r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  return r.data;
}
