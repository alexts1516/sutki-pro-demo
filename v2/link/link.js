// Одна задача по ссылке без входа: внешний мастер (заявка) или внешний водитель (трансфер).
// Ссылку присылает владелец/админ; после выполнения или отмены она перестаёт работать.
import { $, api, transferDetail, bindTransfer, repairDetail, bindRepair, toast } from '../shared/views.js';

const token = decodeURIComponent(location.hash.slice(1) || '');
window.addEventListener('hashchange', () => location.reload());
const view = (html) => { $('#view').innerHTML = html; return $('#view'); };
const closed = (msg) => view(`<div class="card empty"><div style="font-size:40px">✅</div><b>${msg}</b><div class="sub" style="margin-top:6px">Если это ошибка — свяжитесь с тем, кто прислал ссылку.</div></div>`);

async function start() {
  try {
    const { kind } = await api(`/api/link/${encodeURIComponent(token)}`);
    if (kind === 'transfer') return showTransfer();
    return showTask();
  } catch (e) {
    if (e.status === 410) return closed('Задача уже закрыта — ссылка больше не действует');
    if (e.status === 429) return closed('Слишком много запросов — попробуйте через несколько минут');
    return closed('Ссылка недействительна или заменена новой');
  }
}
async function showTransfer() {
  const base = `/api/transfer-link/${encodeURIComponent(token)}`;
  try {
    const j = await api(base);
    $('#title').textContent = `Трансфер · ${j.driverName || 'водитель'}`;
    const root = view(transferDetail(j));
    bindTransfer(root, j, { base, onChange: async (u, msg) => { if (msg) toast(msg); return showTransfer(); } });
  } catch (e) { if (e.status === 410) return closed('Поездка завершена — спасибо!'); throw e; }
}
async function showTask() {
  const base = `/api/task-link/${encodeURIComponent(token)}`;
  try {
    const t = await api(base);
    $('#title').textContent = t.title;
    const root = view(repairDetail(t));
    bindRepair(root, t, { base, onChange: async (u, msg) => { toast(msg); if (u?.declined) return closed('Вы отказались от заявки. Спасибо, что предупредили!'); return showTask(); } });
  } catch (e) { if (e.status === 410) return closed('Заявка закрыта — спасибо за работу!'); throw e; }
}
start();
