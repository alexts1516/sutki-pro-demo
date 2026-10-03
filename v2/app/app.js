// Приложение команды (водитель, мастер, клининг; владелец и админ — как водители). Только нужное в дороге:
// новые заказы с кнопкой «Беру», свои поездки по шагам, заявки мастеру по шагам, уборки на сегодня.
import { $, esc, api, toast, guard, sheet, closeSheet, fmtDay, transferCard, transferDetail, bindTransfer, repairCard, repairDetail, bindRepair } from '../shared/views.js';

const ROLE = { owner: 'Владелец', admin: 'Администратор', cleaning: 'Клининг', master: 'Мастер', driver: 'Водитель' };
const CL = { assigned: ['', 'Запланирована'], enroute: ['blue', 'В пути'], progress: ['blue', 'Идёт уборка'], done: ['green', 'Готово'] };
const S = { me: null, tab: null, tr: null, tasks: null, timer: null };
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
  const [tr, tasks] = await Promise.all([api('/api/staff/transfers'), isManager() ? Promise.resolve({ cleaning: [], repairs: [] }) : api('/api/staff/tasks')]);
  S.tr = tr; S.tasks = tasks;
}
function tabList() {
  const t = [];
  if (S.tr.eligible || S.tr.mine.length) t.push(['transfers', '🚗', 'Трансферы', S.tr.offers.length]);
  if (S.me.role === 'master' || S.tasks.repairs.length) t.push(['repairs', '🛠', 'Заявки', S.tasks.repairs.filter(r => ['NEW', 'APPROVED', 'REJECTED'].includes(r.status)).length]);
  if (S.me.role === 'cleaning' || S.tasks.cleaning.length) t.push(['cleaning', '🧹', 'Уборки', 0]);
  return t;
}
function render() {
  const tabs = tabList();
  $('#nav').innerHTML = tabs.length > 1 ? tabs.map(([k, i, l, n]) => `<button class="${S.tab === k ? 'active' : ''}" data-tab="${k}"><span>${i}</span>${l}${n ? `<b class="cnt">${n}</b>` : ''}</button>`).join('') : '';
  document.body.classList.toggle('nonav', tabs.length < 2);
  if (!tabs.length) return view(`<div class="empty">Пока для вас нет задач.<br>${isManager() ? 'Включите себе «Водит» в админке («Команда»), чтобы получать заказы на трансфер.' : 'Когда владелец назначит задачу, она появится здесь.'}</div>`);
  ({ transfers: renderTransfers, repairs: renderRepairs, cleaning: renderCleaning })[S.tab]();
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; history.replaceState(null, '', '#' + S.tab); render(); window.scrollTo(0, 0); });
const view = (html) => { $('#view').innerHTML = html; };

// ---------- трансферы ----------
function renderTransfers() {
  const { offers, mine, taken, eligible } = S.tr;
  const active = mine.filter(j => !['DONE'].includes(j.status)), done = mine.filter(j => j.status === 'DONE');
  view(`${!eligible ? '<div class="alert amber">Вы больше не в списке водителей — новые заказы не приходят. Свои поездки доведите до конца.</div>' : ''}
    ${active.length ? `<div class="h"><h2>Мои поездки</h2><span class="chip blue">${active.length}</span></div>${active.map(transferCard).join('')}` : ''}
    ${eligible ? `<div class="h"><h2>Новые заказы</h2>${offers.length ? `<span class="chip amber">${offers.length}</span>` : ''}</div>
      ${offers.length ? offers.map(transferCard).join('') : '<div class="card empty">Новых заказов нет. Придёт уведомление в Telegram, когда появится.</div>'}` : ''}
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
  view(`${need.length ? `<div class="h"><h2>Нужно действие</h2></div>${need.map(repairCard).join('')}` : ''}
    ${wait.length ? `<div class="h"><h2>Ждут одобрения сметы</h2></div>${wait.map(repairCard).join('')}` : ''}
    ${!list.length ? '<div class="card empty">Активных заявок нет</div>' : ''}`);
  $('#view').onclick = (e) => { const c = e.target.closest('[data-wr]'); if (c) guard(openRepair)(c.dataset.wr); };
}
async function openRepair(id) {
  const t = await api(`/api/staff/repairs/${id}`);
  const body = sheet(repairDetail(t));
  bindRepair(body, t, { base: `/api/staff/repairs/${id}`, onChange: async (u, msg) => { toast(msg); await load(); render(); openRepair(id); } });
}

// ---------- уборки ----------
function renderCleaning() {
  const list = S.tasks.cleaning;
  view(list.length ? `<div class="h"><h2>Уборки</h2></div>${list.map(c => `<div class="card tap t-${CL[c.status][0] || 'violet'}" data-cl="${c.id}"><div class="row between"><b>${esc(c.apartment.title)}</b><span class="chip ${CL[c.status][0]}">${CL[c.status][1]}</span></div>
    <div class="sub">${fmtDay(c.date)} · ${esc(c.fromTime)}–${esc(c.toTime)}</div></div>`).join('')}` : '<div class="card empty">Уборок на ближайшие дни нет</div>');
  $('#view').onclick = (e) => { const c = e.target.closest('[data-cl]'); if (c) guard(openCleaning)(c.dataset.cl); };
}
async function openCleaning(id) {
  const c = await api(`/api/staff/cleaning/${id}`);
  const a = c.access || {};
  const next = { assigned: ['enroute', '🚶 Выхожу'], enroute: ['progress', '🧹 Начала уборку'], progress: ['done', '✅ Готово'] }[c.status];
  const body = sheet(`<div class="row between"><h2 style="font-size:19px">${esc(c.apartment.title)}</h2><span class="chip ${CL[c.status][0]}">${CL[c.status][1]}</span></div>
    <div class="sub">${fmtDay(c.date)} · ${esc(c.fromTime)}–${esc(c.toTime)}</div>
    <div class="card"><dl class="kv">${Object.entries({ Адрес: a.address, Подъезд: a.entrance, Этаж: a.floor, Домофон: a.intercom, 'Код замка': a.lockCode, 'Сейф для ключей': a.keyboxCode, 'Wi‑Fi': a.wifiName && `${a.wifiName} / ${a.wifiPassword || ''}`, Заметка: a.accessNote }).filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    ${next ? `${next[0] === 'done' ? '<label>Отчёт (что заметили, что закончилось)</label><textarea id="clRep"></textarea>' : ''}<button class="btn ${next[0] === 'done' ? 'success' : 'primary'} block big" id="clNext" style="margin-top:10px">${next[1]}</button>` : '<div class="alert green">Уборка завершена</div>'}`);
  if (next) $('#clNext', body).onclick = guard(async () => { await api(`/api/staff/cleaning/${id}/status`, { method: 'POST', body: { status: next[0], report: $('#clRep', body)?.value || undefined } }); toast('Сохранено'); await load(); render(); openCleaning(id); });
}

boot().catch(() => showLogin());
