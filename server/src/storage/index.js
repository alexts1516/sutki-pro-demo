import path from 'node:path';
import { randomToken } from '../lib/tokens.js';
import { createLocalStorage } from './local.js';
import { createS3Storage } from './s3.js';

/** Хранилище фото: local (папка uploads/, по умолчанию) или s3 (STORAGE_DRIVER=s3, см. src/storage/s3.js) */
export function createStorage(cfg, deps = {}) {
  return cfg.driver === 's3' ? createS3Storage(cfg.s3, deps) : createLocalStorage({ uploadDir: cfg.uploadDir });
}

// Разрешённые картинки. SVG не принимаем: в нём может быть скрипт.
export const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

/** Ключ файла: <аккаунт>/<папка>/<случайное имя>.<расширение> */
export function makeKey(accountId, folder, mime, originalName = '') {
  const ext = IMAGE_TYPES[mime] || path.extname(originalName).slice(1).toLowerCase() || 'bin';
  return `${accountId}/${folder}/${Date.now().toString(36)}-${randomToken(6)}.${ext}`;
}

/** Проверка «магических байтов» — что файл действительно картинка, а не переименованный .exe */
export function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  const h = buf.subarray(0, 12);
  return (h[0] === 0xff && h[1] === 0xd8) ||                                   // JPEG
    (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) ||        // PNG
    (h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP') ||
    h.toString('ascii', 0, 3) === 'GIF' ||
    h.toString('ascii', 4, 12).startsWith('ftypavi');                            // AVIF
}
