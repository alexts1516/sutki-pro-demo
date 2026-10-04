// Приложение команды (водитель, мастер, специалист по подготовке; владелец и админ — как водители). Только нужное в дороге:
// новые заказы с кнопкой «Беру», свои поездки по шагам, заявки мастеру по шагам, подготовка квартир с чек-листом, мои выплаты.
import { $, esc, api, toast, guard, sheet, closeSheet, fmtDay, hm, dt, money, transferCard, transferDetail, bindTransfer, repairCard, repairDetail, bindRepair, byDay, whenWord, hmTz, dayKey, plannedLabel, TR_HINT, WR_HINT } from '/shared/views.js';

const ROLE = { owner: 'Владелец', admin: 'Администратор', cleaning: 'Специалист по подготовке', master: 'Мастер', driver: 'Водитель' };
const CL = { assigned: ['', 'Запланирована'], enroute: ['blue', 'В пути'], progress: ['blue', 'Идёт подготовка'], done: ['green', 'Готово'] };
const S = { me: null, tab: null, tr: null, tasks: null, pay: null, timer: null };
const kv = (a) => (a?.code ? `кв. ${a.code}` : a?.title || '');
const isManager = () => ['owner', 'admin'].includes(S.me?.role);

function showLogin() { $('#app').hidden = true; $('#login').hidden = false; document.body.classList.add('nonav'); }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#lgErr'); err.hidden = true; $('#lgBtn').disabled = true;
  try { await api('/api/auth/login', { method: 'POST', body: { login: $('#lgLogin').value.trim(), password: $('#lgPass').value } }); await boot(); }
  catch (x) { err.textContent = x.message; err.hidden = false; } finally { $('#lgBtn').disabled = false; }
});
$('#logout').onclick = guard(async () => { await api('/api/auth/logout', { method: 'POST' }); clearInterval(S.timer); showLogin(); });

async function boot() {
  const me = await api('/api/auth/session');
  if (!me.authenticated) return showLogin();
  S.me = me; $('#login').hidden = true; $('#app').hidden = false; document.body.classList.remove('nonav');
  $('#who').textContent = me.user.name; $('#acc').textContent = `${ROLE[me.role] || me.role} · ${me.account.name}`;
  $('#adminLink').hidden = !isManager();
  await load();
  const tabs = tabList();
  S.tab = tabs.find(t => t[0] === location.hash.slice(1))?.[0] || tabs[0]?.[0] || 'transfers';
  render();
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (document.visibilityState === 'visible' && ($('#sheet')?.hidden ?? true)) load().then(render).catch(() => {}); }, 30000);
}
async function load() {
  const [tr, tasks, pay] = await Promise.all([api('/api/staff/transfers'), isManager() ? Promise.resolve({ cleaning: [], repairs: [] }) : api('/api/staff/tasks'), isManager() ? null : api('/api/staff/payouts')]);
  S.tr = tr; S.tasks = tasks; S.pay = pay;
}
function tabList() {
  const t = [];
  if (S.tr.eligible || S.tr.mine.length) t.push(['transfers', '🚗', 'Трансферы', S.tr.offers.length]);
  if (S.me.role === 'master' || S.tasks.repairs.length) t.push(['repairs', '🛠', 'Заявки', S.tasks.repairs.filter(r => ['NEW', 'APPROVED', 'REJECTED'].includes(r.status)).length]);
  if (S.me.role === 'cleaning' || S.tasks.cleaning.length) t.push(['cleaning', '✨', 'Подготовка', 0]);
  if (S.pay && (S.pay.items.length || !isManager())) t.push(['payouts', '💵', 'Выплаты', 0]);
  return t;
}
function render() {
  const tabs = tabList();
  $('#nav').innerHTML = tabs.length > 1 ? tabs.map(([k, i, l, n]) => `<button class="${S.tab === k ? 'active' : ''}" data-tab="${k}"><span>${i}</span>${l}${n ? `<b class="cnt">${n}</b>` : ''}</button>`).join('') : '';
  document.body.classList.toggle('nonav', tabs.length < 2);
  if (!tabs.length) return view(`<div class="empty">Пока для вас нет задач.<br>${isManager() ? 'Включите себе «Водит» в админке («Команда»), чтобы получать заказы на трансфер.' : 'Когда владелец назначит задачу, она появится здесь.'}</div>`);
  ({ transfers: renderTransfers, repairs: renderRepairs, cleaning: renderCleaning, payouts: renderPayouts })[S.tab]();
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; history.replaceState(null, '', '#' + S.tab); render(); window.scrollTo(0, 0); });
const view = (html) => { $('#view').innerHTML = html; };

// ---------- трансферы ----------
const NEXT_WORD = { ACCEPTED: '«Выехал»', EN_ROUTE: '«Я на месте»', ARRIVED: '«Гость в машине»', PICKED_UP: '«Завершить поездку»' };
const groups = (g, card) => [['past', 'Просрочено'], ['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['later', 'Позже']].filter(([k]) => g[k].length).map(([k, l]) => `<div class="day-h">${l}</div>${g[k].map(card).join('')}`).join('');
function renderTransfers() {
  const { offers, mine, taken, eligible } = S.tr;
  const at = (j) => j.pickupAt || `${j.date}T${j.time}:00+05:00`;
  const active = mine.filter(j => !['DONE'].includes(j.status)).sort((a, b) => new Date(at(a)) - new Date(at(b))), done = mine.filter(j => j.status === 'DONE');
  const now = active[0], urgent = offers.filter(j => j.status === 'UNASSIGNED');
  // «Сейчас»: что делать сейчас, что дальше, есть ли проблема
  const banner = now ? (now.planned
      ? `<div class="now calm"><small>Следующая поездка</small><b>${fmtDay(now.date)}, ${esc(now.time)} · ${esc(now.from)} → ${esc(now.to)}</b><span>${esc(plannedLabel(now))} · «Выехал» откроется ${whenWord(now.startOpensAt) === 'сегодня' ? '' : fmtDay(dayKey(now.startOpensAt)) + ' '}в ${hmTz(now.startOpensAt)}</span></div>`
      : `<div class="now" data-tr="${now.id}"><small>Сейчас</small><b>${esc(now.time)} · ${esc(now.from)} → ${esc(now.to)}</b><span>👉 ${esc(TR_HINT[now.status] || `Нажмите ${NEXT_WORD[now.status] || 'карточку'}`)}</span></div>`)
    : `<div class="now calm"><small>Сейчас</small><b>Поездок нет</b><span>${eligible ? 'Новые заказы — ниже; придёт уведомление в Telegram' : 'Новых заказов не будет'}</span></div>`;
  view(`${!eligible ? '<div class="alert amber">Вы больше не в списке водителей — новые заказы не приходят. Свои поездки доведите до конца.</div>' : ''}
    ${banner}${urgent.length ? `<div class="alert red">⚠️ Никто не взял: ${urgent.length} — если можете, возьмите</div>` : ''}
    ${active.length ? `<div class="h"><h2>Мои поездки</h2><span class="chip blue">${active.length}</span></div>${groups(byDay(active, at), transferCard)}` : ''}
    ${eligible ? `<div class="h"><h2>Новые заказы</h2>${offers.length ? `<span class="chip amber">${offers.length}</span>` : ''}</div>
      ${offers.length ? [...offers].sort((a, b) => new Date(at(a)) - new Date(at(b))).map(transferCard).join('') : '<div class="card empty">Новых заказов нет. Придёт уведомление в Telegram, когда появится.</div>'}` : ''}
    ${done.length ? `<details><summary class="h"><h2>Выполненные за сутки · ${done.length}</h2></summary>${done.map(transferCard).join('')}</details>` : ''}
    ${taken.length ? `<details><summary class="h"><h2>Взяли другие · ${taken.length}</h2></summary>${taken.map(transferCard).join('')}</details>` : ''}`);
  $('#view').onclick = guard(async (e) => {
    const acc = e.target.closest('[data-accept]');
    if (acc) {
      e.stopPropagation(); acc.disabled = true;
      try { await api(`/api/staff/transfers/${acc.dataset.accept}/accept`, { method: 'POST', body: {} }); toast('Заказ ваш ✅'); await load(); render(); return openTransfer(acc.dataset.accept); }
      catch (err) { toast(err.status === 409 ? 'Уже взял другой водитель' : err.message, true); await load(); return render(); }
    }
    const c = e.target.closest('[data-tr]'); if (c) openTransfer(c.dataset.tr);
  });
}
async function openTransfer(id) {
  const j = await api(`/api/staff/transfers/${id}`);
  const body = sheet(transferDetail(j));
  bindTransfer(body, j, {
    base: `/api/staff/transfers/${id}`,
    onChange: async (u, msg) => { if (msg) toast(msg); await load(); render(); if (u && u.status !== 'TAKEN' && u.mine !== false) openTransfer(id); else closeSheet(); },
  });
}

// ---------- заявки мастеру ----------
function renderRepairs() {
  const list = S.tasks.repairs;
  const need = list.filter(t => ['NEW', 'REJECTED', 'APPROVED', 'IN_PROGRESS', 'VISIT_INSPECTION'].includes(t.status)), wait = list.filter(t => t.status === 'AWAITING_OWNER_APPROVAL');
  const first = need[0];
  view(`${first ? `<div class="now" data-wr="${first.id}"><small>Сейчас</small><b>${esc(first.title)} · ${esc(first.apartment?.title || '')}</b><span>👉 ${esc(WR_HINT[first.status] || 'Откройте заявку')}</span></div>`
      : `<div class="now calm"><small>Сейчас</small><b>${wait.length ? 'Ждём решения по смете' : 'Заявок нет'}</b><span>${wait.length ? 'Придёт уведомление, когда владелец решит' : 'Новые заявки придут уведомлением'}</span></div>`}
    ${need.length ? `<div class="h"><h2>Нужно действие</h2></div>${need.map(repairCard).join('')}` : ''}
    ${wait.length ? `<div class="h"><h2>Ждут одобрения сметы</h2></div>${wait.map(repairCard).join('')}` : ''}
    ${!list.length ? '<div class="card empty">Активных заявок нет</div>' : ''}`);
  $('#view').onclick = (e) => { const c = e.target.closest('[data-wr]'); if (c) guard(openRepair)(c.dataset.wr); };
}
async function openRepair(id) {
  const t = await api(`/api/staff/repairs/${id}`);
  const body = sheet(repairDetail(t));
  bindRepair(body, t, { base: `/api/staff/repairs/${id}`, onChange: async (u, msg) => { toast(msg); await load(); render(); if (u?.declined) return closeSheet(); openRepair(id); } });
}

// ---------- подготовка квартир ----------
const dlText = (d) => d?.at ? `до ${whenWord(d.at) === 'сегодня' ? '' : fmtDay(dayKey(d.at)) + ' '}${hmTz(d.at)} — ${d.reason}` : '';
const clCard = (c) => `<div class="card tap t-${c.status === 'done' ? 'green' : c.canStart === false ? 'grey' : CL[c.status][0] || 'violet'}" data-cl="${c.id}"><div class="row between"><b>Подготовка ${esc(kv(c.apartment))}</b><span class="chip ${CL[c.status][0]}">${CL[c.status][1]}</span></div>
    <div class="sub">${esc(c.apartment.address || c.apartment.title)}</div>
    ${c.status !== 'done' ? `<div class="sub">⏰ ${esc(dlText(c.deadline) || `${c.fromTime}–${c.toTime}`)}</div>` : ''}
    ${c.status !== 'done' && c.canStart === false ? `<div class="sub">🔒 Начать можно ${fmtDay(c.day || c.date)}</div>` : ''}</div>`;
function renderCleaning() {
  const list = S.tasks.cleaning;
  const at = (c) => c.deadline?.at || `${String(c.date).slice(0, 10)}T12:00:00+05:00`;
  const todo = list.filter(c => c.status !== 'done'), done = list.filter(c => c.status === 'done');
  const now = [...todo].sort((a, b) => new Date(at(a)) - new Date(at(b)))[0];
  const banner = now ? `<div class="now${now.canStart === false ? ' calm' : ''}" data-cl="${now.id}"><small>${now.canStart === false ? 'Следующая подготовка' : 'Сейчас'}</small><b>Подготовка ${esc(kv(now.apartment))} · ${esc(now.apartment.address || now.apartment.title)}</b>
      <span>⏰ ${esc(dlText(now.deadline))}${now.canStart === false ? ` · начать можно ${fmtDay(now.day || now.date)}` : now.status === 'progress' ? ' · отметьте чек-лист и нажмите «Закончить»' : ' · нажмите «Начать подготовку»'}</span></div>`
    : '<div class="now calm"><small>Сейчас</small><b>Подготовок нет</b><span>Новая задача придёт уведомлением</span></div>';
  view(`${banner}${todo.length ? `<div class="h"><h2>Мои подготовки</h2><span class="chip blue">${todo.length}</span></div>${groups(byDay(todo, at), clCard)}` : ''}
    ${done.length ? `<details><summary class="h"><h2>Готово · ${done.length}</h2></summary>${done.map(clCard).join('')}</details>` : ''}
    ${!list.length ? '<div class="card empty">На ближайшие дни подготовки нет</div>' : ''}`);
  $('#view').onclick = (e) => { const c = e.target.closest('[data-cl]'); if (c) guard(openCleaning)(c.dataset.cl); };
}
const photoRow = (list) => list?.length ? `<div class="photos">${list.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="" loading="lazy"></a>`).join('')}</div>` : '';
async function uploadCl(id, files, extra) {
  const fd = new FormData(); for (const [k, v] of Object.entries(extra)) fd.append(k, v); for (const f of files) fd.append('photos', f);
  return api(`/api/staff/cleaning/${id}/photos`, { method: 'POST', form: fd });
}
async function openCleaning(id) {
  const c = await api(`/api/staff/cleaning/${id}`);
  const a = c.access || {};
  const base = `/api/staff/cleaning/${id}`;
  const refresh = async (msg) => { if (msg) toast(msg); await load(); render(); return openCleaning(id); };
  const items = c.checklist.map((x, i) => `<div class="cl-item ${x.done ? 'done' : ''}"><input type="checkbox" data-ck="${i}" ${x.done ? 'checked' : ''} ${c.status === 'done' ? 'disabled' : ''}>
      <div class="grow">${esc(x.label)}${x.photo ? ` <span class="cam">📷 фото обязательно</span>` : ''}${photoRow(x.photos)}</div>
      ${c.status === 'progress' ? `<label class="btn sm" style="margin:0">📷<input type="file" accept="image/*" capture="environment" data-ph="${i}" hidden></label>` : ''}</div>`).join('');
  const PR = { urgent: ['red', 'срочно'], later: ['', 'можно позже'] };
  const defect = (p) => `<div class="alert ${p.status !== 'open' ? 'green' : p.priority === 'urgent' ? 'red' : 'amber'}">⚠️ <span class="chip ${p.status !== 'open' ? 'green' : PR[p.priority]?.[0] || ''}">${p.status !== 'open' ? 'решено' : PR[p.priority]?.[1] || ''}</span> ${esc(p.text)}${photoRow(p.photos)}</div>`;
  const body = sheet(`<div class="row between"><h2 style="font-size:19px">Подготовка ${esc(kv(c.apartment))}</h2><span class="chip ${CL[c.status][0]}">${CL[c.status][1]}</span></div>
    <div class="sub">${esc(c.apartment.title)} · ${fmtDay(c.date)} · ${esc(c.fromTime)}–${esc(c.toTime)}</div>
    ${c.status !== 'done' ? `<div class="alert ${c.canStart ? 'blue' : ''}">⏰ <b>Срок: ${esc(dlText(c.deadline))}</b>${c.canStart ? '' : `<br>🔒 Начать можно ${fmtDay(c.date)} — раньше кнопка не работает`}</div>
      <div class="hint">✅ Готово = все пункты отмечены и обязательные фото 📷 сделаны. Не получилось — напишите почему. Что-то сломано или закончилось — «Сообщить о недочёте».</div>` : ''}
    ${(c.knownDefects || []).length ? `<details class="card"><summary><b>Уже известно в этой квартире</b> · ${c.knownDefects.length} — повторно сообщать не нужно</summary>${c.knownDefects.map(defect).join('')}</details>` : ''}
    ${c.startedAt ? `<div class="alert ${c.status === 'done' ? 'green' : 'blue'}">Начало ${hm(c.startedAt)}${c.doneAt ? ` · окончание ${hm(c.doneAt)}` : ' · идёт подготовка'}</div>` : ''}
    ${c.status !== 'done' ? `<div class="card"><dl class="kv">${Object.entries({ Адрес: a.address, Подъезд: a.entrance, Этаж: a.floor, Домофон: a.intercom, 'Код замка': a.lockCode, 'Сейф для ключей': a.keyboxCode, 'Wi‑Fi': a.wifiName && `${a.wifiName} / ${a.wifiPassword || ''}`, Заметка: a.accessNote }).filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : ''}
    ${c.checklist.length ? `<div class="card"><b>Чек-лист</b> · ${c.checklist.filter(x => x.done).length}/${c.checklist.length}${items}</div>` : ''}
    ${(c.problems || []).map(defect).join('')}
    ${c.status === 'done' ? `${c.report ? `<div class="card">💬 ${esc(c.report)}</div>` : ''}<div class="alert green">✅ Подготовка закончена — работа засчитана${c.finishNote ? ' (не всё отмечено — владелец проверит отчёт)' : ''}</div><button class="btn sm" data-go="problem">⚠️ Сообщить о недочёте</button>` : ''}
    <div class="steps">
      ${c.status === 'assigned' && c.canStart ? '<button class="btn block" data-go="enroute">🚶 Выхожу</button>' : ''}
      ${['assigned', 'enroute'].includes(c.status) ? (c.canStart ? '<button class="btn primary block big" data-go="start">▶️ Начать подготовку</button>' : `<button class="btn block big" disabled>🔒 Начать можно ${fmtDay(c.date)}</button>`) : ''}
      ${c.status === 'progress' ? `<button class="btn sm" data-go="problem">⚠️ Сообщить о недочёте</button>
        <label>Комментарий${c.missing.length ? ' — если что-то не сделано, напишите почему' : ''}</label><textarea id="clRep" placeholder="Что заметили, что закончилось"></textarea>
        <button class="btn success block big" data-go="finish" style="margin-top:10px">🏁 Закончить подготовку</button>` : ''}
    </div><div id="clForm"></div>`);
  body.onchange = guard(async (e) => {
    const ck = e.target.closest('[data-ck]');
    if (ck) { await api(`${base}/check`, { method: 'POST', body: { index: +ck.dataset.ck, done: ck.checked } }); return refresh(); }
    const ph = e.target.closest('[data-ph]');
    if (ph && ph.files.length) { await uploadCl(id, ph.files, { itemIndex: ph.dataset.ph }); return refresh('Фото добавлено'); }
  });
  body.onclick = guard(async (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const go = b.dataset.go;
    if (go === 'enroute') { await api(`${base}/status`, { method: 'POST', body: { status: 'enroute' } }); return refresh('Хорошей дороги'); }
    if (go === 'start') { await api(`${base}/start`, { method: 'POST', body: {} }); return refresh('Начали — время записано'); }
    if (go === 'finish') {
      try { await api(`${base}/finish`, { method: 'POST', body: { report: $('#clRep', body).value || undefined } }); }
      catch (err) { if (err.status === 409) { $('#clRep', body).focus(); return toast(err.message, true); } throw err; }
      return refresh('Готово! Владелец получил отчёт');
    }
    if (go === 'problem') {
      const box = $('#clForm', body);
      box.innerHTML = `<form class="card" novalidate><h3>Недочёт</h3><label>Что не так</label><textarea name="text" required placeholder="Мигает лампа в коридоре / закончились мусорные пакеты"></textarea>
        <label>Насколько срочно</label><label class="check"><input type="radio" name="priority" value="urgent"> 🔴 Срочно — мешает заезду гостя</label><label class="check"><input type="radio" name="priority" value="later" checked> Можно позже</label>
        <label>Фото</label><input type="file" name="photos" accept="image/*" capture="environment" multiple><button class="btn primary block" style="margin-top:12px">Отправить</button></form>`;
      const f = $('form', box); f.scrollIntoView({ behavior: 'smooth' });
      f.onsubmit = guard(async (ev) => {
        ev.preventDefault(); if (!f.text.value.trim()) return toast('Опишите проблему', true);
        const ids = f.photos.files.length ? (await uploadCl(id, f.photos.files, { kind: 'problem' })).map(p => p.id) : [];
        await api(`${base}/problem`, { method: 'POST', body: { text: f.text.value, photoIds: ids, priority: f.querySelector('[name=priority]:checked')?.value || 'later' } });
        return refresh('Отправлено — недочёт висит, пока его не решат');
      });
    }
  });
}

// ---------- мои выплаты ----------
function renderPayouts() {
  const p = S.pay || { items: [] };
  const pend = p.items.filter(x => x.status === 'PENDING'), paid = p.items.filter(x => x.status === 'PAID');
  const row = (x) => `<div class="card"><div class="row between"><b>${esc(x.title || x.kindLabel)}</b><span class="money">${money(x.amountKzt)}</span></div>
    <div class="sub">${x.status === 'PAID' ? `Выплачено ${dt(x.paidAt)}${x.methodLabel ? ` · ${x.methodLabel}` : ''}` : `К оплате с ${dt(x.createdAt)}`}</div></div>`;
  view(`<div class="card"><dl class="kv"><dt>К оплате</dt><dd class="money">${money(p.pendingKzt)}</dd><dt>Выплачено</dt><dd>${money(p.paidKzt)}</dd></dl></div>
    ${pend.length ? `<div class="h"><h2>К оплате</h2><span class="chip amber">${pend.length}</span></div>${pend.map(row).join('')}` : ''}
    ${paid.length ? `<div class="h"><h2>Выплачено</h2></div>${paid.map(row).join('')}` : ''}
    ${!p.items.length ? '<div class="card empty">Выплат пока нет. Они появятся сразу после завершения работы.</div>' : ''}`);
}

boot().catch(() => showLogin());
