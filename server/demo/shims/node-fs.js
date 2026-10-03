// node:fs для демо: сид читает два файла (фото дома и логотип) — отдаём метку, хранилище подставит адрес картинки демо
export function readFileSync(p) { return { __asset: String(p).split('/').pop() }; }
export function existsSync() { return false; }
export const promises = {};
export default { readFileSync, existsSync, promises };
