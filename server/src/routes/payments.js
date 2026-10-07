// Вебхуки платёжных систем. Тело читаем «как есть» (raw) — это нужно для проверки подписи.
//   POST /api/payments/cloudpayments/check | pay | fail
//   POST /api/payments/paylink/notify
import express, { Router } from 'express';
import { prisma } from '../db.js';
import { applyPaymentResult } from '../payments/index.js';

export default function paymentsRouter({ payments, events, dispatch = null, logger = console }) {
  const r = Router();
  r.use(express.raw({ type: () => true, limit: '1mb' }));

  const handle = (providerName, kind) => async (req, res) => {
    if (!payments || payments.name !== providerName) return res.status(404).json({ error: 'Провайдер оплаты не подключён' });
    const out = await payments.handleWebhook({ kind, rawBody: req.body, headers: req.headers, prisma });
    if (out.error) logger.warn(`[payments] ${providerName}/${kind}: ${out.error}`);
    if (out.result) { const result=await applyPaymentResult({prisma,events,dispatch,result:out.result}); if(result?.rejectedOperation) return res.status(200).json(providerName==='cloudpayments'?{code:13}:{ok:true,ignored:true}); }
    res.status(out.status).json(out.body);
  };
  for (const kind of ['check', 'pay', 'fail']) r.post(`/cloudpayments/${kind}`, handle('cloudpayments', kind));
  r.post('/paylink/notify', handle('paylink', 'notify'));
  return r;
}
