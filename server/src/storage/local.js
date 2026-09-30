// Хранилище файлов на диске сервера: папка server/uploads, раздаётся по адресу /uploads/...
// Подходит для VPS и для разработки. На Render/Railway диск временный — там используйте S3 (см. README).
import fs from 'node:fs/promises';
import path from 'node:path';

export function createLocalStorage({ uploadDir, publicPath = '/uploads' }) {
  const full = (key) => {
    const p = path.resolve(uploadDir, key);
    if (!p.startsWith(path.resolve(uploadDir) + path.sep)) throw new Error('Некорректный путь файла');
    return p;
  };
  return {
    driver: 'local',
    uploadDir,
    async save(key, buffer) {
      const p = full(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, buffer);
      return { key, url: `${publicPath}/${key}` };
    },
    async remove(key) { if (!key) return; try { await fs.unlink(full(key)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
    /** удалить папку целиком (например, все файлы аккаунта) */
    async removeFolder(prefix) { await fs.rm(full(prefix), { recursive: true, force: true }); },
    urlFor: (key) => `${publicPath}/${key}`,
  };
}
