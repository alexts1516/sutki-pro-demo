// Операционная картина дня: «готова ли квартира» (вычисляется, а не нажимается), экран «Сегодня» и карточка квартиры.
// Принцип «Требует внимания»: обычные процессы молчат, наверх поднимаются только отклонения.
// Уровни: critical (КРИТИЧНО) → action (ТРЕБУЕТ ДЕЙСТВИЯ) → today (СЕГОДНЯ по плану) → info (ИНФОРМАЦИЯ).
//
// Квартира «Готова», если одновременно:
//   1) нет незаконченной подготовки перед ближайшим заездом (за последние 3 дня и до дня заезда);
//   2) последняя подготовка закончена полностью (все пункты и обязательные фото) — или отчёт принят владельцем/админом;
//   3) нет открытого срочного недочёта и нет ремонта, закрывающего даты.
// Гость сейчас в квартире — «Гость живёт» (готовность к следующему заезду считается так же).
import { releaseExpiredLinks, stage } from './bookingLinks.js';
import { prisma } from '../db.js';
import { todayIn, addDays, isoDay, atLocal } from '../lib/dates.js';
import { getSettings, canApprove } from './settings.js';
import { isOverdue } from './performerPayouts.js';
import { estimateTotal, pendingExtras } from './workRequests.js';
import { defectOut } from './defects.js';

export const LEVELS = ['critical', 'action', 'today', 'info'];
export const LEVEL_RU = { critical: 'Критично', action: 'Требует действия', today: 'Сегодня по плану', info: 'Информация' };
export const READY_RU = { ready: 'Готова', not_ready: 'Не готова', blocked: 'Не готова — недочёт', check: 'Проверьте отчёт', occupied: 'Гость живёт' };
const H = 3600000;
const aptLabel = (a) => (a?.code ? `кв. ${a.code}` : a?.title || '');
const money = (n) => `${String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
const hmIn = (d, tz) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const DIR = { in: 'Встреча', out: 'Проводы' };

/** Срок подготовки: заезд следующего гостя в тот же день — к времени заезда, иначе — до конца окна по плану */
export function cleaningDeadline(task, bookings, tz) {
  const day = isoDay(task.date);
  const next = bookings.filter(b => b.apartmentId === task.apartmentId && b.status === 'confirmed' && isoDay(b.checkIn) >= day).sort((a, b) => a.checkIn - b.checkIn)[0];
  if (next && isoDay(next.checkIn) === day) return { at: atLocal(task.date, next.checkInTime, tz), reason: `заезд гостя в ${next.checkInTime}`, bookingId: next.id };
  return { at: atLocal(task.date, task.toTime || '18:00', tz), reason: `до ${task.toTime || '18:00'} по плану`, bookingId: next?.id || null };
}

async function snapshot(accountId, now) {
  await releaseExpiredLinks(accountId);
  const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
  const tz = acc?.timezone || 'Asia/Almaty';
  const today = todayIn(tz, now);
  const [apartments, bookings, cleanings, defects, repairs, jobs, holds, settings, specialBookings] = await Promise.all([
    prisma.apartment.findMany({ where: { accountId, active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, code: true, complex: true, address: true } }),
    prisma.booking.findMany({ where: { accountId, status: { in: ['confirmed', 'completed'] }, checkOut: { gte: addDays(today, -1) }, checkIn: { lte: addDays(today, 30) } }, include: { guest: { select: { name: true, phone: true } }, link: true }, orderBy: { checkIn: 'asc' } }),
    prisma.cleaningTask.findMany({ where: { accountId, date: { gte: addDays(today, -14), lte: addDays(today, 14) } }, include: { assignee: { select: { id: true, name: true } }, photos: true }, orderBy: [{ date: 'asc' }, { fromTime: 'asc' }] }),
    prisma.defect.findMany({ where: { accountId, status: 'open' }, include: { repairTask: { select: { id: true, status: true, title: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.repairTask.findMany({ where: { accountId, status: { notIn: ['DONE', 'CANCELLED'] } }, include: { estimates: true, extras: true, contractor: { select: { name: true } }, assignee: { select: { name: true } } }, orderBy: { date: 'asc' } }),
    prisma.transferJob.findMany({ where: { accountId, status: { not: 'CANCELLED' }, pickupAt: { gte: new Date(now.getTime() - 6 * H), lt: atLocal(addDays(today, 2), '00:00', tz) } }, include: { transfer: true, apartment: { select: { id: true, title: true, code: true } } }, orderBy: { pickupAt: 'asc' } }),
    prisma.booking.findMany({ where: { accountId, status: 'request', NOT: { holdUntil: { lte: now } } }, include: { link: true, guest: { select: { name: true, phone: true } }, apartment: { select: { title: true, code: true } } }, orderBy: { createdAt: 'asc' } }),   // истёкшее удержание даты уже не держит
    getSettings(accountId),
    prisma.booking.findMany({ where: { accountId, source: 'link', status: 'confirmed', checkOut: { gte: today } }, include: { link: true } }),
  ]);
  return { tz, today, now, apartments, bookings, cleanings, defects, repairs, jobs, holds, settings, specialBookings };
}

/** Состояние одной квартиры из снимка */
function apartmentState(a, snap) {
  const { tz, today, now } = snap;
  const inAt = (b) => atLocal(b.checkIn, b.checkInTime, tz), outAt = (b) => atLocal(b.checkOut, b.checkOutTime, tz);
  const bks = snap.bookings.filter(b => b.apartmentId === a.id);
  const current = bks.find(b => inAt(b) <= now && now < outAt(b)) || null;
  const next = bks.filter(b => b.status === 'confirmed' && inAt(b) > now).sort((x, y) => inAt(x) - inAt(y))[0] || null;
  const nextOut = current || bks.filter(b => outAt(b) > now).sort((x, y) => outAt(x) - outAt(y))[0] || null;
  const horizon = next ? isoDay(next.checkIn) : isoDay(today);
  const list = snap.cleanings.filter(c => c.apartmentId === a.id);
  const pending = list.filter(c => c.status !== 'done' && isoDay(c.date) <= horizon && isoDay(c.date) >= isoDay(addDays(today, -3)));
  const lastDone = list.filter(c => c.status === 'done' && isoDay(c.date) <= isoDay(today)).sort((x, y) => (x.doneAt || x.date) - (y.doneAt || y.date)).at(-1) || null;
  const needsReview = !!(lastDone && lastDone.finishNote && !lastDone.reviewedAt && !pending.length);
  const defects = snap.defects.filter(d => d.apartmentId === a.id);
  const urgent = defects.filter(d => d.priority === 'urgent');
  const onDay = next ? next.checkIn : today;
  const repairs = snap.repairs.filter(r => r.apartmentId === a.id);
  const blocking = repairs.filter(r => r.blockDays > 0 && r.date <= onDay && addDays(r.date, r.blockDays) > onDay);
  const reasons = [];
  for (const d of urgent) reasons.push(`Срочный недочёт: ${d.text}`);
  for (const r of blocking) reasons.push(`Ремонт закрывает даты: ${r.title}`);
  for (const c of pending) reasons.push(c.status === 'progress' ? `Подготовка идёт (${c.assignee?.name || '—'})` : c.assigneeId ? `Подготовка не начата (${c.assignee?.name})` : 'Подготовка не назначена');
  if (needsReview) reasons.push(`Подготовка закончена не полностью: ${lastDone.finishNote}`);
  const state = current ? 'occupied' : (urgent.length || blocking.length) ? 'blocked' : pending.length ? 'not_ready' : needsReview ? 'check' : 'ready';
  return { apartment: a, label: aptLabel(a), state, stateLabel: READY_RU[state], ready: !reasons.length, reasons, current, next, nextOut, pending, lastDone, needsReview, defects, repairs, inAt, outAt };
}

/** Все пункты «Требует внимания» + план дня. role — owner | admin */
async function buildItems(snap, { role, accountId }) {
  const { tz, today, now } = snap;
  const items = [];
  const push = (level, kind, o) => items.push({ id: `${kind}:${o.ref}`, level, kind, deadline: null, details: null, ...o });
  const t0 = isoDay(today), t1 = isoDay(addDays(today, 1));
  const states = snap.apartments.map(a => apartmentState(a, snap));
  const byApt = Object.fromEntries(states.map(s => [s.apartment.id, s]));
  const approver = await canApprove(accountId, role);

  for (const s of states) {
    const a = s.apartment;
    // заезд, а квартира не готова
    if (s.next && !s.ready) {
      const dl = s.inAt(s.next), day = isoDay(s.next.checkIn);
      if (day === t0 || (day === t1 && s.state === 'blocked')) {
        push(dl - now <= 3 * H || s.state === 'blocked' ? 'critical' : 'action', 'checkin_not_ready', {
          ref: s.next.id, problem: `${day === t0 ? 'Сегодня' : 'Завтра'} заезд в ${s.next.checkInTime} — квартира не готова`, action: s.state === 'blocked' ? 'Решить недочёт' : s.pending.some(c => !c.assigneeId) ? 'Назначить подготовку' : 'Проверить подготовку',
          deadline: dl, object: s.label, details: s.reasons.join(' · '), open: `apt:${a.id}`, aptId: a.id,
        });
      }
    }
    // подготовка: не назначена / просрочена / нужно принять отчёт
    for (const c of s.pending) {
      const dl = cleaningDeadline(c, snap.bookings, tz);
      if (!c.assigneeId && isoDay(c.date) <= t1) push(dl.at - now <= 3 * H ? 'critical' : 'action', 'prep_unassigned', { ref: c.id, problem: 'Подготовка не назначена', action: 'Назначить специалиста', deadline: dl.at, object: s.label, details: dl.reason, open: `cl:${c.id}`, aptId: a.id });
      else if (c.assigneeId && now > dl.at) push('critical', 'prep_overdue', { ref: c.id, problem: `Подготовка просрочена — ${c.status === 'progress' ? 'ещё идёт' : 'не начата'}`, action: `Позвонить: ${c.assignee?.name || 'специалист'}`, deadline: dl.at, object: s.label, details: dl.reason, open: `cl:${c.id}`, aptId: a.id });
    }
    if (s.needsReview) push('action', 'prep_review', { ref: s.lastDone.id, problem: 'Подготовка закончена не полностью', action: 'Проверить отчёт и принять', object: s.label, details: s.lastDone.finishNote, open: `cl:${s.lastDone.id}`, aptId: a.id });
    // недочёты
    for (const d of s.defects) {
      const soon = s.next && s.inAt(s.next) - now <= 48 * H;
      const lvl = d.priority === 'urgent' ? (soon ? 'critical' : 'action') : 'info';
      push(lvl, 'defect', {
        ref: d.id, problem: `${d.priority === 'urgent' ? 'Срочный недочёт' : 'Недочёт'}: ${d.text}`,
        action: d.repairTaskId ? `Ждём мастера (${d.repairTask?.status === 'IN_PROGRESS' ? 'в работе' : 'заявка создана'})` : d.takenByName ? `Взялся: ${d.takenByName} — отметить «Решено»` : 'Заявка мастеру · Сделаю сам · Решено',
        deadline: d.priority === 'urgent' && s.next ? s.inAt(s.next) : null, object: s.label, details: d.reportedByName ? `сообщил(а) ${d.reportedByName}` : null, open: `apt:${a.id}`, aptId: a.id,
      });
    }
  }
  // заявки мастерам
  for (const r of snap.repairs) {
    const label = byApt[r.apartmentId]?.label || '';
    const pendingEst = (r.estimates || []).find(e => e.status === 'pending');
    if (!r.assigneeId && !r.contractorId && !r.assigneeLabel) push('action', 'repair_no_master', { ref: r.id, problem: `Заявка без мастера: ${r.title}`, action: 'Выбрать мастера', object: label, open: `wr:${r.id}`, aptId: r.apartmentId });
    if (pendingEst) push(approver ? 'action' : 'info', 'estimate_pending', { ref: r.id, problem: `Смета ждёт решения: ${money(estimateTotal(pendingEst))}`, action: approver ? 'Одобрить или отклонить' : 'Ждёт решения владельца', object: label, details: r.title, open: `wr:${r.id}`, aptId: r.apartmentId, decision: true });
    const px = pendingExtras(r);
    if (px.length) push(approver ? 'action' : 'info', 'extra_pending', { ref: r.id, problem: `Доп. расход ждёт решения: ${money(px.reduce((x, e) => x + e.amountKzt, 0))}`, action: approver ? 'Одобрить или отклонить' : 'Ждёт решения владельца', object: label, details: r.title, open: `wr:${r.id}`, aptId: r.apartmentId, decision: true });
    if (r.status === 'APPROVED' && isoDay(r.date) < t0) push('action', 'repair_late', { ref: r.id, problem: `Работа не начата, хотя план — ${isoDay(r.date)}`, action: 'Уточнить у мастера', object: label, details: r.title, open: `wr:${r.id}`, aptId: r.apartmentId });
    if (isoDay(r.date) === t0 && !items.some(i => i.ref === r.id && i.level !== 'info')) push('today', 'repair_today', { ref: r.id, problem: r.title, action: null, object: label, details: r.contractor?.name || r.assignee?.name || r.assigneeLabel || '', open: `wr:${r.id}`, aptId: r.apartmentId });
  }
  // трансферы
  for (const j of snap.jobs) {
    const label = j.apartment ? aptLabel(j.apartment) : (j.transfer.address || 'без квартиры');
    const left = j.pickupAt - now;
    const what = `${DIR[j.transfer.direction]} ${hmIn(j.pickupAt, tz)}${j.transfer.flight ? ` · ${j.transfer.flight}` : ''}`;
    if (j.status === 'UNASSIGNED' || (j.status === 'OFFERED' && left <= 3 * H)) push(left <= 24 * H ? 'critical' : 'action', 'transfer_no_driver', { ref: j.id, problem: `Трансфер без водителя: ${what}`, action: 'Назначить водителя', deadline: j.pickupAt, object: label, details: j.transfer.guestName || '', open: `tr:${j.id}:${j.transferId}`, aptId: j.apartmentId });
    else if (j.status === 'ACCEPTED' && left <= 30 * 60000 && left > -2 * H) push('critical', 'driver_late', { ref: j.id, problem: `Водитель ещё не выехал: ${what}`, action: `Позвонить: ${j.driverName || 'водитель'}`, deadline: j.pickupAt, object: label, open: `tr:${j.id}:${j.transferId}`, aptId: j.apartmentId });
    else if (isoDay(j.transfer.date) === t0 && j.status !== 'DONE') push('today', 'transfer_today', { ref: j.id, problem: what, action: null, deadline: j.pickupAt, object: label, details: `${j.driverName || 'ищем водителя'} · ${j.transfer.guestName || ''}`, open: `tr:${j.id}:${j.transferId}`, aptId: j.apartmentId, status: j.status });
  }
  // брони: ранний заезд (пожелание гостя) и неоплаченные заявки (держат даты до оплаты)
  for (const b of snap.bookings) {
    if (b.status === 'confirmed' && b.earlyCheckInStatus === 'requested' && isoDay(b.checkIn) >= t0) {
      push('action', 'early_checkin', { ref: b.id, problem: `Гость просит ранний заезд в ${b.earlyCheckIn} (обычно ${b.checkInTime})`, action: 'Согласовать или отказать', deadline: atLocal(b.checkIn, b.earlyCheckIn, tz), object: byApt[b.apartmentId]?.label || '', details: `${b.guest?.name || ''} · №${b.number} · ${isoDay(b.checkIn)}`, open: `bk:${b.id}`, aptId: b.apartmentId, decision: true });
    }
  }
  for (const b of snap.holds.filter(b => b.source !== 'link')) push('info', 'awaiting_payment', { ref: b.id, problem: `Бронь №${b.number} ждёт оплаты гостем`, action: null, object: aptLabel(b.apartment), details: `${b.guest?.name || ''} · ${isoDay(b.checkIn)} — подтвердится сама после оплаты на сайте`, open: `bk:${b.id}`, aptId: b.apartmentId });
  // Особые брони: только отклонения, никаких строк для спокойного ожидания гостя.
  for (const b of [...snap.holds, ...snap.specialBookings].filter(b => b.source === 'link' && b.link)) {
    const l = b.link;
    const open = `bk:${b.id}`;
    const object = byApt[b.apartmentId]?.label || aptLabel(b.apartment);
    const conflicting = snap.repairs.filter(r => r.apartmentId === b.apartmentId && r.blockDays > 0 && r.date < b.checkOut && addDays(r.date, r.blockDays) > b.checkIn);
    if (conflicting.length && ['request', 'confirmed'].includes(b.status)) {
      push('critical', 'link_conflict', { ref: b.id, problem: `Особая бронь №${b.number}: ремонт пересекается с проживанием`, action: 'Перенести ремонт или связаться с гостем', object, details: conflicting.map(r => r.title).join(', '), open, aptId: b.apartmentId, decision: true });
    }
    if (l.status !== 'active' || b.status !== 'request') continue;
    const left = +b.holdUntil - now;
    if (b.holdUntil && left > 0 && left <= 3 * H) push(left <= H ? 'critical' : 'action', 'link_expiring', { ref: b.id, problem: `Предложение №${b.number} скоро истечёт`, action: 'Напомнить гостю или продлить', deadline: b.holdUntil, object, details: 'Квартира удерживается до конца срока', open, aptId: b.apartmentId, decision: true });
    if (l.submittedAt && stage(l, b, now) === 'waiting_admin') push('action', 'link_waiting_admin', { ref: b.id, problem: l.extraCheckRequired && !l.extraCheckedAt ? 'Ждём дополнительное подтверждение' : 'Гость закончил оформление — ждём отметку залога', action: 'Проверить и отметить полученным', object, open, aptId: b.apartmentId, decision: true });
  }
  // проход 4, шаг 3: строка журнала отложенных действий не выполнилась за 5 попыток — разбор вручную
  const failed = await prisma.outboxEvent.findMany({ where: { accountId, status: 'failed' }, orderBy: { createdAt: 'asc' }, take: 50 });
  if (failed.length) {
    const bid = (f) => f.payload?.bookingId || f.payload?.data?.bookingId || null;
    const bks = await prisma.booking.findMany({ where: { accountId, id: { in: failed.map(bid).filter(Boolean) } }, select: { id: true, number: true, apartmentId: true } });
    const WHAT = { 'transfers.dispatch': 'заказ водителям', 'transfers.cancel': 'отмена заказов водителям', event: 'уведомление' };
    for (const f of failed) {
      const b = bks.find(x => x.id === bid(f));
      push('critical', 'outbox_failed', { ref: f.id, problem: `Не завершена цепочка брони №${b?.number || '—'}`, action: 'Разобрать вручную', object: b ? byApt[b.apartmentId]?.label || '' : '', details: `${WHAT[f.kind] || f.kind}: ${f.lastError || 'ошибка'}`, open: b ? `bk:${b.id}` : null, aptId: b?.apartmentId || null });
    }
  }
  // проход 4, шаг 4: оплата пришла, когда даты уже заняты (или бронь отменена) — вернуть деньги вручную.
  // Источник — строка журнала event:payment.orphaned (одна на платёж); пункт исчезает, когда у брони отмечен возврат.
  const orphans = await prisma.outboxEvent.findMany({ where: { accountId, dedupeKey: { startsWith: 'event:payment.orphaned:' } }, orderBy: { createdAt: 'asc' }, take: 50 });
  if (orphans.length) {
    const obk = await prisma.booking.findMany({ where: { accountId, id: { in: orphans.map(o => o.payload?.data?.bookingId).filter(Boolean) } }, include: { guest: { select: { name: true, phone: true } }, apartment: { select: { title: true, code: true } } } });
    for (const o of orphans) {
      const x = o.payload?.data || {}; const b = obk.find(y => y.id === x.bookingId);
      if (!b || b.paymentStatus === 'refunded') continue;
      push('critical', 'payment_orphaned', { ref: x.paymentId, problem: `Оплата без брони — верните деньги: ${money(x.amountKzt || 0)}`, action: 'Вернуть деньги гостю (вручную) и отметить возврат', object: aptLabel(b.apartment), details: `№${b.number} · ${b.guest?.name || 'гость'}${b.guest?.phone ? ' · ' + b.guest.phone : ''} · ${isoDay(b.checkIn)}–${isoDay(b.checkOut)} · ${x.reason === 'dates_taken' ? 'даты заняли после истечения срока оплаты' : 'бронь отменена'}`, open: `bk:${b.id}`, aptId: b.apartmentId });
    }
  }
  for (const s of states) {
    for (const b of snap.bookings.filter(x => x.apartmentId === s.apartment.id)) {
      if (b.status === 'confirmed' && isoDay(b.checkIn) === t0) push('today', 'checkin', { ref: b.id, problem: `Заезд ${b.checkInTime} · ${b.guest?.name || 'гость'}`, action: null, deadline: s.inAt(b), object: s.label, details: `${b.guestsCount} гост.`, open: `bk:${b.id}`, aptId: s.apartment.id, ready: s.ready, readyLabel: s.ready ? 'готова' : 'не готова' });
      if (isoDay(b.checkOut) === t0) push('today', 'checkout', { ref: b.id, problem: `Выезд ${b.checkOutTime} · ${b.guest?.name || 'гость'}`, action: null, deadline: s.outAt(b), object: s.label, open: `bk:${b.id}`, aptId: s.apartment.id });
    }
  }
  for (const c of snap.cleanings.filter(c => isoDay(c.date) === t0)) {
    if (items.some(i => i.ref === c.id && ['critical', 'action'].includes(i.level))) continue;
    const dl = cleaningDeadline(c, snap.bookings, tz);
    push('today', 'prep', { ref: c.id, problem: `Подготовка — ${c.assignee?.name || 'не назначена'}`, action: null, deadline: dl.at, object: byApt[c.apartmentId]?.label || '', details: dl.reason, open: `cl:${c.id}`, aptId: c.apartmentId, status: c.status });
  }
  return { items, states };
}

/** Экран «Сегодня»: владелец — только отклонения и решения (если есть админ), админ — вся операционная картина */
export async function todayView(accountId, { role, now = new Date() }) {
  const snap = await snapshot(accountId, now);
  const { items, states } = await buildItems(snap, { role, accountId });
  let list = items;
  let payouts = null;
  if (role === 'owner') {
    const hasAdmin = await prisma.membership.count({ where: { accountId, role: 'admin', active: true } });
    const pend = await prisma.payout.findMany({ where: { accountId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
    const hours = snap.settings.payoutReminderHours;
    const byPerson = {};
    for (const p of pend.filter(p => isOverdue(p, hours, now.getTime()))) (byPerson[p.userId || p.contractorId || p.name] ||= []).push(p);
    for (const [k, ps] of Object.entries(byPerson)) list.push({ id: `payout_overdue:${k}`, ref: k, level: 'action', kind: 'payout_overdue', problem: `Не выплачено: ${ps[0].name || 'исполнитель'} — ${money(ps.reduce((x, p) => x + p.amountKzt, 0))}`, action: 'Оплатить', deadline: null, object: ps.map(p => p.title).join(', ').slice(0, 80), details: `дольше ${hours} ч`, open: 'payouts', decision: true });
    payouts = { pendingKzt: pend.reduce((x, p) => x + p.amountKzt, 0), count: pend.length };
    // владелец с админом: рутина (назначить, проверить отчёт, план дня) — у админа; владельцу — критичное и решения
    if (hasAdmin) list = list.filter(i => i.level === 'critical' || i.decision || (i.kind === 'defect' && i.level !== 'info') || i.level === 'today' || i.level === 'info');
  }
  const ord = (i) => LEVELS.indexOf(i.level);
  list.sort((a, b) => ord(a) - ord(b) || (a.deadline ? +new Date(a.deadline) : Infinity) - (b.deadline ? +new Date(b.deadline) : Infinity));
  const monthStart = new Date(Date.UTC(snap.today.getUTCFullYear(), snap.today.getUTCMonth(), 1));
  const business = role === 'owner' ? {
    apartments: states.length, occupied: states.filter(s => s.state === 'occupied').length, notReady: states.filter(s => !s.ready && s.state !== 'occupied').length,
    revenueMonthKzt: (await prisma.booking.aggregate({ where: { accountId, status: { in: ['confirmed', 'completed'] }, checkIn: { gte: monthStart, lt: new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)) } }, _sum: { totalKzt: true } }))._sum.totalKzt || 0,
    owedKzt: payouts?.pendingKzt || 0, owedCount: payouts?.count || 0,
  } : null;
  return {
    date: isoDay(snap.today), now, role,
    counts: Object.fromEntries(LEVELS.map(l => [l, list.filter(i => i.level === l).length])),
    items: list, business,
    apartments: states.map(s => ({ id: s.apartment.id, label: s.label, title: s.apartment.title, state: s.state, stateLabel: s.stateLabel, ready: s.ready, reasons: s.reasons, defects: s.defects.length, urgentDefects: s.defects.filter(d => d.priority === 'urgent').length,
      next: s.next ? { id: s.next.id, checkIn: isoDay(s.next.checkIn), time: s.next.checkInTime } : null })),
  };
}

/** Карточка квартиры: одно место, где видно всё её состояние */
export async function apartmentOps(accountId, apartmentId, { role, now = new Date() }) {
  const snap = await snapshot(accountId, now);
  const a = snap.apartments.find(x => x.id === apartmentId) || await prisma.apartment.findFirst({ where: { id: apartmentId, accountId }, select: { id: true, title: true, code: true, complex: true, address: true } });
  if (!a) return null;
  if (!snap.apartments.includes(a)) snap.apartments.push(a);
  const s = apartmentState(a, snap);
  const { items } = await buildItems(snap, { role, accountId });
  const photos = await prisma.cleaningPhoto.findMany({ where: { accountId, id: { in: s.defects.flatMap(d => d.photoIds || []) } } });
  const bk = (b) => b && { id: b.id, number: b.number, guest: b.guest?.name || null, phone: b.guest?.phone || null, guestsCount: b.guestsCount, checkIn: isoDay(b.checkIn), checkInTime: b.checkInTime, checkOut: isoDay(b.checkOut), checkOutTime: b.checkOutTime, paymentStatus: b.paymentStatus, earlyCheckIn: b.earlyCheckIn, earlyCheckInStatus: b.earlyCheckInStatus };
  const prep = s.pending[0] || null;
  const proof = s.lastDone ? s.lastDone.photos.slice(-8).map(p => ({ id: p.id, url: p.url, itemIndex: p.itemIndex, kind: p.kind })) : [];
  return {
    apartment: { id: a.id, title: a.title, label: s.label, address: a.address },
    state: s.state, stateLabel: s.stateLabel, ready: s.ready, reasons: s.reasons,
    current: bk(s.current), next: bk(s.next), nextOut: s.nextOut && s.nextOut !== s.current ? bk(s.nextOut) : null,
    prep: prep && { id: prep.id, date: isoDay(prep.date), status: prep.status, assignee: prep.assignee?.name || null, deadline: cleaningDeadline(prep, snap.bookings, snap.tz) },
    lastDone: s.lastDone && { id: s.lastDone.id, date: isoDay(s.lastDone.date), assignee: s.lastDone.assignee?.name || null, startedAt: s.lastDone.startedAt, doneAt: s.lastDone.doneAt, finishNote: s.lastDone.finishNote, reviewedAt: s.lastDone.reviewedAt },
    proofPhotos: proof,
    defects: s.defects.map(d => defectOut(d, photos)),
    repairs: s.repairs.map(r => ({ id: r.id, title: r.title, status: r.status, date: isoDay(r.date), executor: r.contractor?.name || r.assignee?.name || r.assigneeLabel || null })),
    actions: items.filter(i => i.aptId === a.id && ['critical', 'action'].includes(i.level)).sort((x, y) => LEVELS.indexOf(x.level) - LEVELS.indexOf(y.level)),
  };
}

/** Для календаря: открытые недочёты по квартирам (⚠N) и готовность */
export async function readinessMap(accountId, now = new Date()) {
  const snap = await snapshot(accountId, now);
  return Object.fromEntries(snap.apartments.map(a => { const s = apartmentState(a, snap); return [a.id, { state: s.state, ready: s.ready, defects: s.defects.length, urgent: s.defects.filter(d => d.priority === 'urgent').length, byCleaning: s.defects.reduce((m, d) => { if (d.cleaningTaskId) m[d.cleaningTaskId] = (m[d.cleaningTaskId] || 0) + 1; return m; }, {}) }]; }));
}
