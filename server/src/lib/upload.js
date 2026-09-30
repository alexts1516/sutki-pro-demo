// Приём файлов (multer): держим в памяти, проверяем, что это картинка, и отдаём в хранилище.
import multer from 'multer';
import { IMAGE_TYPES } from '../storage/index.js';
import { badRequest } from './errors.js';

export function imageUpload({ maxMb = 15, maxFiles = 30 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles },
    fileFilter: (_req, file, cb) => IMAGE_TYPES[file.mimetype] ? cb(null, true) : cb(badRequest(`Файл «${file.originalname}»: можно загружать только JPG, PNG, WebP, GIF или AVIF`)),
  });
}
