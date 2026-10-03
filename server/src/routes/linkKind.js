// GET /api/link/:token — что это за ссылка: заявка мастеру (task) или трансфер (transfer).
// Нужен странице /link/:token, чтобы одним запросом понять, какие шаги показывать. Ничего, кроме вида, не отдаёт.
import { Router } from 'express';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';

export default function linkKindRouter() {
  const r = Router();
  r.get('/:token', async (req, res) => {
    const token = String(req.params.token || '');
    if (token.length < 16 || token.length > 64) throw notFound('Ссылка не найдена');
    const [task, job] = await Promise.all([
      prisma.repairTask.findUnique({ where: { linkToken: token }, select: { id: true } }),
      prisma.transferJob.findUnique({ where: { linkToken: token }, select: { id: true, driverContractorId: true } }),
    ]);
    if (task) return res.json({ kind: 'task' });
    if (job?.driverContractorId) return res.json({ kind: 'transfer' });
    throw notFound('Ссылка не найдена или заменена новой');
  });
  return r;
}
