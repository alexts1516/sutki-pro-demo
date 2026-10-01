// Одна заявка по ссылке без входа (для подрядчика, у которого нет аккаунта в приложении команды).
//   GET  /api/task-link/:token            — та же карточка, что видит мастер (адрес + номер квартиры, «Как попасть» при EMPTY)
//   POST /api/task-link/:token/<шаг>      — те же шаги: request-visit, arrive, inspect, estimate, start, extras, complete, photos
// Ссылка работает, пока заявка активна; после «Выполнена»/«Отменена» — 410. Владелец/админ может выпустить новую ссылку
// (POST /api/admin/repairs/:id/link), старая сразу перестаёт работать.
import { Router } from 'express';
import { HttpError, notFound } from '../lib/errors.js';
import { loadTask, ACTIVE } from '../services/workRequests.js';
import { mountWorkActions } from './workActions.js';

export default function taskLinkRouter({ workflow, storage, config }) {
  const r = Router();
  async function resolve(req) {
    const token = String(req.params.token || '');
    if (token.length < 16) throw notFound('Ссылка не найдена');
    const task = await loadTask({ linkToken: token });
    if (!task) throw notFound('Ссылка не найдена или заменена новой');
    if (!ACTIVE.includes(task.status)) throw new HttpError(410, 'Заявка закрыта — ссылка больше не действует');
    return { task, actor: { type: 'link', id: null, name: task.contractor?.name || task.assignee?.name || 'Исполнитель по ссылке' } };
  }
  mountWorkActions(r, { prefix: '/:token', resolve, workflow, storage, config });
  return r;
}
