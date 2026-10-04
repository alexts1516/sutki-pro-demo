// Распознавание ошибок PostgreSQL, которые означают конфликт занятости, а не поломку.
// Клиент никогда не видит сырую ошибку базы: такие ошибки превращаются в 409.
import { HttpError } from './errors.js';

const text = (e) => `${e?.code || ''} ${e?.message || ''} ${e?.meta ? JSON.stringify(e.meta) : ''}`;

/** 23P01 — нарушено ограничение booking_no_overlap (две блокирующие брони одной квартиры пересекаются) */
export const isOverlapError = (e) => /23P01|booking_no_overlap|exclusion constraint/i.test(text(e));
/** 40P01 — взаимная блокировка (deadlock); Prisma иногда сообщает её как P2034 */
export const isDeadlockError = (e) => e?.code === 'P2034' || /40P01|deadlock detected/i.test(text(e));
/** P2028 — транзакцию не удалось начать или она истекла (долго ждали очередь к квартире) */
export const isTxTimeoutError = (e) => e?.code === 'P2028';

export const DATES_TAKEN = 'Эти даты уже заняты';
export const BUSY_RETRY = 'Эту квартиру сейчас меняют одновременно — обновите страницу и попробуйте ещё раз';

/** Конфликт занятости → HttpError(409); остальные ошибки — без изменений */
export function toConflict(e) {
  if (e instanceof HttpError) return e;
  if (isOverlapError(e)) return new HttpError(409, DATES_TAKEN);
  if (isDeadlockError(e) || isTxTimeoutError(e)) return new HttpError(409, BUSY_RETRY);
  return e;
}
