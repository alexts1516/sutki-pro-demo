// Общие экраны для приложения команды (/app/) и страницы одной задачи по ссылке (/link/:token):
// карточка трансфера с кнопками водителя и карточка заявки мастеру с шагами. Сервер решает, что можно,
// здесь только показываем кнопки из поля actions и отправляем шаги.
export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₸';
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const fmtDay = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]}`; };
export const hm = (d) => d ? new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
export const dt = (d) => d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
// день по времени бизнеса (Астана): «сегодня / завтра / через N дн.»
export const TZ = 'Asia/Almaty';
export const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
export const daysFromToday = (d) => Math.round((Date.parse(dayKey(d)) - Date.parse(dayKey(Date.now()))) / 86400000);
export const whenWord = (d) => { const n = daysFromToday(d); return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : n > 1 ? `через ${n} дн.` : 'просрочено'; };
export const hmTz = (d) => d ? new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
/** Группы по времени: Сегодня / Завтра / Позже (ближайшие — первыми) */
export function byDay(list, at) {
  const sorted = [...list].sort((a, b) => new Date(at(a)) - new Date(at(b)));
  const g = { past: [], today: [], tomorrow: [], later: [] };
  for (const x of sorted) { const n = daysFromToday(at(x)); (n < 0 ? g.past : n === 0 ? g.today : n === 1 ? g.tomorrow : g.later).push(x); }
  return g;
}

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) { const e = new Error(data?.error || `Ошибка ${res.status}`); e.status = res.status; throw e; }
  return data;
}
let toastTimer;
export function toast(msg, err) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); }
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 4500 : 2500);
}
export const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

/** Нижняя шторка (на телефоне удобно одной рукой) */
export function sheet(html) {
  let s = $('#sheet');
  if (!s) { s = document.createElement('div'); s.id = 'sheet'; s.className = 'sheet'; document.body.append(s); s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) closeSheet(); }); }
  s.innerHTML = `<div><button class="close" data-close aria-label="Закрыть">✕</button><div class="grab"></div><div class="sheet-body">${html}</div></div>`;
  s.hidden = false; document.body.style.overflow = 'hidden';
  return $('.sheet-body', s);
}
export function closeSheet() { const s = $('#sheet'); if (s) s.hidden = true; document.body.style.overflow = ''; }

// ---------------- трансферы ----------------
export const TR_ST = {
  OFFERED: ['amber', 'Новый заказ'], UNASSIGNED: ['red', 'Срочно: никто не взял'], ACCEPTED: ['blue', 'Вы везёте'], EN_ROUTE: ['blue', 'В пути'],
  ARRIVED: ['blue', 'На месте'], PICKED_UP: ['blue', 'Гость в машине'], DONE: ['green', 'Выполнен'], CANCELLED: ['', 'Отменён'], TAKEN: ['', 'Взял другой водитель'],
};
const DIR = { in: 'Встреча', out: 'Проводы' };
export const trBadge = (s, label) => { const [t, l] = TR_ST[s] || ['', label || s]; return `<span class="chip ${t}">${esc(label && s === 'TAKEN' ? label : l)}</span>`; };
const flightLink = (f) => `https://www.flightradar24.com/data/flights/${encodeURIComponent(String(f).replace(/\s+/g, '').toLowerCase())}`;

/** «Запланировано · через N дн.» — шаги поездки ещё закрыты (откроются за ~2 ч до подачи) */
export const plannedLabel = (j) => `Запланировано · ${whenWord(j.pickupAt)}`;
export function transferCard(j) {
  if (j.planned) return `<div class="card tap t-grey" data-tr="${j.id}">
    <div class="row between"><span class="when">${fmtDay(j.date)}, ${esc(j.time)}</span><span class="chip">${esc(plannedLabel(j))}</span></div>
    <div class="sub">${DIR[j.direction]} · ${esc(j.placeLabel)}${j.flight ? ` · рейс ${esc(j.flight)}` : ''}</div>
    <div class="route"><div><i></i><span>${esc(j.from)}</span></div><div><i class="end"></i><span>${esc(j.to)}</span></div></div>
    <div class="sub">🔒 «Выехал» откроется ${whenWord(j.startOpensAt) === 'сегодня' ? '' : fmtDay(dayKey(j.startOpensAt)) + ' '}в ${hmTz(j.startOpensAt)}</div></div>`;
  const tone = (TR_ST[j.status] || [''])[0];
  if (j.status === 'TAKEN') return `<div class="card"><div class="row between"><b>${fmtDay(j.date)}, ${esc(j.time)}</b>${trBadge('TAKEN', j.statusLabel)}</div><div class="sub">${DIR[j.direction] || ''} · ${esc(j.placeLabel)}</div></div>`;
  return `<div class="card tap t-${tone}" data-tr="${j.id}">
    <div class="row between"><span class="when">${fmtDay(j.date)}, ${esc(j.time)}</span>${trBadge(j.status)}</div>
    <div class="sub">${DIR[j.direction]} · ${esc(j.placeLabel)}${j.flight ? ` · рейс ${esc(j.flight)}` : ''}</div>
    <div class="route"><div><i></i><span>${esc(j.from)}</span></div><div><i class="end"></i><span>${esc(j.to)}</span></div></div>
    <div class="row between"><span class="sub">👤 ${esc(j.guestName || 'гость')} · ${j.pax} пасс. · багаж ${j.bags ?? 0}${j.childSeats ? ` · кресло ×${j.childSeats}` : ''}</span>${j.noPayout ? '<span class="sub">без выплаты</span>' : j.payoutKzt != null ? `<b>${money(j.payoutKzt)}</b>` : ''}</div>
    ${(j.actions || []).includes('accept') ? `<button class="btn success block big" data-accept="${j.id}" style="margin-top:10px">✋ Беру</button>` : ''}
  </div>`;
}

const NEXT = { 'en-route': ['🚗 Выехал', 'primary'], arrived: ['📍 Я на месте', 'primary'], 'picked-up': ['🧳 Гость в машине', 'primary'], done: ['✅ Завершить поездку', 'success'] };
// что от водителя ждут сейчас и когда работа засчитана
export const TR_HINT = {
  OFFERED: 'Если можете отвезти — нажмите «Беру». Заказ получает первый.', UNASSIGNED: 'Никто не взял — если можете, возьмите.',
  ACCEPTED: 'Перед выездом нажмите «Выехал» — гостю придёт сообщение.', EN_ROUTE: 'Когда приедете — «Я на месте».', ARRIVED: 'Гость сел — «Гость в машине».',
  PICKED_UP: 'Довезите гостя и нажмите «Завершить поездку».', DONE: 'Поездка засчитана — выплата появится в «Выплатах».',
};
export function transferDetail(j) {
  const acts = j.actions || [];
  const step = ['en-route', 'arrived', 'picked-up', 'done'].find(a => acts.includes(a));
  const open = ['OFFERED', 'UNASSIGNED'].includes(j.status);
  const a = j.apartment || {};
  return `<div class="row between"><span class="when">${DIR[j.direction]} · ${fmtDay(j.date)}, ${esc(j.time)}</span>${j.planned ? `<span class="chip">${esc(plannedLabel(j))}</span>` : trBadge(j.status)}</div>
    ${j.planned ? `<div class="alert blue">🔒 Поездка запланирована. Кнопка «Выехал» появится ${fmtDay(dayKey(j.startOpensAt))} в ${hmTz(j.startOpensAt)} — за ${Math.round((new Date(j.pickupAt) - new Date(j.startOpensAt)) / 360000) / 10} ч до подачи. Шаги нажимаются по порядку: Выехал → На месте → Гость в машине → Завершить.</div>`
      : TR_HINT[j.status] && !open ? `<div class="hint">👉 ${TR_HINT[j.status]}${j.status !== 'DONE' ? ' Поездка засчитывается после «Завершить поездку».' : ''}</div>` : ''}
    ${j.status === 'UNASSIGNED' ? '<div class="alert red">Никто ещё не взял — если можете, возьмите.</div>' : ''}
    ${open ? '<div class="alert amber">Номер квартиры и телефон гостя появятся после «Беру». Заказ получает тот, кто нажмёт первым.</div>' : ''}
    ${j.flightStatus ? `<div class="alert blue">✈️ Рейс: ${esc(j.flightStatus)}${j.flightEta ? `, прилёт около ${hm(j.flightEta)}` : ''}</div>` : ''}
    <div class="card"><div class="route"><div><i></i><span>${esc(j.from)}</span></div><div><i class="end"></i><span>${esc(j.to)}</span></div></div>
      <dl class="kv">${j.flight ? `<dt>Рейс</dt><dd>${esc(j.flight)} · <a href="${flightLink(j.flight)}" target="_blank" rel="noopener">проверить ↗</a></dd>` : ''}
      ${j.meetingPoint ? `<dt>Где встречать</dt><dd>${esc(j.meetingPoint)}</dd>` : ''}
      <dt>Ожидание</dt><dd>бесплатно ${j.freeWaitMin} мин${j.arrivedAt ? ` (на месте с ${hm(j.arrivedAt)})` : ''}</dd>
      ${a.building && a.apartmentNumber ? `<dt>Дом</dt><dd>${esc(a.building)}</dd>` : ''}${a.apartmentNumber ? `<dt>Квартира</dt><dd><b>№ ${esc(a.apartmentNumber)}</b></dd>` : ''}</dl></div>
    <div class="card"><dl class="kv"><dt>Гость</dt><dd>${esc(j.guestName || '—')}</dd>
      <dt>Пассажиры</dt><dd>${j.pax} · багаж ${j.bags ?? 0}${j.childSeats ? ` · детское кресло ×${j.childSeats}` : ''}</dd>
      ${j.notes ? `<dt>Заметки</dt><dd>${esc(j.notes)}</dd>` : ''}
      ${j.guestPhone ? `<dt>Телефон</dt><dd><a href="${telHref(j.guestPhone)}">${esc(j.guestPhone)}</a></dd>` : ''}
      ${j.noPayout ? '<dt>Выплата</dt><dd>не требуется — вся сумма бизнесу</dd>' : j.payoutKzt != null ? `<dt>Вам за поездку</dt><dd class="money">${money(j.payoutKzt)}${j.paid ? ' <span class="chip green">выплачено</span>' : ''}</dd>` : ''}</dl>
      ${j.sign && !open ? `<button class="btn block" data-sign="${esc(j.sign)}">🪧 Показать табличку «${esc(j.sign)}»</button>` : ''}</div>
    ${j.etaAt && j.status === 'EN_ROUTE' ? `<div class="sub">Вы указали, что будете около ${hm(j.etaAt)}</div>` : ''}
    <div class="steps">
      ${acts.includes('accept') ? '<button class="btn success block big" data-act="accept">✋ Беру</button>' : ''}
      ${step ? `<button class="btn ${NEXT[step][1]} block big" data-act="${step}">${NEXT[step][0]}</button>` : ''}
      ${acts.includes('time') ? '<button class="btn block" data-act="time">🕒 Рейс задерживается — изменить время</button>' : ''}
      ${acts.includes('release') ? '<button class="btn danger block" data-act="release">Не смогу поехать — отказаться</button>' : ''}
    </div>
    <div id="trForm"></div>`;
}

/** Кнопки карточки трансфера. base — /api/staff/transfers/<id> или /api/transfer-link/<token> */
export function bindTransfer(root, j, { base, onChange }) {
  root.onclick = guard(async (e) => {
    const sg = e.target.closest('[data-sign]');
    if (sg) { const d = document.createElement('div'); d.className = 'sign'; d.innerHTML = `<b>${esc(sg.dataset.sign)}</b><small>Нажмите, чтобы закрыть</small>`; d.onclick = () => d.remove(); document.body.append(d); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, form = $('#trForm', root);
    if (act === 'en-route') {
      form.innerHTML = `<div class="card"><label>Через сколько будете на месте?</label><div class="row">${[10, 20, 30, 45, 60].map(m => `<button class="btn sm" data-eta="${m}">${m} мин</button>`).join('')}</div></div>`;
      form.onclick = guard(async (ev) => { const x = ev.target.closest('[data-eta]'); if (!x) return; ev.stopPropagation(); await onChange(await api(`${base}/en-route`, { method: 'POST', body: { etaMinutes: +x.dataset.eta } }), 'Гостю сообщили, что вы выехали'); });
      return;
    }
    if (act === 'time') {
      form.innerHTML = `<div class="card"><label>Новое время подачи</label><input type="time" id="trT" value="${esc(j.time)}"><label>Комментарий</label><input id="trN" placeholder="Рейс задержан на 40 минут"><button class="btn primary block" id="trTS" style="margin-top:10px">Сохранить — хозяин получит уведомление</button></div>`;
      $('#trTS', form).onclick = guard(async (ev) => { ev.stopPropagation(); await onChange(await api(`${base}/time`, { method: 'POST', body: { time: $('#trT', form).value, note: $('#trN', form).value || undefined } }), 'Время изменено'); });
      return;
    }
    if (act === 'release') {
      const reason = prompt('Почему не сможете? (увидит хозяин/админ)'); if (reason === null) return;
      return onChange(await api(`${base}/release`, { method: 'POST', body: { reason: reason || undefined } }), 'Заказ снова предложен всем');
    }
    if (act === 'done' && !confirm('Завершить поездку?')) return;
    const msg = { accept: 'Заказ ваш ✅', arrived: 'Гостю сообщили, что вы на месте', 'picked-up': 'Хорошей дороги!', done: 'Поездка завершена' }[act];
    try { await onChange(await api(`${base}/${act}`, { method: 'POST', body: {} }), msg); }
    catch (err) {   // 409 — состояние уже изменилось (двойное нажатие, другая вкладка, другой водитель): показать причину и обновить карточку
      if (err.status === 409 && act === 'accept') { toast('Уже взял другой водитель', true); return onChange(null); }
      if (err.status === 409) { toast(err.message, true); return onChange(await api(base).catch(() => null)); }
      throw err;
    }
  });
}

// ---------------- заявки мастеру ----------------
export const WR_ST = { NEW: ['violet', 'Новая'], VISIT_INSPECTION: ['blue', 'Выезд / осмотр'], AWAITING_OWNER_APPROVAL: ['amber', 'Ждёт одобрения сметы'], REJECTED: ['red', 'Смета отклонена'],
  APPROVED: ['green', 'Смета одобрена — можно начинать'], IN_PROGRESS: ['blue', 'В работе'], DONE: ['green', 'Выполнена'], CANCELLED: ['', 'Отменена'] };
export const wrBadge = (s) => `<span class="chip ${(WR_ST[s] || [''])[0]}">${(WR_ST[s] || [0, s])[1]}</span>`;
const METHOD = { REMOTE: 'без выезда', PHOTOS: 'по фото', VISIT: 'после осмотра' };
const EST_ST = { pending: ['amber', 'ждёт решения'], approved: ['green', 'одобрена'], rejected: ['red', 'отклонена'] };
const X_ST = { PENDING: ['amber', 'ждёт решения'], APPROVED: ['green', 'одобрен'], REJECTED: ['red', 'отклонён'] };
const EV = { created: 'Заявка создана', occupancy_changed: 'Изменено «кто будет в квартире»', visit_requested: 'Запрошен выезд', arrived: 'Мастер приехал', inspected: 'Осмотр',
  estimate_submitted: 'Смета отправлена', approved: 'Смета одобрена', rejected: 'Смета отклонена', started: 'Работа начата', extra_submitted: 'Доп. расход', extra_approved: 'Доп. расход одобрен',
  extra_rejected: 'Доп. расход отклонён', completed: 'Работа завершена', cancelled: 'Отменена', paid: 'Оплачено мастеру', unpaid: 'Оплата отменена', declined: 'Мастер отказался', assigned: 'Назначен мастер' };

// что от мастера ждут в каждом статусе
export const WR_HINT = {
  NEW: 'Оцените работу и отправьте смету (или запросите выезд)', VISIT_INSPECTION: 'Осмотрите на месте и отправьте смету', AWAITING_OWNER_APPROVAL: 'Ждите решения по смете — придёт уведомление',
  REJECTED: 'Исправьте смету или откажитесь', APPROVED: 'Можно начинать — «Начать работу»', IN_PROGRESS: 'Закончите и нажмите «Завершить работу» (итог и фото «после»)', DONE: 'Работа засчитана — выплата в «Выплатах»',
};
export function repairCard(t) {
  const tone = (WR_ST[t.status] || [''])[0];
  return `<div class="card tap t-${tone}" data-wr="${t.id}"><div class="row between"><b>${esc(t.title)}</b>${wrBadge(t.status)}</div>
    <div class="sub">${esc(t.apartment?.title || '')}${t.date ? ` · ${fmtDay(t.date)}` : ''}${t.quickJob ? ' · простая работа' : ''}</div>
    ${WR_HINT[t.status] ? `<div class="hint">👉 ${WR_HINT[t.status]}</div>` : ''}</div>`;
}
const photosHtml = (list) => list?.length ? `<div class="photos">${list.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(p.caption || p.kind)}" loading="lazy"></a>`).join('')}</div>` : '';

export function repairDetail(t) {
  const acts = t.actions || [];
  const occ = t.occupancy || {};
  const est = (t.estimates || []).at(-1);
  const problem = (t.photos || []).filter(p => p.kind === 'problem');
  const btn = (a, label, cls = '') => acts.includes(a) ? `<button class="btn block ${cls}" data-wact="${a}">${label}</button>` : '';
  const small = (a, label) => acts.includes(a) ? `<button class="btn sm" data-wact="${a}" style="margin-top:6px">${label}</button>` : '';
  const times = t.startedAt || t.doneAt ? `<dt>Начало</dt><dd>${t.startedAt ? dt(t.startedAt) : '—'}</dd>${t.doneAt ? `<dt>Окончание</dt><dd>${dt(t.doneAt)}</dd>` : ''}` : '';
  const rejected = t.status === 'REJECTED';
  return `<div class="row between"><h2 style="font-size:19px">${esc(t.title)}</h2>${wrBadge(t.status)}</div>
    ${WR_HINT[t.status] && !['AWAITING_OWNER_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'DONE', 'REJECTED'].includes(t.status) ? `<div class="hint">👉 ${WR_HINT[t.status]}. Работа засчитывается после «Завершить работу».</div>` : ''}
    ${t.status === 'AWAITING_OWNER_APPROVAL' ? '<div class="alert amber">Смета отправлена. Начать работу можно после одобрения хозяина — придёт уведомление.</div>' : ''}
    ${t.status === 'APPROVED' ? '<div class="alert green">Смета одобрена — можно начинать работу.</div>' : ''}
    ${t.status === 'IN_PROGRESS' ? `<div class="alert blue">🔧 <b>В работе</b> с ${hm(t.startedAt)}. Когда закончите — нажмите «Завершить работу».</div>` : ''}
    ${t.status === 'DONE' ? `<div class="alert green">✅ Работа завершена ${dt(t.doneAt)}</div>` : ''}
    ${rejected ? `<div class="alert red"><b>Смета отклонена</b>${est?.rejectReason ? `: ${esc(est.rejectReason)}` : ''}<br>Исправьте смету или откажитесь от заявки.</div>
      <div class="steps">${btn('revise', '✏️ Исправить смету', 'primary big')}${btn('decline', '✋ Отказаться от заявки', 'danger')}${small('request-visit', 'Нужен выезд, чтобы оценить')}</div><div id="wrForm"></div>` : ''}
    <div class="card"><dl class="kv">${t.access ? `<dt>Адрес</dt><dd>${esc(t.access.address)}</dd>${t.access.apartmentNumber ? `<dt>Квартира</dt><dd><b>№ ${esc(t.access.apartmentNumber)}</b></dd>` : ''}` : ''}
      ${t.date ? `<dt>Когда</dt><dd>${fmtDay(t.date)}${t.timeWindow ? `, ${esc(t.timeWindow)}` : ''}</dd>` : ''}
      <dt>В квартире</dt><dd>${esc(occ.label || 'Пока неизвестно')}</dd>${occ.accessInstructions ? `<dt>Как попасть</dt><dd>${esc(occ.accessInstructions)}</dd>` : ''}
      ${t.arrivedAt ? `<dt>Приехал</dt><dd>${dt(t.arrivedAt)}</dd>` : ''}${times}</dl>
      ${t.description ? `<div style="white-space:pre-wrap">${esc(t.description)}</div>` : ''}${photosHtml(problem)}</div>
    ${est ? `<div class="card"><div class="row between"><b>Смета ${METHOD[est.method] || ''}</b><span class="chip ${EST_ST[est.status][0]}">${EST_ST[est.status][1]}</span></div>
      <div class="money">${money(est.totalKzt)}${est.maxKzt ? ` – ${money(est.maxKzt)}` : ''}</div><div class="sub">работа ${money(est.labourKzt)}${est.materialsIncluded ? ` · материалы ${money(est.materialsKzt)}` : ' · материалы отдельно'}</div>${est.items ? `<div class="small">${esc(est.items)}</div>` : ''}</div>` : ''}
    ${(t.extras || []).map(x => `<div class="card"><div class="row between"><b>Доп. расход ${money(x.amountKzt)}</b><span class="chip ${X_ST[x.status][0]}">${X_ST[x.status][1]}</span></div><div class="small">${esc(x.description)} — ${esc(x.reason)}</div>${x.decisionNote ? `<div class="sub">${esc(x.decisionNote)}</div>` : ''}</div>`).join('')}
    ${t.payableKzt != null ? `<div class="card"><dl class="kv"><dt>К оплате</dt><dd class="money">${money(t.payableKzt)}</dd></dl></div>` : ''}
    ${rejected ? '' : `<div class="steps">${btn('start', '▶️ Начать работу', 'primary big')}${btn('complete', '🏁 Завершить работу', 'primary big')}
      ${btn('estimate:REMOTE', '🧾 Смета без выезда')}${btn('estimate:PHOTOS', '📷 Смета по фото')}${btn('inspect', '🔎 Осмотр')}${btn('estimate:VISIT', '🧾 Смета после осмотра')}
      ${btn('extra', '➕ Доп. расход (не по моей вине)')}${small('arrive', '📍 Я приехал (по желанию)')} ${small('request-visit', 'Нужен выезд — не могу оценить без осмотра')}</div>
    <div id="wrForm"></div>`}
    ${(t.events || []).length ? `<details class="card"><summary><b>Журнал шагов</b> · ${t.events.length}</summary><ul class="log">${[...t.events].reverse().map(e => `<li><b>${EV[e.type] || e.type}</b>${e.actorName ? ` — ${esc(e.actorName)}` : ''}<div class="sub">${dt(e.createdAt)}${e.note ? ' · ' + esc(e.note) : ''}</div></li>`).join('')}</ul></details>` : ''}`;
}

const fileInput = (label = 'Фото') => `<label>${label}</label><input type="file" name="photos" accept="image/*" capture="environment" multiple>`;
async function uploadPhotos(base, form, kind) {
  const files = form.elements.photos?.files;
  if (!files || !files.length) return undefined;
  const fd = new FormData(); fd.append('kind', kind); for (const f of files) fd.append('photos', f);
  return (await api(`${base}/photos`, { method: 'POST', form: fd })).map(p => p.id);
}
const FORMS = {
  inspect: { title: 'Осмотр', html: () => `<label>Что увидели</label><textarea name="notes" required placeholder="Причина, что нужно сделать"></textarea>${fileInput('Фото осмотра')}`, kind: 'inspection',
    body: (f, ids) => ({ notes: f.notes.value, photoIds: ids }), ok: 'Осмотр сохранён' },
  'request-visit': { title: 'Нужен выезд', html: () => '<label>Почему нужен осмотр</label><textarea name="note" placeholder="По описанию не понять, нужно посмотреть на месте"></textarea>',
    body: (f) => ({ note: f.note.value || undefined }), ok: 'Запрос на выезд отправлен хозяину' },
  estimate: { title: 'Смета', html: (m) => `<input type="hidden" name="method" value="${m}"><div class="sub">Способ: ${METHOD[m]}</div>
      <label>Работа, ₸</label><input name="labourKzt" type="number" min="0" step="500" required inputmode="numeric">
      <label class="check"><input type="checkbox" name="materialsIncluded"> Материалы входят в смету</label>
      <div data-mat hidden><label>Материалы, ₸</label><input name="materialsKzt" type="number" min="0" step="500" inputmode="numeric"></div>
      <label>Верхняя граница «до», ₸ (если цена диапазоном)</label><input name="maxKzt" type="number" min="0" step="500" inputmode="numeric">
      <label>Что входит</label><textarea name="items" placeholder="Замена смесителя, герметик"></textarea><label>Комментарий</label><input name="comment">`,
    body: (f) => ({ method: f.method.value, labourKzt: +f.labourKzt.value, materialsIncluded: f.materialsIncluded.checked, materialsKzt: f.materialsIncluded.checked && f.materialsKzt.value ? +f.materialsKzt.value : null,
      maxKzt: f.maxKzt.value ? +f.maxKzt.value : null, items: f.items.value || undefined, comment: f.comment.value || undefined }), ok: 'Смета отправлена хозяину' },
  extra: { path: 'extras', title: 'Доп. расход', html: () => `<label>Сумма, ₸</label><input name="amountKzt" type="number" min="1" step="100" required inputmode="numeric"><label>Что нужно</label><input name="description" required placeholder="Заменить участок трубы">
      <label>Почему возник (не по вашей вине)</label><input name="reason" required placeholder="Труба сгнила за стеной">${fileInput('Фото / чек')}`, kind: 'receipt',
    body: (f, ids) => ({ amountKzt: +f.amountKzt.value, description: f.description.value, reason: f.reason.value, photoIds: ids }), ok: 'Доп. расход отправлен на решение' },
  decline: { title: 'Отказаться от заявки', html: () => '<div class="sub">Заявка вернётся владельцу — он выберет другого мастера.</div><label>Причина</label><textarea name="reason" required placeholder="Не смогу дешевле / нет времени"></textarea>',
    body: (f) => ({ reason: f.reason.value }), ok: 'Вы отказались от заявки' },
  complete: { title: 'Завершить работу', html: (m, t) => `<label>Итоговая цена работы, ₸</label><input name="finalCostKzt" type="number" min="0" step="500" required inputmode="numeric" value="${(t.estimates || []).filter(e => e.status === 'approved').at(-1)?.totalKzt ?? ''}">
      <label>Что сделано</label><textarea name="report" required placeholder="Заменил смеситель, проверил — не течёт"></textarea>${fileInput('Фото «после»')}`, kind: 'after',
    body: (f, ids) => ({ finalCostKzt: +f.finalCostKzt.value, report: f.report.value, photoIds: ids }), ok: 'Готово! Хозяин получил отчёт' },
};

/** Шаги мастера. base — /api/staff/repairs/<id> или /api/task-link/<token> */
export function bindRepair(root, t, { base, onChange }) {
  root.onclick = guard(async (e) => {
    const b = e.target.closest('[data-wact]'); if (!b) return;
    const [act, method] = b.dataset.wact.split(':');
    if (act === 'start') { if (!confirm('Начать работу? Время начала запишется.')) return; return onChange(await api(`${base}/start`, { method: 'POST', body: {} }), 'Работа начата — статус «В работе»'); }
    if (act === 'arrive') return onChange(await api(`${base}/arrive`, { method: 'POST', body: {} }), 'Отмечено: вы на месте');   // одно нажатие, без заметки и фото
    // «Исправить смету» — та же форма сметы, тем же способом, что и отклонённая
    const last = (t.estimates || []).at(-1);
    const F = act === 'revise' ? { ...FORMS.estimate, path: 'estimate', title: 'Исправить смету' } : FORMS[act];
    const m = act === 'revise' ? (last?.method || 'REMOTE') : method;
    const box = $('#wrForm', root);
    box.innerHTML = `<form class="card" novalidate><h3>${F.title}</h3>${F.html(m, t)}<button class="btn primary block" style="margin-top:12px">${act === 'decline' ? 'Отказаться' : act === 'complete' ? 'Завершить' : 'Отправить'}</button></form>`;
    if (act === 'revise' && last) { const f = $('form', box).elements; f.labourKzt.value = last.labourKzt; if (last.comment) f.comment.value = last.comment; if (last.items) f.items.value = last.items; }
    const form = $('form', box); form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (form.elements.materialsIncluded) form.elements.materialsIncluded.onchange = () => { $('[data-mat]', form).hidden = !form.elements.materialsIncluded.checked; };
    form.onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const bad = [...form.querySelectorAll('[required]')].find(x => !String(x.value).trim());
      if (bad) { bad.focus(); return toast('Заполните обязательные поля', true); }
      const btnS = form.querySelector('button'); btnS.disabled = true;
      try {
        const ids = F.kind ? await uploadPhotos(base, form, F.kind) : undefined;
        await onChange(await api(`${base}/${F.path || act}`, { method: 'POST', body: F.body(form.elements, ids) }), F.ok);
      } finally { btnS.disabled = false; }
    });
  });
}
