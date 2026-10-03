// Хранилище фото в демо: картинка сохраняется прямо в данные (data: URL) — в браузере, вместе с остальной «базой».
// Фото дома и логотип из сида — готовые файлы демо (v2/demo/assets).
import { Buffer } from 'buffer/';
const assetUrl = (name) => new URL(`./assets/${name}`, import.meta.url).href;   // import.meta.url — адрес demo.js

export function createLocalStorage() {
  return {
    driver: 'local', uploadDir: '/uploads',
    async save(key, buffer, mime = 'application/octet-stream') {
      if (buffer && buffer.__asset) return { key, url: assetUrl(buffer.__asset) };
      const b64 = Buffer.from(buffer).toString('base64');
      return { key, url: `data:${mime};base64,${b64}` };
    },
    async remove() {},
    async removeFolder() {},
    urlFor: (key) => key,
  };
}
export const createS3Storage = () => { throw new Error('S3 в демо не подключён'); };
