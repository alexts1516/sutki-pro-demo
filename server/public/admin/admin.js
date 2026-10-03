// Админка владельца: календарь (брони, уборки, заявки мастерам, трансферы), брони, трансферы «как в Uber», заявки мастерам, квартиры и фото, тексты, бренд, команда, уведомления.
// Обычный JavaScript без сборки. Все данные — через REST API сервера (/api/admin/...).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₸';
const fmtDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][m - 1]}`; };
const ROLE = { owner: 'Владелец', admin: 'Администратор', cleaning: 'Клининг', master: 'Мастер', driver: 'Водитель' };
const SRC = { site: 'Сайт', airbnb: 'Airbnb', booking: 'Booking', telegram: 'Telegram', whatsapp: 'WhatsApp', direct: 'Напрямую' };
const S = { me: null, view: 'calendar', apt: null, txLang: 'ru', texts: null, brand: null, drag: null };

async function api(path, opts = {}) {
  const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
  const res = await fetch(path, o);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && !path.startsWith('/api/auth/login')) { showLogin(); throw new Error(data?.error || 'Нужно войти'); }
  if (!res.ok) { const e = new Error(data?.details?.map(d => `${d.field}: ${d.message}`).join('; ') || data?.error || `Ошибка ${res.status}`); e.status = res.status; throw e; }
  return data;
}
function toast(msg, err) {
  // одинаковые сообщения подряд не копятся (например, «Подпись сохранена» при правке нескольких фото), максимум 3 на экране
  const box = $('#toasts'); const last = box.lastElementChild;
  if (last && last.textContent === msg && last.classList.contains('err') === !!err) { clearTimeout(last._t); last._t = setTimeout(() => last.remove(), err ? 5000 : 2600); return; }
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  t._t = setTimeout(() => t.remove(), err ? 5000 : 2600);
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Ссылка скопирована'); } catch { prompt('Скопируйте ссылку:', t); } }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------------- вход ----------------
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#lgLogin').focus(); }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#lgErr').hidden = true; $('#lgBtn').disabled = true;
  try {
    const me = await api('/api/auth/login', { method: 'POST', body: { login: $('#lgLogin').value, password: $('#lgPass').value } });
    if (!['owner', 'admin'].includes(me.role)) { await api('/api/auth/logout', { method: 'POST' }); throw new Error('Админка доступна владельцу и администратору. Сотрудникам — приложение команды.'); }
    start(me);
  } catch (err) { $('#lgErr').textContent = err.message; $('#lgErr').hidden = false; } finally { $('#lgBtn').disabled = false; }
});
$('#logoutBtn').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.hash = ''; showLogin(); });
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

const VIEWS = [['calendar', '🗓', 'Календарь'], ['bookings', '📅', 'Брони и заявки'], ['transfers', '🚗', 'Трансферы'], ['repairs', '🛠', 'Заявки мастерам'], ['apartments', '🏠', 'Квартиры и фото'], ['texts', '✏️', 'Тексты сайта'], ['brand', '🎨', 'Бренд и логотип'], ['team', '👥', 'Команда и Telegram'], ['finance', '💰', 'Финансы', 'owner'], ['notifications', '🔔', 'Уведомления'], ['settings', '⚙️', 'Настройки']];
const myViews = () => VIEWS.filter(v => !v[3] || v[3] === S.me?.role);
function start(me) {
  S.me = me; $('#login').hidden = true; $('#app').hidden = false;
  $('#accName').textContent = me.account.name;
  $('#userBox').innerHTML = `<b>${esc(me.user.name)}</b>${esc(ROLE[me.role])}`;
  const [v, id] = location.hash.slice(1).split('/');
  go(myViews().some(x => x[0] === v) ? v : 'calendar', id);
}
function renderNav() {
  $('#nav').innerHTML = myViews().map(([k, i, l]) => `<button class="${S.view === k ? 'active' : ''}" data-nav="${k}"><span>${i}</span>${l}${k === 'bookings' && S.reqCount ? `<span class="cnt">${S.reqCount}</span>` : ''}${k === 'repairs' && S.wrCount ? `<span class="cnt">${S.wrCount}</span>` : ''}${k === 'transfers' && S.trCount ? `<span class="cnt">${S.trCount}</span>` : ''}</button>`).join('');
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) go(b.dataset.nav); });
function go(view, id) {
  S.view = view; renderNav(); $('#sidebar').classList.remove('open'); closeDrawer();
  $('#crumb').textContent = VIEWS.find(v => v[0] === view)[2];
  history.replaceState(null, '', '#' + view + (id ? '/' + id : ''));
  window.scrollTo(0, 0);
  guard(async () => {
    if (view === 'apartments') return id ? openApartment(id) : renderApartments();
    if (view === 'repairs') return id ? (id === 'new' ? newRepair() : openRepair(id)) : renderRepairs();
    if (view === 'transfers') return renderTransfers(id);
    return ({ calendar: renderCalendar, bookings: renderBookings, texts: renderTexts, brand: renderBrand, team: renderTeam, notifications: renderNotifications, settings: renderSettings, finance: renderFinance })[view]();
  })();
}
const view = (html) => { $('#view').innerHTML = html; };
window.addEventListener('hashchange', () => { if (!S.me) return; const [v, id] = location.hash.slice(1).split('/'); if (myViews().some(x => x[0] === v)) go(v, id); });

// ---------------- квартиры ----------------
async function renderApartments() {
  const list = await api('/api/admin/apartments');
  view(`<div class="page-head"><div><h1>Квартиры</h1><p class="sub">${list.length} объектов · фото без ограничений, у каждого — подпись и порядок</p></div>
    <button class="btn primary" id="aptNew">+ Добавить квартиру</button></div>
    <div class="apt-list">${list.map(a => { const c = a.photos[0]; return `<button class="card apt-card" data-apt="${a.id}">
      <div class="ph" style="${c ? `background-image:url('${esc(c.url)}')` : ''}">${a.photos.length ? `<span class="n">📷 ${a.photos.length}</span>` : '<span class="n">нет фото</span>'}</div>
      <div class="bd"><b>${esc(a.title)}</b><div class="muted">${esc(a.district)} · ${esc(a.rooms)} · до ${a.maxGuests} гост.</div><div style="margin-top:6px;font-weight:600">${money(a.basePriceKzt)} <span class="muted" style="font-weight:400">/ ночь</span>${a.active ? '' : ' <span class="chip">скрыта</span>'}</div></div></button>`; }).join('')}</div>`);
  $('#aptNew').onclick = () => go('apartments', 'new');
  $('#view').onclick = (e) => { const c = e.target.closest('[data-apt]'); if (c) go('apartments', c.dataset.apt); };
}

const FIELDS = [
  ['Основное', [['title', 'Название (как видят гости)', 'text', 'ЖК Хайвил, кв. 45'], ['titleEn', 'Название по-английски', 'text', 'Highvill residence, apt 45'], ['code', 'Номер квартиры (видит мастер)', 'text', '45'], ['complex', 'Жилой комплекс', 'text'],
    ['address', 'Адрес (видит мастер)', 'text', 'пр. Кошкарбаева, 10/1, блок G-1, кв. 45'], ['district', 'Район', 'select', ['Сарайшык', 'Есиль', 'Алматинский', 'Сарыарка', 'Байконур', 'Нура']], ['rooms', 'Комнат', 'select', ['Студия', '1-комн.', '2-комн.', '3-комн.']],
    ['maxGuests', 'Максимум гостей', 'number'], ['areaM2', 'Площадь, м²', 'number'], ['description', 'Описание', 'textarea'], ['descriptionEn', 'Описание по-английски', 'textarea']]],
  ['Цена и правила', [['basePriceKzt', 'Цена за ночь, ₸', 'number'], ['petsAllowed', 'Можно с животными', 'checkbox'], ['petFeeKzt', 'Доплата за животное, ₸', 'number'], ['petNote', 'Условия для животных', 'text', 'до 10 кг, не больше 2'], ['active', 'Показывать на сайте', 'checkbox']]],
  ['Доступ в квартиру (гости видят только в день заезда; мастерам не показывается)', [['entrance', 'Подъезд', 'text'], ['floor', 'Этаж', 'number'], ['intercom', 'Домофон', 'text'], ['lockCode', 'Код замка', 'text'], ['keyboxCode', 'Код ключницы', 'text'], ['wifiName', 'Wi‑Fi сеть', 'text'], ['wifiPassword', 'Wi‑Fi пароль', 'text'], ['accessNote', 'Как пройти, заметки', 'textarea']]],
];
function fieldHtml([k, label, type, extra], a) {
  const v = a[k] ?? '';
  if (type === 'checkbox') return `<label class="chk"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}> ${label}</label>`;
  if (type === 'textarea') return `<label style="grid-column:1/-1">${label}<textarea name="${k}" rows="3">${esc(v)}</textarea></label>`;
  if (type === 'select') { const opts = extra.includes(v) || !v ? extra : [v, ...extra]; return `<label>${label}<select name="${k}">${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`; }
  return `<label>${label}<input name="${k}" type="${type}" value="${esc(v)}" ${extra ? `placeholder="${esc(extra)}"` : ''}></label>`;
}
async function openApartment(id) {
  const isNew = id === 'new';
  const a = isNew ? { title: '', address: '', district: 'Сарайшык', rooms: '1-комн.', maxGuests: 2, basePriceKzt: 20000, active: true, photos: [] } : await api('/api/admin/apartments/' + id);
  S.apt = a;
  view(`<div class="page-head"><div><button class="btn sm" id="back">← Все квартиры</button><h1 style="margin-top:10px">${isNew ? 'Новая квартира' : esc(a.title)}</h1>
      <p class="sub">${isNew ? 'Сначала сохраните основные данные — потом можно добавить фото' : esc(a.address)}</p></div>
      <div class="row">${!isNew && S.me.role === 'owner' ? '<button class="btn danger" id="aptDel">Удалить</button>' : ''}<button class="btn primary" id="aptSave">${isNew ? 'Создать квартиру' : 'Сохранить'}</button></div></div>
    <div class="stack">
      ${isNew ? '' : `<div class="card" id="photosCard"><div class="card-h"><div><h2>Фотографии <span class="muted" id="phCount"></span></h2><div class="muted small">Перетаскивайте карточки или используйте стрелки. ★ — обложка в каталоге. Подпись видна гостю под фото.</div></div>
        <label class="btn primary" style="flex-direction:row;cursor:pointer">+ Загрузить фото<input type="file" id="phFile" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden></label></div>
        <div class="card-b"><div class="dropzone" id="drop"><b>Перетащите фото сюда</b> или нажмите «Загрузить фото» · JPG, PNG, WebP · можно сразу много</div><div class="photos" id="photos"></div></div></div>`}
      <form class="card" id="aptForm" novalidate>${FIELDS.map(([g, fs]) => `<div class="card-h"><h2>${g}</h2></div><div class="card-b grid g3">${fs.map(f => fieldHtml(f, a)).join('')}</div>`).join('')}</form>
    </div>`);
  $('#back').onclick = () => go('apartments');
  $('#aptSave').onclick = guard(saveApartment);
  if ($('#aptDel')) $('#aptDel').onclick = guard(async () => { if (!confirm('Удалить квартиру вместе с фото?')) return; await api('/api/admin/apartments/' + a.id, { method: 'DELETE' }); toast('Квартира удалена'); go('apartments'); });
  if (!isNew) { renderPhotos(); bindPhotos(); }
}
async function saveApartment() {
  const f = $('#aptForm'); const data = {};
  for (const [, fs] of FIELDS) for (const [k, , type] of fs) {
    const el = f.elements[k]; if (!el) continue;
    if (type === 'checkbox') data[k] = el.checked;
    else if (type === 'number') data[k] = el.value === '' ? null : Number(el.value);
    else data[k] = el.value.trim() || null;
  }
  for (const k of ['maxGuests', 'basePriceKzt']) if (data[k] == null) data[k] = 0;
  if (data.petFeeKzt == null) data.petFeeKzt = 0;
  const isNew = !S.apt.id;
  const a = await api('/api/admin/apartments' + (isNew ? '' : '/' + S.apt.id), { method: isNew ? 'POST' : 'PATCH', body: data });
  toast(isNew ? 'Квартира создана — добавьте фото' : 'Сохранено');
  if (isNew) go('apartments', a.id); else { S.apt = a; $('h1').textContent = a.title; }
}

const CAP_SUGGEST = ['Вид', 'Гостиная', 'Спальня', 'Кухня', 'Ванная', 'Прихожая', 'Балкон', 'Двор'];
function renderPhotos() {
  const ph = S.apt.photos; $('#phCount').textContent = ph.length ? `· ${ph.length}` : '';
  $('#photos').innerHTML = ph.length ? ph.map((p, i) => `<div class="photo" draggable="true" data-id="${p.id}">
      <div class="img" style="background-image:url('${esc(p.url)}')"><span class="num">${i + 1}</span>${p.isCover ? '<span class="cover">★ Обложка</span>' : ''}</div>
      <div class="pb"><input data-cap="${p.id}" value="${esc(p.caption)}" placeholder="Подпись: ${CAP_SUGGEST[i % CAP_SUGGEST.length]}" list="capList" aria-label="Подпись к фото ${i + 1}">
        <input data-cap-en="${p.id}" value="${esc(p.captionEn)}" placeholder="Caption (EN)" aria-label="Подпись по-английски">
        <div class="tools"><button class="icon-btn" data-mv="-1" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} title="Левее">←</button><button class="icon-btn" data-mv="1" data-id="${p.id}" ${i === ph.length - 1 ? 'disabled' : ''} title="Правее">→</button>
          <button class="icon-btn ${p.isCover ? 'on' : ''}" data-cover="${p.id}" title="Сделать обложкой">★</button><span class="sp"></span><button class="icon-btn" data-del="${p.id}" title="Удалить фото">🗑</button></div></div></div>`).join('')
    + `<datalist id="capList">${CAP_SUGGEST.map(c => `<option value="${c}">`).join('')}</datalist>` : '<div class="empty" style="grid-column:1/-1">Фото пока нет</div>';
}
async function uploadFiles(files) {
  files = [...files].filter(f => f.type.startsWith('image/')); if (!files.length) return;
  const fd = new FormData(); const start = S.apt.photos.length;
  files.forEach((f, i) => { fd.append('photos', f); fd.append('captions', S.apt.photos.length || i ? '' : 'Вид'); });
  toast(`Загружаем ${files.length} фото…`);
  const added = await api(`/api/admin/apartments/${S.apt.id}/photos`, { method: 'POST', body: fd });
  S.apt.photos.push(...added); renderPhotos(); toast(`Добавлено фото: ${added.length}. Подпишите их — гостям так понятнее`);
  const first = document.querySelector(`[data-cap="${S.apt.photos[start]?.id}"]`); first?.focus();
}
async function saveOrder(ids) { S.apt.photos = await api(`/api/admin/apartments/${S.apt.id}/photos/order`, { method: 'PUT', body: { ids } }); renderPhotos(); }
function bindPhotos() {
  $('#phFile').onchange = guard(async (e) => { await uploadFiles(e.target.files); e.target.value = ''; });
  const dz = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { if (S.drag) return; e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', (e) => { if (S.drag) return; e.preventDefault(); guard(uploadFiles)(e.dataTransfer.files); });
  const box = $('#photos');
  box.addEventListener('click', guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mv) { const ids = S.apt.photos.map(p => p.id); const i = ids.indexOf(b.dataset.id), j = i + Number(b.dataset.mv); [ids[i], ids[j]] = [ids[j], ids[i]]; await saveOrder(ids); }
    else if (b.dataset.cover) { S.apt.photos = await api(`/api/admin/photos/${b.dataset.cover}/cover`, { method: 'POST' }); renderPhotos(); toast('Обложка обновлена'); }
    else if (b.dataset.del) { if (!confirm('Удалить это фото?')) return; await api(`/api/admin/photos/${b.dataset.del}`, { method: 'DELETE' }); S.apt = await api('/api/admin/apartments/' + S.apt.id); renderPhotos(); toast('Фото удалено'); }
  }));
  box.addEventListener('change', guard(async (e) => {
    const id = e.target.dataset.cap || e.target.dataset.capEn; if (!id) return;
    const body = e.target.dataset.cap ? { caption: e.target.value.trim() } : { captionEn: e.target.value.trim() };
    const p = await api(`/api/admin/photos/${id}`, { method: 'PATCH', body }); Object.assign(S.apt.photos.find(x => x.id === id), p); toast('Подпись сохранена');
  }));
  // перетаскивание карточек
  box.addEventListener('dragstart', (e) => { const c = e.target.closest('.photo'); if (!c) return; S.drag = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.id); });
  box.addEventListener('dragend', () => { S.drag = null; box.querySelectorAll('.photo').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
  box.addEventListener('dragover', (e) => {
    const c = e.target.closest('.photo'); if (!S.drag || !c) return; e.preventDefault();
    box.querySelectorAll('.photo').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    const r = c.getBoundingClientRect(); c.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
  });
  box.addEventListener('drop', guard(async (e) => {
    const c = e.target.closest('.photo'); if (!S.drag || !c) return; e.preventDefault();
    const before = c.classList.contains('drop-before'); const ids = S.apt.photos.map(p => p.id).filter(x => x !== S.drag);
    let at = ids.indexOf(c.dataset.id); if (at < 0) at = ids.length; else if (!before) at++;
    ids.splice(at, 0, S.drag); S.drag = null; await saveOrder(ids); toast('Порядок фото сохранён');
  }));
}

// ---------------- тексты сайта ----------------
async function renderTexts() {
  S.texts = await api('/api/admin/site-texts'); drawTexts();
}
function drawTexts() {
  const T = S.texts, L = S.txLang; const groups = [...new Set(T.keys.map(k => k.group))];
  view(`<div class="page-head"><div><h1>Тексты сайта</h1><p class="sub">Кнопки, меню и заголовки сайта для гостей. Пустое поле — стандартный текст.</p></div>
      <div class="tabs">${T.langs.map(l => `<button class="${l === L ? 'active' : ''}" data-lang="${l}">${l === 'ru' ? 'Русский' : 'English'}</button>`).join('')}</div></div>
    <form class="card card-b" id="txForm">${groups.map(g => `<div class="tx-group"><h3>${esc(g)}</h3>${T.keys.filter(k => k.group === g).map(k => {
      const custom = T.custom[L][k.key]; const def = k.defaults[L];
      return `<div class="tx-row ${custom ? 'changed' : ''}" data-key="${k.key}"><div class="k"><b>${esc(def.length > 32 ? def.slice(0, 32) + '…' : def)}</b><span>${esc(k.hint)}</span> <code>${k.key}</code></div>
        ${def.length > 60 ? `<textarea name="${k.key}" rows="3" placeholder="${esc(def)}">${esc(custom || '')}</textarea>` : `<input name="${k.key}" value="${esc(custom || '')}" placeholder="${esc(def)}">`}
        <button type="button" class="btn sm" data-reset="${k.key}" ${custom ? '' : 'disabled'}>Сбросить</button></div>`; }).join('')}</div>`).join('')}
      <div class="sticky-bar"><span class="muted small grow" id="txInfo">${Object.keys(T.custom[L]).length} изменено из ${T.keys.length}</span><button class="btn primary" id="txSave">Сохранить тексты</button></div></form>`);
  $('#view').querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-lang]'); if (b) { S.txLang = b.dataset.lang; drawTexts(); } };
  $('#txForm').onclick = (e) => { const b = e.target.closest('[data-reset]'); if (b) { const el = $('#txForm').elements[b.dataset.reset]; el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } };
  $('#txForm').oninput = (e) => { const row = e.target.closest('.tx-row'); if (row) row.querySelector('[data-reset]').disabled = !e.target.value; };
  $('#txForm').onsubmit = guard(async (e) => {
    e.preventDefault(); const values = {};
    for (const k of S.texts.keys) values[k.key] = $('#txForm').elements[k.key].value;
    const r = await api('/api/admin/site-texts', { method: 'PUT', body: { lang: S.txLang, values } });
    S.texts.texts = r.texts; S.texts.custom = r.custom; drawTexts(); toast('Тексты сохранены — сайт покажет их сразу');
  });
}

// ---------------- бренд ----------------
const HOUSE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/></svg>';
async function renderBrand() {
  S.brand = await api('/api/admin/brand'); const B = S.brand; const C = B.colors;
  const CL = [['brand', 'Основной', 'шапка, кнопки'], ['brand2', 'Основной светлее', 'градиенты'], ['accent', 'Акцент', 'золотые кнопки, звёзды'], ['accent2', 'Акцент темнее', 'наведение']];
  view(`<div class="page-head"><div><h1>Бренд и логотип</h1><p class="sub">Название, логотип, цвета и контакты сайта для гостей</p></div><button class="btn primary" id="brSave">Сохранить</button></div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Как это выглядит на сайте</h2></div><div class="card-b"><div class="preview" id="pv"></div></div></div>
      <div class="card"><div class="card-h"><h2>Логотип</h2></div><div class="card-b logo-box">
        <div class="logo-thumb" id="logoThumb"></div>
        <div class="stack" style="gap:8px"><div class="muted small">PNG или SVG-экспорт в PNG, квадратный, от 256×256, лучше с прозрачным фоном. Без логотипа показывается домик.</div>
          <div class="row"><label class="btn primary" style="flex-direction:row;cursor:pointer">Загрузить логотип<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" hidden></label>
          <button class="btn" id="logoDel" ${B.logoUrl ? '' : 'disabled'}>Убрать логотип</button></div></div></div></div>
      <form class="card" id="brForm" novalidate><div class="card-h"><h2>Название и слоган</h2></div><div class="card-b grid g4">
        <label>Название<input name="name" value="${esc(B.name)}"></label><label>Инициалы (значок)<input name="short" maxlength="4" value="${esc(B.short)}"></label>
        <label>Слоган (RU)<input name="taglineRu" value="${esc(B.tagline.ru)}"></label><label>Слоган (EN)<input name="taglineEn" value="${esc(B.tagline.en)}"></label></div>
        <div class="card-h"><h2>Цвета</h2></div><div class="card-b colors">${CL.map(([k, n, h]) => `<label class="color"><input type="color" name="c_${k}" value="${esc(C[k])}"><div><b>${n}</b><span class="muted" data-hex="${k}">${esc(C[k])}</span> · ${h}</div></label>`).join('')}</div>
        <div class="card-h"><h2>Контакты</h2></div><div class="card-b grid g4">
        <label>Телефон<input name="phone" value="${esc(B.contacts.phone || '')}"></label><label>Telegram (без @)<input name="telegram" value="${esc(B.contacts.telegram || '')}"></label>
        <label>WhatsApp (цифры)<input name="whatsapp" value="${esc(B.contacts.whatsapp || '')}"></label><label>Email<input name="email" value="${esc(B.contacts.email || '')}"></label></div></form>
    </div>`);
  const draw = () => {
    const f = $('#brForm').elements; const c = { brand: f.c_brand.value, brand2: f.c_brand2.value, accent: f.c_accent.value, accent2: f.c_accent2.value };
    Object.entries(c).forEach(([k, v]) => { $(`[data-hex="${k}"]`).textContent = v; });
    const logo = S.brand.logoUrl ? `<img src="${esc(S.brand.logoUrl)}" alt="Логотип">` : HOUSE;
    $('#logoThumb').innerHTML = S.brand.logoUrl ? `<img src="${esc(S.brand.logoUrl)}" alt="Логотип">` : `<div class="pv-logo" style="background:linear-gradient(135deg,${c.brand},${c.brand2});color:${c.accent}">${HOUSE}</div>`;
    $('#pv').innerHTML = `<div class="pv-head"><div class="pv-logo" style="background:linear-gradient(135deg,${c.brand},${c.brand2});color:${c.accent}">${logo}</div>
      <div class="pv-name"><b>${esc(f.name.value)}</b><small>${esc(f.taglineRu.value)}</small></div>
      <div class="pv-nav"><span>Квартиры</span><span>Карта</span><span>Трансфер</span><span class="pv-btn" style="background:${c.brand}">Забронировать</span></div></div>
      <div class="pv-hero" style="background:linear-gradient(135deg,${c.brand},${c.brand2})"><h3>Самая высокая башня ЖК Хайвил — ближайшая к посольству США</h3><p>Так будет выглядеть главный экран с вашими цветами</p><span class="pv-gold" style="background:${c.accent}">Найти квартиру</span></div>`;
  };
  draw(); $('#brForm').oninput = draw;
  $('#brSave').onclick = guard(async () => {
    const f = $('#brForm').elements;
    S.brand = await api('/api/admin/brand', { method: 'PATCH', body: { name: f.name.value.trim(), short: f.short.value.trim(), taglineRu: f.taglineRu.value.trim(), taglineEn: f.taglineEn.value.trim(),
      colors: { brand: f.c_brand.value, brand2: f.c_brand2.value, accent: f.c_accent.value, accent2: f.c_accent2.value },
      phone: f.phone.value.trim() || null, telegram: f.telegram.value.trim().replace(/^@/, '') || null, whatsapp: f.whatsapp.value.trim() || null, email: f.email.value.trim() || null } });
    toast('Бренд сохранён');
  });
  $('#logoFile').onchange = guard(async (e) => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append('logo', file); S.brand = await api('/api/admin/brand/logo', { method: 'POST', body: fd }); $('#logoDel').disabled = false; draw(); toast('Логотип загружен — он заменил домик'); });
  $('#logoDel').onclick = guard(async () => { S.brand = await api('/api/admin/brand/logo', { method: 'DELETE' }); $('#logoDel').disabled = true; draw(); toast('Логотип убран'); });
}

// ---------------- брони ----------------
async function renderBookings() {
  const [req, list] = await Promise.all([api('/api/admin/bookings?status=request'), api('/api/admin/bookings')]);
  S.reqCount = req.length; renderNav();
  const pay = PAY_ST, st = BK_ST;
  const row = (b, actions) => `<tr class="click" data-open="bk:${b.id}"><td><b>№${b.number}</b><div class="muted small">${SRC[b.source] || b.source}</div></td><td>${esc(b.guest?.name || '—')}<div class="muted small">${esc(b.guest?.phone || '')}${b.guest?.telegramLinked ? ' · Telegram ✓' : ''}</div></td>
    <td>${esc(b.apartment?.title || '')}</td><td style="white-space:nowrap">${fmtDay(b.checkIn)} → ${fmtDay(b.checkOut)}<div class="muted small">${b.guestsCount} гост.</div></td><td style="white-space:nowrap">${money(b.totalKzt)}${b.currencyShown !== 'KZT' && b.amountShown ? `<div class="muted small">гость видел ${b.amountShown} ${b.currencyShown}</div>` : ''}</td>
    <td><span class="chip ${st[b.status][0]}">${st[b.status][1]}</span> <span class="chip ${pay[b.paymentStatus][0]}">${pay[b.paymentStatus][1]}</span></td><td>${actions || ''}</td></tr>`;
  view(`<div class="page-head"><div><h1>Брони и заявки</h1><p class="sub">Подтверждение заявки отправит гостю сообщение в Telegram, а заказанный трансфер — всем водителям. Нажмите на строку — откроется карточка брони.</p></div></div>
    <div class="stack"><div class="card"><div class="card-h"><h2>Новые заявки · ${req.length}</h2></div>${req.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Бронь</th><th>Гость</th><th>Квартира</th><th>Даты</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody>
      ${req.map(b => row(b, `<div class="row"><button class="btn sm success" data-confirm="${b.id}">Подтвердить</button><button class="btn sm" data-cancel="${b.id}">Отклонить</button></div>`)).join('')}</tbody></table></div>` : '<div class="empty">Новых заявок нет</div>'}</div>
    <div class="card"><div class="card-h"><h2>Ближайшие брони</h2><span class="muted small">неделя назад — 2 месяца вперёд</span></div><div class="table-wrap"><table class="t"><thead><tr><th>Бронь</th><th>Гость</th><th>Квартира</th><th>Даты</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody>
      ${list.filter(b => b.status !== 'request').slice(0, 150).map(b => row(b)).join('')}</tbody></table></div></div></div>`);
  $('#view').onclick = guard(async (e) => {
    const b = e.target.closest('button');
    if (!b) { const o = e.target.closest('[data-open]'); if (o) openItem(o.dataset.open); return; }
    if (b.dataset.confirm) { const x = await api(`/api/admin/bookings/${b.dataset.confirm}/confirm`, { method: 'POST' }); toast(`Бронь №${x.number} подтверждена`); renderBookings(); }
    if (b.dataset.cancel) { if (!confirm('Отклонить заявку?')) return; const x = await api(`/api/admin/bookings/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast(`Заявка №${x.number} отклонена`); renderBookings(); }
  });
}

// ---------------- заявки мастерам ----------------
const WR_ST = { NEW: ['violet', 'Новая'], VISIT_INSPECTION: ['blue', 'Выезд / осмотр'], AWAITING_OWNER_APPROVAL: ['amber', 'Ждёт одобрения сметы'], REJECTED: ['red', 'Смета отклонена'],
  APPROVED: ['green', 'Смета одобрена'], IN_PROGRESS: ['blue', 'В работе'], DONE: ['green', 'Выполнена'], CANCELLED: ['', 'Отменена'] };
const OCC = { UNKNOWN: 'Пока неизвестно', OWNER_PRESENT: 'Владелец будет', EMPTY: 'Квартира пустая' };
const WR_TYPE = { plumb: 'Сантехника', elec: 'Электрика', appl: 'Техника', furn: 'Мебель', build: 'Строительные работы', paint: 'Покраска', other: 'Другое' };
const METHOD = { REMOTE: 'без выезда', PHOTOS: 'по фото', VISIT: 'после осмотра' };
const EV = { created: 'Заявка создана', occupancy_changed: 'Изменено «кто будет в квартире»', visit_requested: 'Мастер запросил выезд', arrived: 'Мастер приехал', inspected: 'Осмотр',
  estimate_submitted: 'Смета отправлена', approved: 'Смета одобрена', rejected: 'Смета отклонена', started: 'Работа начата', extra_submitted: 'Доп. расход', extra_approved: 'Доп. расход одобрен',
  extra_rejected: 'Доп. расход отклонён', completed: 'Выполнено', cancelled: 'Отменена', paid: 'Оплачено мастеру' };
const wrBadge = (s) => `<span class="chip ${WR_ST[s][0]}">${WR_ST[s][1]}</span>`;
const fmtTime = (d) => d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const WR_TABS = [['wait', 'Ждут решения', x => x.pendingEstimate || x.pendingExtras], ['active', 'Активные', x => !['DONE', 'CANCELLED'].includes(x.status)], ['closed', 'Закрытые', x => ['DONE', 'CANCELLED'].includes(x.status)], ['all', 'Все', () => true]];
async function renderRepairs() {
  const list = await api('/api/admin/repairs');
  S.wrCount = list.filter(x => x.pendingEstimate || x.pendingExtras).length; renderNav();
  const tab = WR_TABS.find(t => t[0] === S.wrTab) || WR_TABS[S.wrCount ? 0 : 1];
  const rows = list.filter(tab[2]);
  view(`<div class="page-head"><div><h1>Заявки мастерам</h1><p class="sub">Сантехники, электрики, строители, маляры и подрядчики: работа начинается только после вашего одобрения сметы</p></div>
      <button class="btn primary" id="wrNew">+ Новая заявка</button></div>
    <div class="row" style="margin-bottom:12px"><div class="tabs">${WR_TABS.map(t => `<button class="${t === tab ? 'active' : ''}" data-tab="${t[0]}">${t[1]} · ${list.filter(t[2]).length}</button>`).join('')}</div></div>
    <div class="card">${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Заявка</th><th>Квартира</th><th>Исполнитель</th><th>Статус</th><th>Сумма</th></tr></thead><tbody>
    ${rows.map(x => `<tr class="click" data-wr="${x.id}"><td><b>${esc(x.title)}</b><div class="muted small">${WR_TYPE[x.type] || x.type}${x.quickJob ? ' · простая работа' : ''} · ${fmtDay(x.date.slice(0, 10))}</div></td>
      <td>${esc(x.apartment.title)}<div class="muted small">${OCC[x.occupancy]}</div></td><td>${esc(x.executor?.name || '—')}</td>
      <td>${wrBadge(x.status)}${x.pendingEstimate ? ' <span class="chip amber">смета ждёт</span>' : ''}${x.pendingExtras ? ` <span class="chip amber">доп. расходы: ${x.pendingExtras}</span>` : ''}</td>
      <td style="white-space:nowrap">${x.costKzt != null ? money(x.costKzt) : '—'}${x.paid ? '<div class="muted small">оплачено</div>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Здесь пусто</div>'}</div>`);
  $('#wrNew').onclick = () => go('repairs', 'new');
  $('#view').onclick = (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { S.wrTab = t.dataset.tab; return renderRepairs(); }
    const r = e.target.closest('[data-wr]'); if (r) go('repairs', r.dataset.wr);
  };
}
const occFields = (occ, instr) => `<label>Кто будет в квартире<select name="occupancy">${Object.entries(OCC).map(([k, v]) => `<option value="${k}" ${k === occ ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  <label class="instr" style="grid-column:1/-1" ${occ === 'EMPTY' ? '' : 'hidden'}>Как попасть (мастер увидит, только пока квартира пустая)<textarea name="accessInstructions" rows="3" placeholder="Где ключи, кого спросить, во сколько можно прийти…">${esc(instr || '')}</textarea></label>`;
const bindOcc = (form) => { form.elements.occupancy.onchange = () => { form.querySelector('.instr').hidden = form.elements.occupancy.value !== 'EMPTY'; }; };
async function newRepair() {
  const [apts, team, contr] = await Promise.all([api('/api/admin/apartments'), api('/api/admin/team'), api('/api/admin/contractors')]);
  const masters = team.filter(m => m.role === 'master' && m.active && !contr.some(c => c.userId === m.userId));
  view(`<div class="page-head"><div><button class="btn sm" id="back">← Все заявки</button><h1 style="margin-top:10px">Новая заявка мастеру</h1><p class="sub">Мастер оценит без выезда, по фото или после осмотра; начать работу сможет только после вашего одобрения</p></div>
    <button class="btn primary" id="wrCreate">Создать заявку</button></div>
    <form class="card card-b grid g3" id="wrForm" novalidate>
      <label>Квартира<select name="apartmentId">${apts.map(a => `<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select></label>
      <label>Что сделать<input name="title" placeholder="Не работает розетка на кухне"></label>
      <label>Вид работ<select name="type">${Object.entries(WR_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label style="grid-column:1/-1">Описание<textarea name="description" rows="3" placeholder="Что случилось, где, с какого времени"></textarea></label>
      <label>Исполнитель<select name="executor"><optgroup label="Мастера команды">${masters.map(m => `<option value="m:${m.userId}">${esc(m.name)}</option>`).join('')}</optgroup>
        <optgroup label="Подрядчики">${contr.map(c => `<option value="c:${c.id}">${esc(c.name)}${c.userId ? '' : ' (по ссылке)'}</option>`).join('')}</optgroup></select></label>
      <label>Когда<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Срочность<select name="priority"><option value="medium">Обычная</option><option value="high">Срочно</option><option value="low">Не срочно</option></select></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="quickJob"> Простая работа (например, заменить лампочку): мастер может сделать сразу на месте без сметы — приезд и итоговая цена всё равно записываются</label>
      ${occFields('UNKNOWN', '')}
    </form><p class="muted small" style="margin-top:10px">Фото проблемы можно добавить сразу после создания — тогда мастер сможет оценить работу по фото.</p>`);
  const f = $('#wrForm'); bindOcc(f);
  $('#back').onclick = () => go('repairs');
  $('#wrCreate').onclick = guard(async () => {
    const [kind, id] = f.elements.executor.value.split(':');
    const body = { apartmentId: f.elements.apartmentId.value, title: f.elements.title.value.trim(), description: f.elements.description.value.trim() || undefined, type: f.elements.type.value,
      priority: f.elements.priority.value, date: f.elements.date.value || undefined, quickJob: f.elements.quickJob.checked, occupancy: f.elements.occupancy.value,
      accessInstructions: f.elements.accessInstructions.value.trim() || null, ...(kind === 'm' ? { assigneeId: id } : { contractorId: id }) };
    const t = await api('/api/admin/repairs', { method: 'POST', body }); toast('Заявка создана — исполнитель получит уведомление'); go('repairs', t.id);
  });
}
async function openRepair(id) { S.wr = await api('/api/admin/repairs/' + id); drawRepair(); }
function drawRepair() {
  const t = S.wr; const open = !['DONE', 'CANCELLED'].includes(t.status);
  const est = (e) => `<div class="wr-item ${e.status}"><div class="row"><b class="grow">${money(e.totalKzt)}${e.maxKzt ? ' – ' + money(e.maxKzt) : ''}</b>
      <span class="chip">${METHOD[e.method]}</span>${e.preliminary ? '<span class="chip">предварительно</span>' : ''}${e.status === 'pending' ? '<span class="chip amber">ждёт решения</span>' : e.status === 'approved' ? '<span class="chip green">одобрена</span>' : '<span class="chip red">отклонена</span>'}</div>
    <div class="muted small">Работа ${money(e.labourKzt)} · ${e.materialsIncluded ? `материалы ${money(e.materialsKzt)} входят в цену` : 'материалы не входят, покупаются отдельно'} · ${esc(e.byName || '')} · ${fmtTime(e.createdAt)}</div>
    ${e.items ? `<div class="small">📦 ${esc(e.items)}</div>` : ''}${e.comment ? `<div class="small">💬 ${esc(e.comment)}</div>` : ''}${e.rejectReason ? `<div class="small" style="color:var(--red)">Причина отказа: ${esc(e.rejectReason)}</div>` : ''}
    ${e.status === 'pending' && t.status === 'AWAITING_OWNER_APPROVAL' ? (t.canDecide ? `<div class="row" style="margin-top:8px"><button class="btn sm success" data-est-ok="${e.id}">Одобрить смету</button><button class="btn sm" data-est-no="${e.id}">Отклонить…</button></div>` : '<div class="muted small" style="margin-top:6px">Решение по смете принимает владелец (см. «Настройки»)</div>') : ''}</div>`;
  const extra = (x) => `<div class="wr-item"><div class="row"><b class="grow">${money(x.amountKzt)} · ${esc(x.description)}</b>${x.status === 'PENDING' ? '<span class="chip amber">ждёт решения</span>' : x.status === 'APPROVED' ? '<span class="chip green">одобрен</span>' : '<span class="chip red">отклонён</span>'}</div>
    <div class="muted small">Почему: ${esc(x.reason)} · ${esc(x.byName || '')} · ${fmtTime(x.createdAt)}</div>${x.photos.length ? `<div class="wr-photos sm">${x.photos.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="background-image:url('${esc(p.url)}')"></a>`).join('')}</div>` : ''}
    ${x.decisionNote ? `<div class="small">💬 ${esc(x.decisionNote)}</div>` : ''}
    ${x.status === 'PENDING' && !t.paid && t.status !== 'CANCELLED' ? (t.canDecide ? `<div class="row" style="margin-top:8px"><button class="btn sm success" data-x-ok="${x.id}">Одобрить</button><button class="btn sm" data-x-no="${x.id}">Отклонить…</button></div>` : '<div class="muted small" style="margin-top:6px">Решение принимает владелец</div>') : ''}</div>`;
  const problem = t.photos.filter(p => p.kind === 'problem'), work = t.photos.filter(p => p.kind !== 'problem' && !p.extraId);
  const PK = { arrival: 'приезд', inspection: 'осмотр', after: 'после работ', receipt: 'чек' };
  view(`<div class="page-head"><div><button class="btn sm" id="back">← Все заявки</button><h1 style="margin-top:10px">${esc(t.title)}</h1>
      <p class="sub">${wrBadge(t.status)} ${t.quickJob ? '<span class="chip">простая работа</span>' : ''} · ${esc(t.apartment.title)} · исполнитель: <b>${esc(t.executor?.name || '—')}</b></p></div>
      <div class="row">${open ? '<button class="btn danger" id="wrCancel">Отменить заявку</button>' : ''}${t.status === 'DONE' && !t.paid ? '<button class="btn success" id="wrPaid">Оплачено мастеру</button>' : ''}</div></div>
    <div class="wr-grid"><div class="stack">
      <div class="card"><div class="card-h"><h2>Сметы</h2><span class="muted small">работа начинается только после одобрения</span></div><div class="card-b stack" style="gap:10px">${t.estimates.length ? t.estimates.slice().reverse().map(est).join('') : '<div class="muted">Мастер ещё не прислал смету</div>'}</div></div>
      ${t.extras.length || t.status === 'IN_PROGRESS' ? `<div class="card"><div class="card-h"><h2>Доп. расходы</h2><span class="muted small">возникли не по вине мастера; одобренные прибавляются к сумме</span></div><div class="card-b stack" style="gap:10px">${t.extras.length ? t.extras.map(extra).join('') : '<div class="muted">Пока нет</div>'}</div></div>` : ''}
      <div class="card"><div class="card-h"><h2>Фото проблемы <span class="muted">· ${problem.length}</span></h2>${open ? `<label class="btn sm primary" style="flex-direction:row;cursor:pointer">+ Добавить фото<input type="file" id="wrPh" accept="image/jpeg,image/png,image/webp" multiple hidden></label>` : ''}</div>
        <div class="card-b">${problem.length ? `<div class="wr-photos">${problem.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="background-image:url('${esc(p.url)}')">${p.caption ? `<span>${esc(p.caption)}</span>` : ''}</a>`).join('')}</div>` : '<div class="muted small">Добавьте фото — мастер сможет оценить работу по фото, без выезда. Видит только назначенный исполнитель.</div>'}
        ${work.length ? `<h3 class="small" style="margin:12px 0 6px">Фото мастера</h3><div class="wr-photos sm">${work.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener" title="${PK[p.kind] || ''}" style="background-image:url('${esc(p.url)}')"><span>${PK[p.kind] || ''}</span></a>`).join('')}</div>` : ''}</div></div>
      ${t.report || t.finalCostKzt != null ? `<div class="card"><div class="card-h"><h2>Итог</h2></div><div class="card-b"><div>Итог мастера: <b>${money(t.finalCostKzt)}</b>${t.extras.some(x => x.status === 'APPROVED') ? ` + одобренные доп. расходы = <b>${money(t.payableKzt)}</b>` : ''}</div>${t.report ? `<div class="pre" style="margin-top:6px">${esc(t.report)}</div>` : ''}</div></div>` : ''}
    </div><div class="stack">
      <form class="card" id="occForm"><div class="card-h"><h2>Визит в квартиру</h2></div><div class="card-b grid" style="gap:10px">
        <div class="small">📍 ${esc(t.apartment.address)}${t.apartment.apartmentNumber && !/кв\.\s*\d/.test(t.apartment.address) ? ` · кв. ${esc(t.apartment.apartmentNumber)}` : ''}<div class="muted">Мастер видит только адрес и номер квартиры — пока заявка активна</div></div>
        ${occFields(t.occupancy.status, t.occupancy.accessInstructions)}
        <div class="row"><button class="btn sm primary" type="submit">Сохранить</button><span class="muted small grow">${t.occupancy.updatedBy ? `изменил(а) ${esc(t.occupancy.updatedBy.name)}, ${fmtTime(t.occupancy.updatedAt)}` : ''}</span></div></div></form>
      <div class="card"><div class="card-h"><h2>Сумма</h2></div><div class="card-b small">В финансах: <b>${t.costKzt != null ? money(t.costKzt) : '—'}</b>${t.paid ? ` · оплачено ${fmtTime(t.paidAt)}` : ''}${t.pendingExtras ? `<div style="color:var(--amber,#b45309)">Нерешённых доп. расходов: ${t.pendingExtras} — оплату отметить нельзя</div>` : ''}</div></div>
      ${t.link && open ? `<div class="card"><div class="card-h"><h2>Ссылка без входа</h2></div><div class="card-b small"><div class="muted">Для подрядчика без аккаунта: откроет на телефоне и отметит шаги (смета, приезд, фото, итог). Перестаёт работать после выполнения.</div><div class="row" style="margin-top:6px"><a href="${esc(t.link.url)}" target="_blank" rel="noopener" style="word-break:break-all">${esc(t.link.url)}</a></div><div class="row" style="margin-top:8px"><button class="btn sm" data-copy="${esc(t.link.url)}">Скопировать</button><button class="btn sm" id="wrLink">Выпустить новую ссылку</button></div></div></div>` : ''}
      <div class="card"><div class="card-h"><h2>Журнал</h2></div><div class="card-b"><ol class="wr-log">${t.events.slice().reverse().map(e => `<li><b>${EV[e.type] || e.type}</b>${e.type === 'occupancy_changed' && e.data?.to ? ` → ${OCC[e.data.to]}` : ''}${e.data?.totalKzt ? ` · ${money(e.data.totalKzt)}` : ''}${e.data?.amountKzt ? ` · ${money(e.data.amountKzt)}` : ''}${e.data?.finalCostKzt != null ? ` · итог ${money(e.data.finalCostKzt)}` : ''}
        <div class="muted small">${esc(e.actorName || '')} · ${fmtTime(e.createdAt)}</div>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</li>`).join('')}</ol></div></div>
    </div></div>`);
  $('#back').onclick = () => go('repairs');
  const f = $('#occForm'); bindOcc(f);
  f.onsubmit = guard(async (e) => { e.preventDefault(); S.wr = await api(`/api/admin/repairs/${t.id}/occupancy`, { method: 'PATCH', body: { occupancy: f.elements.occupancy.value, accessInstructions: f.elements.accessInstructions.value.trim() || null } }); drawRepair(); toast('Сохранено — мастер получит уведомление'); });
  if ($('#wrPh')) $('#wrPh').onchange = guard(async (e) => { const fd = new FormData(); [...e.target.files].forEach(x => { fd.append('photos', x); fd.append('captions', ''); }); S.wr = await api(`/api/admin/repairs/${t.id}/photos`, { method: 'POST', body: fd }); drawRepair(); toast('Фото добавлены — мастер их увидит'); });
  if ($('#wrCancel')) $('#wrCancel').onclick = guard(async () => { const reason = prompt('Отменить заявку? Причина (необязательно):'); if (reason === null) return; S.wr = await api(`/api/admin/repairs/${t.id}/cancel`, { method: 'POST', body: { reason } }); drawRepair(); toast('Заявка отменена'); });
  if ($('#wrPaid')) $('#wrPaid').onclick = guard(async () => { S.wr = await api(`/api/admin/repairs/${t.id}/paid`, { method: 'POST' }); drawRepair(); toast('Отмечено: оплачено мастеру'); });
  if ($('#wrLink')) $('#wrLink').onclick = guard(async () => { if (!confirm('Старая ссылка перестанет работать. Выпустить новую?')) return; S.wr = await api(`/api/admin/repairs/${t.id}/link`, { method: 'POST' }); drawRepair(); toast('Новая ссылка готова'); });
  $('#view').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.copy) { await copyText(b.dataset.copy); return; }
    if (b.dataset.estOk) { S.wr = await api(`/api/admin/estimates/${b.dataset.estOk}/approve`, { method: 'POST' }); toast('Смета одобрена — мастер может начинать'); }
    else if (b.dataset.estNo) { const reason = prompt('Почему отклоняете? Мастер увидит это и пришлёт новую смету:'); if (!reason) return; S.wr = await api(`/api/admin/estimates/${b.dataset.estNo}/reject`, { method: 'POST', body: { reason } }); toast('Смета отклонена'); }
    else if (b.dataset.xOk) { S.wr = await api(`/api/admin/extras/${b.dataset.xOk}/approve`, { method: 'POST' }); toast('Доп. расход одобрен'); }
    else if (b.dataset.xNo) { const note = prompt('Почему отклоняете расход?'); if (!note) return; S.wr = await api(`/api/admin/extras/${b.dataset.xNo}/reject`, { method: 'POST', body: { note } }); toast('Доп. расход отклонён'); }
    else return;
    drawRepair();
  });
}

// ---------------- команда ----------------
async function renderTeam() {
  const list = await api('/api/admin/team');
  view(`<div class="page-head"><div><h1>Команда и Telegram</h1><p class="sub">Чтобы получать уведомления, каждый открывает свою ссылку-приглашение в Telegram (нужен бот — см. README_SERVER.md). «Водит» — человек получает заказы на трансфер и может нажать «Беру».</p></div></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Сотрудник</th><th>Роль</th><th>Доступ</th><th>Водит (трансферы)</th><th>Telegram</th><th></th></tr></thead><tbody>
    ${list.map(m => `<tr><td><b>${esc(m.name)}</b><div class="muted small">${esc(m.email || m.phone || '')}</div></td><td>${ROLE[m.role] || m.role}</td><td>${m.active ? '<span class="chip green">включён</span>' : '<span class="chip">отключён</span>'}</td>
      <td>${m.role === 'driver' ? '<span class="chip blue">🚗 водитель</span>' : `<button class="btn sm ${m.canDrive ? 'success' : ''}" data-drive="${m.userId}" data-on="${m.canDrive ? 1 : 0}">${m.canDrive ? '🚗 Водит' : 'Не водит'}</button>`}
        ${m.canDrive ? `<input class="veh" data-veh="${m.userId}" value="${esc(m.vehicle || '')}" placeholder="Машина, цвет, номер" title="Гость увидит машину, когда водитель возьмёт заказ">` : ''}
        ${m.canDrive && S.me.role === 'owner' ? `<input class="veh" data-rate="${m.userId}" value="${m.payoutFixedKzt != null ? m.payoutFixedKzt : m.payoutPercent != null ? m.payoutPercent + '%' : ''}" placeholder="Ставка: как в настройках" title="Своя ставка водителя: «15%» — комиссия бизнеса, «7000» — фиксированно водителю за поездку. Пусто — как в «Настройках».">` : ''}</td>
      <td>${m.telegramLinked ? '<span class="chip green">подключён</span>' : '<span class="chip amber">не подключён</span>'}</td><td><button class="btn sm" data-invite="${m.userId}">Ссылка для Telegram</button><div class="muted small" id="inv-${m.userId}"></div></td></tr>`).join('')}</tbody></table></div></div>`);
  $('#view').onchange = guard(async (e) => {
    const rt = e.target.closest('[data-rate]');
    if (rt) {
      const raw = rt.value.trim().replace(/\s/g, ''); let body;
      if (!raw) body = { payoutPercent: null, payoutFixedKzt: null };
      else if (/^\d+([.,]\d+)?%$/.test(raw)) body = { payoutPercent: Number(raw.replace('%', '').replace(',', '.')), payoutFixedKzt: null };
      else if (/^\d+$/.test(raw)) body = { payoutFixedKzt: Number(raw), payoutPercent: null };
      else return toast('Ставка: «15%» (комиссия бизнеса) или «7000» (фиксированно водителю)', true);
      await api(`/api/admin/team/${rt.dataset.rate}`, { method: 'PATCH', body }); return toast(raw ? 'Своя ставка водителя сохранена' : 'Ставка — как в настройках');
    }
    const v = e.target.closest('[data-veh]'); if (!v) return;
    await api(`/api/admin/team/${v.dataset.veh}`, { method: 'PATCH', body: { vehicle: v.value.trim() || null } }); toast('Машина сохранена');
  });
  $('#view').onclick = guard(async (e) => {
    const dr = e.target.closest('[data-drive]');
    if (dr) { const r = await api(`/api/admin/team/${dr.dataset.drive}`, { method: 'PATCH', body: { canDrive: dr.dataset.on !== '1' } }); toast(r.canDrive ? 'Теперь получает заказы на трансфер' : 'Больше не получает заказы на трансфер'); return renderTeam(); }
    const b = e.target.closest('[data-invite]'); if (!b) return;
    const r = await api(`/api/admin/team/${b.dataset.invite}/telegram-invite`, { method: 'POST' });
    $('#inv-' + b.dataset.invite).innerHTML = r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link)}</a>` : `Код: <code>/start ${esc(r.payload)}</code> — бот ещё не настроен (нет TELEGRAM_BOT_USERNAME)`;
  });
}

// ---------------- настройки ----------------
async function renderSettings() {
  const st = S.settings = await api('/api/admin/settings');
  const ro = st.canEdit ? '' : 'disabled';
  const radio = (name, val, label, hint) => `<label class="opt"><input type="radio" name="${name}" value="${val}" ${st[name] === val ? 'checked' : ''} ${ro}><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></label>`;
  view(`<div class="page-head"><div><h1>Настройки</h1><p class="sub">${st.canEdit ? 'Меняет только владелец.' : 'Только просмотр — эти настройки меняет владелец.'}</p></div></div>
    <form id="stForm" class="stack" novalidate>
    <div class="card"><div class="card-h"><h2>🚗 Комиссия с трансферов</h2><span class="chip ${st.commissionConfigured ? 'green' : 'amber'}">${st.commissionConfigured ? 'настроено' : 'не настроено'}</span></div><div class="card-b">
      ${st.commissionConfigured ? '' : '<div class="alert amber">Комиссия ещё не настроена — водители получают <b>100%</b> цены трансфера. Укажите, сколько оставляет бизнес.</div>'}
      ${radio('transferPayoutMode', 'PERCENT', 'Бизнес оставляет процент от цены', 'Водителю — цена для гостя минус комиссия')}
      <div class="opt-in"><input name="ownerCommissionPercent" type="number" min="0" max="100" step="1" value="${st.ownerCommissionPercent ?? ''}" placeholder="0" ${ro}><span class="muted">% бизнесу</span></div>
      ${radio('transferPayoutMode', 'FIXED', 'Фиксированная сумма водителю за поездку', 'Бизнесу — всё, что сверху')}
      <div class="opt-in"><input name="driverFixedKzt" type="number" min="0" step="500" value="${st.driverFixedKzt ?? ''}" placeholder="6000" ${ro}><span class="muted">₸ водителю</span></div>
      <div class="muted small" id="stPreview"></div>
      <div class="muted small" style="margin-top:6px">Своя ставка для отдельного водителя — в «Команде»; для одной поездки — в карточке трансфера («Задать вручную»). Водители видят только свою выплату.</div></div></div>
    <div class="card"><div class="card-h"><h2>🔔 Кому уведомления «для менеджера»</h2></div><div class="card-b">
      <div class="muted small" style="margin-bottom:6px">Новые заявки, «никто не взял трансфер», водитель взял/отказался, сметы и отчёты мастеров. Гостям, водителям и мастерам уведомления приходят как обычно; оплаты — всегда владельцу.</div>
      ${radio('managerNotify', 'BOTH', 'Владельцу и администраторам')}${radio('managerNotify', 'OWNER', 'Только владельцу')}${radio('managerNotify', 'ADMIN', 'Только администраторам', 'если активных админов нет — владельцу')}</div></div>
    <div class="card"><div class="card-h"><h2>🧾 Кто одобряет сметы и доп. расходы</h2></div><div class="card-b">
      ${radio('approvalBy', 'OWNER_AND_ADMIN', 'Владелец и администратор', 'по умолчанию')}${radio('approvalBy', 'OWNER_ONLY', 'Только владелец', 'админ видит смету, но решение — за владельцем; смета всегда приходит владельцу')}</div></div>
    <div class="card"><div class="card-h"><h2>✈️ Слежение за рейсами</h2><span class="chip ${st.server.flightProvider ? 'green' : ''}">${st.server.flightProvider ? 'подключено: ' + esc(st.server.flightProvider) : 'не подключено'}</span></div><div class="card-b">
      <label class="check"><input type="checkbox" name="flightTracking" ${st.flightTracking ? 'checked' : ''} ${ro}> Сдвигать время подачи, если рейс задерживается (водитель и вы получите уведомление)</label>
      <div class="muted small">${st.server.flightProvider ? 'Проверяем встречи в аэропорту на ближайшие 12 часов, не чаще раза в 20 минут.' : 'Нужен ключ AeroDataBox на сервере (AERODATABOX_API_KEY, см. README_SERVER.md). Пока время подачи меняют водитель или админ вручную; в карточке — ссылка «проверить рейс».'}</div></div></div>
    <div class="card"><div class="card-h"><h2>🔌 Подключения сервера</h2></div><div class="card-b"><dl class="kv">
      <dt>Telegram-бот</dt><dd>${st.server.telegram ? `<span class="chip green">включён</span>${st.server.telegramBot ? ' @' + esc(st.server.telegramBot) : ''}` : '<span class="chip amber">выключен</span> <span class="muted small">уведомления пишутся в журнал</span>'}</dd>
      <dt>Фото</dt><dd>${st.server.storage === 's3' ? 'S3-хранилище' : 'папка uploads/ на сервере'}</dd>
      <dt>Приложение команды</dt><dd><a href="/app/" target="_blank" rel="noopener">${location.origin}/app/</a> <span class="muted small">— водители, мастера, клининг</span></dd></dl></div></div>
    ${st.canEdit ? '<div class="row"><button class="btn primary">Сохранить настройки</button></div>' : ''}</form>`);
  const f = $('#stForm');
  const preview = () => {
    const price = 10000, mode = f.querySelector('[name=transferPayoutMode]:checked')?.value;
    const pay = mode === 'FIXED' ? Number(f.elements.driverFixedKzt.value || 0) : Math.round(price * (100 - Number(f.elements.ownerCommissionPercent.value || 0)) / 100 / 100) * 100;
    $('#stPreview').innerHTML = `Пример: трансфер за ${money(price)} → водителю <b>${money(pay)}</b>, бизнесу <b>${money(price - pay)}</b>`;
  };
  f.oninput = (e) => {   // ввели число — выбираем соответствующий вариант
    const pick = { ownerCommissionPercent: 'PERCENT', driverFixedKzt: 'FIXED' }[e.target.name];
    if (pick) f.querySelector(`[name=transferPayoutMode][value=${pick}]`).checked = true;
    preview();
  };
  preview();
  f.onsubmit = guard(async (e) => {
    e.preventDefault();
    const mode = f.querySelector('[name=transferPayoutMode]:checked').value;
    const num = (n) => f.elements[n].value === '' ? null : Number(f.elements[n].value);
    const body = { transferPayoutMode: mode, ownerCommissionPercent: mode === 'PERCENT' ? (num('ownerCommissionPercent') ?? 0) : num('ownerCommissionPercent'), driverFixedKzt: num('driverFixedKzt'),
      managerNotify: f.querySelector('[name=managerNotify]:checked').value, approvalBy: f.querySelector('[name=approvalBy]:checked').value, flightTracking: f.elements.flightTracking.checked };
    S.settings = await api('/api/admin/settings', { method: 'PUT', body }); toast('Настройки сохранены. Новая комиссия — для новых заказов и при смене водителя'); renderSettings();
  });
}

// ---------------- финансы (владелец) ----------------
async function renderFinance(month) {
  const m = month || S.finMonth || todayIso().slice(0, 7); S.finMonth = m;
  const f = await api('/api/admin/finance?month=' + m);
  const [y, mm] = m.split('-').map(Number);
  const shift = (n) => { const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const tile = (label, value, hint, tone = '') => `<div class="card fin ${tone}"><div class="muted small">${label}</div><div class="fin-v">${value}</div>${hint ? `<div class="muted small">${hint}</div>` : ''}</div>`;
  view(`<div class="page-head"><div><h1>Финансы</h1><p class="sub">Только владелец. Трансферы — по выполненным поездкам месяца, ремонты — по дате заявки (без отменённых).</p></div>
      <div class="row"><button class="btn sm" data-m="${shift(-1)}">←</button><b style="min-width:120px;text-align:center">${MONTHS[mm - 1]} ${y}</b><button class="btn sm" data-m="${shift(1)}">→</button></div></div>
    <h3 class="fin-h">Проживание</h3><div class="fin-grid">${tile('Выручка', money(f.revenueKzt), `${f.bookings} брон.`)}${tile('Ночей продано', f.nights, `загрузка ${Math.round(f.occupancy * 100)}%`)}${tile('Средняя цена ночи', money(f.adrKzt))}</div>
    <h3 class="fin-h">Трансферы · ${f.transfers} поездок</h3><div class="fin-grid">${tile('Заплатили гости', money(f.transfersRevenueKzt))}${tile('Водителям', money(f.transfersPayoutKzt), f.transfersUnpaidKzt ? `ещё не выплачено ${money(f.transfersUnpaidKzt)}` : 'всё выплачено', f.transfersUnpaidKzt ? 'amber' : '')}${tile('Осталось бизнесу (комиссия)', money(f.transfersMarginKzt), '', 'green')}</div>
    <h3 class="fin-h">Ремонты и мастера · ${f.repairs}</h3><div class="fin-grid">${tile('Расходы', money(f.repairsKzt))}${tile('Не оплачено мастерам', money(f.repairsUnpaidKzt), '', f.repairsUnpaidKzt ? 'amber' : '')}</div>
    <h3 class="fin-h">Итого</h3><div class="fin-grid">${tile('Проживание + трансферы − водителям − ремонты', money(f.netKzt), '', f.netKzt >= 0 ? 'green' : 'red')}</div>`);
  $('#view').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) guard(renderFinance)(b.dataset.m); };
}

// ---------------- уведомления ----------------
async function renderNotifications() {
  const list = await api('/api/admin/notifications?limit=150');
  const st = { sent: ['green', 'отправлено'], logged: ['', 'в журнале'], failed: ['red', 'ошибка'], skipped: ['amber', 'пропущено'] };
  view(`<div class="page-head"><div><h1>Уведомления</h1><p class="sub">Всё, что система отправила или отправила бы в Telegram. Пока бот не подключён — сообщения сохраняются здесь.</p></div><button class="btn" id="nfRefresh">Обновить</button></div>
    <div class="card">${list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Когда</th><th>Событие</th><th>Кому</th><th>Статус</th><th>Текст</th></tr></thead><tbody>
    ${list.map(n => `<tr><td style="white-space:nowrap">${new Date(n.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td><code>${esc(n.event)}</code></td><td>${esc(ROLE[n.recipientType] || (n.recipientType === 'guest' ? 'Гость' : n.recipientType))}</td>
      <td><span class="chip ${st[n.status]?.[0] || ''}">${st[n.status]?.[1] || n.status}</span>${n.error ? `<div class="muted small">${esc(n.error)}</div>` : ''}</td><td><div class="pre">${esc(n.text.replace(/<[^>]+>/g, ''))}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Уведомлений пока нет</div>'}</div>`);
  $('#nfRefresh').onclick = () => renderNotifications();
}

// ---------------- единые цвета и статусы ----------------
// Один смысл цвета во всей админке: фиолетовый — новое; жёлтый — ждёт решения / ищем исполнителя;
// красный — срочно / проблема; синий — в работе; зелёный — готово / подтверждено; серый — закрыто.
const TONES = [['violet', 'Новое'], ['amber', 'Ждёт решения / ищем'], ['red', 'Срочно / проблема'], ['blue', 'В работе'], ['green', 'Готово / подтверждено'], ['', 'Закрыто / отменено']];
const BK_ST = { request: ['violet', 'Заявка'], confirmed: ['green', 'Подтверждена'], completed: ['', 'Завершена'], cancelled: ['', 'Отменена'] };
const PAY_ST = { paid: ['green', 'Оплачено'], prepaid: ['amber', 'Предоплата'], unpaid: ['red', 'Не оплачено'], refunded: ['', 'Возврат'] };
const CL_ST = { assigned: ['', 'Запланирована'], enroute: ['blue', 'Клинер в пути'], progress: ['blue', 'Идёт уборка'], done: ['green', 'Готово'] };
const TR_ST = { REQUESTED: ['violet', 'Ждёт подтверждения брони'], OFFERED: ['amber', 'Ищем водителя'], UNASSIGNED: ['red', 'Никто не взял'], ACCEPTED: ['blue', 'Водитель назначен'],
  EN_ROUTE: ['blue', 'Водитель в пути'], ARRIVED: ['blue', 'Водитель на месте'], PICKED_UP: ['blue', 'Гость в машине'], DONE: ['green', 'Выполнен'], CANCELLED: ['', 'Отменён'] };
const TR_EV = { offered: 'Предложен всем водителям', escalated: 'Никто не взял — сигнал хозяину/админу', accepted: 'Водитель взял заказ', assigned: 'Назначен водитель', reassigned: 'Водитель заменён',
  released: 'Водитель отказался', en_route: 'Водитель выехал', arrived: 'Водитель на месте', picked_up: 'Гость в машине', done: 'Выполнен', cancelled: 'Отменён', time_changed: 'Изменено время подачи',
  updated: 'Изменены детали', paid: 'Оплачено водителю', unpaid: 'Снята отметка «оплачено»', link: 'Новая ссылка водителю' };
const DIR = { in: 'Встреча', out: 'Проводы' };
const badge = (map, s) => { const [t, l] = map[s] || ['', s]; return `<span class="chip ${t}">${l}</span>`; };
const trStatus = (t) => t.job?.status || (t.status === 'cancelled' ? 'CANCELLED' : t.status === 'done' ? 'DONE' : 'REQUESTED');
const hmOf = (d) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
const isoAdd = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const wd = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
const legend = () => `<div class="legend m-scroll">${TONES.map(([t, l]) => `<span><i class="dot ${t || 'grey'}"></i>${l}</span>`).join('')}<span class="sep"></span><span>▬ бронь</span><span>🧹 уборка</span><span>🔧 мастер</span><span>🚗 трансфер</span></div>`;

// ---------------- карточка сбоку (на телефоне — снизу) ----------------
function drawer(html) {
  let d = $('#drawer');
  if (!d) {
    d = document.createElement('div'); d.id = 'drawer'; d.className = 'drawer-wrap';
    d.innerHTML = '<div class="drawer-bg" data-close></div><aside class="drawer" role="dialog" aria-modal="true"><button class="icon-btn drawer-x" data-close aria-label="Закрыть">✕</button><div class="drawer-body"></div></aside>';
    document.body.append(d);
    d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !d.hidden) closeDrawer(); });
  }
  const body = d.querySelector('.drawer-body'); body.innerHTML = html; d.hidden = false; document.body.classList.add('noscroll');
  body.scrollTop = 0;
  return body;
}
function closeDrawer() { const d = $('#drawer'); if (d) d.hidden = true; document.body.classList.remove('noscroll'); }
/** Открыть детали одним кликом: bk:<id> бронь · tr:<jobId>:<transferId> трансфер · cl:<id> уборка · wr:<id> заявка мастеру */
const openItem = guard(async (code) => {
  const [k, a, b] = code.split(':');
  if (k === 'bk') return bookingCard(a);
  if (k === 'tr') return a ? transferCard(a) : requestedTransferCard(b);
  if (k === 'cl') return cleaningCard(a);
  if (k === 'wr') return repairCard(a);
});
const refresh = () => { if (S.view === 'calendar') renderCalendar(); else if (S.view === 'transfers') renderTransfers(); else if (S.view === 'bookings') renderBookings(); };

// ---------------- календарь ----------------
S.cal = { from: null, days: 14, mode: matchMedia('(max-width: 760px)').matches ? 'list' : 'grid', show: { bookings: true, cleanings: true, repairs: true, transfers: true } };
async function renderCalendar() {
  const c = S.cal;
  const [cal, need, req, wr] = await Promise.all([
    api(`/api/admin/calendar?${c.from ? `from=${c.from}&` : c.mode === 'list' ? `from=${todayIso()}&` : ''}days=${c.days}`), api('/api/admin/transfer-jobs?status=UNASSIGNED,OFFERED&from=' + isoAdd(todayIso(), -1)),
    api('/api/admin/bookings?status=request'), api('/api/admin/repairs').catch(() => []),
  ]);
  c.from = cal.from; S.calData = cal;
  const unassigned = need.items.filter(x => x.status === 'UNASSIGNED').length, offered = need.items.length - unassigned;
  S.reqCount = req.length; S.trCount = unassigned; S.wrCount = wr.filter(x => x.pendingEstimate || x.pendingExtras).length; renderNav();
  const att = [
    unassigned && `<button class="att red" data-goto="transfers">🚗 Никто не взял: <b>${unassigned}</b></button>`,
    offered && `<button class="att amber" data-goto="transfers">🚗 Ищем водителя: <b>${offered}</b></button>`,
    req.length && `<button class="att violet" data-goto="bookings">📩 Заявки на бронь: <b>${req.length}</b></button>`,
    S.wrCount && `<button class="att amber" data-goto="repairs">🔧 Ждут вашего решения: <b>${S.wrCount}</b></button>`,
  ].filter(Boolean);
  const last = isoAdd(cal.from, cal.days - 1);
  view(`<div class="page-head"><div><h1>Календарь</h1><p class="sub hide-m">Брони, уборки, заявки мастерам и трансферы. Нажмите на любой элемент — откроется карточка.</p></div>
      <div class="row"><div class="tabs"><button class="${c.mode === 'grid' ? 'active' : ''}" data-mode="grid">Шахматка</button><button class="${c.mode === 'list' ? 'active' : ''}" data-mode="list">По дням</button></div></div></div>
    <div class="attention m-scroll">${att.length ? att.join('') : '<span class="att green">✓ Всё под контролем — срочных дел нет</span>'}</div>
    <div class="cal-bar">
      <div class="row"><button class="btn sm" data-shift="-7">←</button><button class="btn sm" data-shift="0">Сегодня</button><button class="btn sm" data-shift="7">→</button>
        <b class="cal-range">${fmtDay(cal.from)} — ${fmtDay(last)}</b></div>
      <div class="row filters m-scroll">${[['bookings', '▬ Брони'], ['cleanings', '🧹 Уборки'], ['repairs', '🔧 Мастера'], ['transfers', '🚗 Трансферы']].map(([k, l]) => `<button class="fchip ${c.show[k] ? 'on' : ''}" data-show="${k}">${l}</button>`).join('')}</div>
    </div>
    ${legend()}
    <div class="card cal-card">${c.mode === 'grid' ? calGrid(cal) : calList(cal, cal.from, cal.days)}</div>`);
  $('#view').onclick = (e) => {
    const t = e.target.closest('[data-open],[data-day],[data-shift],[data-show],[data-mode],[data-goto]'); if (!t) return;
    if (t.dataset.open) return openItem(t.dataset.open);
    if (t.dataset.day) return drawer(`<div class="dh"><div class="muted small">${WD[wd(t.dataset.day)]}</div><h2>${fmtDay(t.dataset.day)}</h2></div>${calList(S.calData, t.dataset.day, 1, true)}`).onclick = (ev) => { const o = ev.target.closest('[data-open]'); if (o) openItem(o.dataset.open); };
    if (t.dataset.shift) { c.from = +t.dataset.shift ? isoAdd(c.from, +t.dataset.shift) : null; return renderCalendar(); }
    if (t.dataset.show) { c.show[t.dataset.show] = !c.show[t.dataset.show]; return renderCalendar(); }
    if (t.dataset.mode) { c.mode = t.dataset.mode; return renderCalendar(); }
    if (t.dataset.goto) return go(t.dataset.goto);
  };
}
function calIndex(cal) {
  const map = {}; const put = (apt, d, x) => { (map[`${apt}|${d}`] ||= []).push(x); };
  const sh = S.cal.show;
  if (sh.cleanings) for (const c of cal.cleanings) put(c.apartmentId, c.date, { kind: 'cl', time: c.fromTime, icon: '🧹', tone: (c.status === 'assigned' && !c.assignee ? CL_ST.assigned : CL_ST[c.status])[0] || 'grey', open: `cl:${c.id}`, title: `Уборка ${c.fromTime} · ${CL_ST[c.status][1]}${c.assignee ? ' · ' + c.assignee : ' · не назначена'}` });
  if (sh.repairs) for (const r of cal.repairs) put(r.apartmentId, r.date, { kind: 'wr', icon: '🔧', tone: WR_ST[r.status][0] || 'grey', open: `wr:${r.id}`, title: `${r.title} · ${WR_ST[r.status][1]}` });
  if (sh.transfers) for (const t of cal.transfers) put(t.apartmentId, t.date, { kind: 'tr', time: t.time, icon: '🚗', label: t.time, tone: TR_ST[t.status][0] || 'grey', open: `tr:${t.jobId || ''}:${t.transferId}`, title: `${DIR[t.direction]} ${t.time}${t.flight ? ' · ' + t.flight : ''} · ${TR_ST[t.status][1]}${t.driverName ? ' · ' + t.driverName : ''}` });
  for (const k in map) map[k].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  return map;
}
const cchip = (x) => `<button class="cchip t-${x.tone}" data-open="${x.open}" title="${esc(x.title)}">${x.icon}${x.label ? `<span>${esc(x.label)}</span>` : ''}</button>`;
function calGrid(cal) {
  const days = [...Array(cal.days)].map((_, i) => isoAdd(cal.from, i)), last = days.at(-1);
  const idx = Object.fromEntries(days.map((d, i) => [d, i]));
  const map = calIndex(cal);
  const rows = [...cal.apartments];
  if (cal.transfers.some(t => !t.apartmentId)) rows.push({ id: null, title: 'Трансферы без квартиры', number: null });
  const dc = (d) => `${d === cal.today ? ' today' : ''}${[0, 6].includes(wd(d)) ? ' we' : ''}`;
  let h = `<div class="cal-scroll"><div class="cal" style="--n:${days.length}"><div class="cal-corner" style="grid-row:1;grid-column:1">Квартира</div>`;
  days.forEach((d, i) => { h += `<button class="cal-day${dc(d)}" style="grid-row:1;grid-column:${i + 2}" data-day="${d}" title="Все события дня"><small>${WD[wd(d)]}</small><b>${+d.slice(8)}</b></button>`; });
  rows.forEach((a, r) => {
    const r1 = 2 + r * 2, r2 = r1 + 1;
    h += `<div class="cal-apt" style="grid-row:${r1} / span 2;grid-column:1" title="${esc(a.title)}"><b>${a.number ? 'кв. ' + esc(a.number) : esc(a.title)}</b>${a.number ? `<small>${esc(a.title)}</small>` : ''}</div>`;
    days.forEach((d, i) => {
      const items = map[`${a.id}|${d}`] || [];
      h += `<div class="cal-cell${dc(d)}" style="grid-row:${r1};grid-column:${i + 2}"></div><div class="cal-cell lane${dc(d)}" style="grid-row:${r2};grid-column:${i + 2}">${items.map(cchip).join('')}</div>`;
    });
    if (S.cal.show.bookings && a.id) for (const b of cal.bookings.filter(b => b.apartmentId === a.id)) {
      const cutL = b.checkIn < cal.from, cutR = b.checkOut > last;
      const s0 = cutL ? 0 : idx[b.checkIn], e0 = cutR ? days.length - 1 : idx[b.checkOut];
      if (s0 == null || e0 == null) continue;
      const tone = BK_ST[b.status][0] || 'grey';
      h += `<button class="cal-bar-b t-${tone}${cutL ? ' cut-l' : ''}${cutR ? ' cut-r' : ''}${b.status === 'request' ? ' req' : ''}" style="grid-row:${r1};grid-column:${s0 + 2} / ${e0 + 3}" data-open="bk:${b.id}"
        title="№${b.number} · ${esc(b.guestName || '')} · ${fmtDay(b.checkIn)} → ${fmtDay(b.checkOut)} · ${BK_ST[b.status][1]} · ${PAY_ST[b.paymentStatus]?.[1] || ''}">${b.paymentStatus === 'unpaid' && b.status !== 'completed' ? '<i class="unpaid" title="не оплачено"></i>' : ''}<b>№${b.number}</b> ${esc(b.guestName || '')}</button>`;
    }
  });
  return h + '</div></div>';
}
function calList(cal, from, n, inDrawer) {
  const apt = Object.fromEntries(cal.apartments.map(a => [a.id, a.number ? 'кв. ' + a.number : a.title]));
  const sh = S.cal.show; const out = [];
  for (let k = 0; k < n; k++) {
    const d = isoAdd(from, k); const items = [];
    if (sh.bookings) for (const b of cal.bookings) {
      if (b.checkIn === d) items.push({ time: b.checkInTime, icon: '🛬', text: `Заезд · ${apt[b.apartmentId]} · ${b.guestName || ''} · ${b.guestsCount} гост.`, badge: badge(BK_ST, b.status), open: `bk:${b.id}` });
      if (b.checkOut === d) items.push({ time: b.checkOutTime, icon: '🛫', text: `Выезд · ${apt[b.apartmentId]} · ${b.guestName || ''}`, badge: badge(BK_ST, b.status), open: `bk:${b.id}` });
    }
    if (sh.transfers) for (const t of cal.transfers.filter(t => t.date === d)) items.push({ time: t.time, icon: '🚗', text: `${DIR[t.direction]}${t.flight ? ' · ' + t.flight : ''} · ${t.apartmentId ? apt[t.apartmentId] : 'без квартиры'} · ${t.guestName || ''}${t.driverName ? ' · 👤 ' + t.driverName : ''}`, badge: badge(TR_ST, t.status), open: `tr:${t.jobId || ''}:${t.transferId}` });
    if (sh.cleanings) for (const c of cal.cleanings.filter(c => c.date === d)) items.push({ time: c.fromTime, icon: '🧹', text: `Уборка · ${apt[c.apartmentId]} · ${c.assignee || 'не назначена'}`, badge: badge(CL_ST, c.status), open: `cl:${c.id}` });
    if (sh.repairs) for (const r of cal.repairs.filter(r => r.date === d)) items.push({ time: '', icon: '🔧', text: `${r.title} · ${apt[r.apartmentId]}`, badge: badge(WR_ST, r.status), open: `wr:${r.id}` });
    items.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    out.push(`<div class="agenda-day">${inDrawer ? '' : `<div class="agenda-h${d === cal.today ? ' today' : ''}">${WD[wd(d)]}, ${fmtDay(d)}${d === cal.today ? ' · сегодня' : ''}<span class="muted small">${items.length || ''}</span></div>`}
      ${items.length ? items.map(x => `<button class="agenda-i" data-open="${x.open}"><span class="tm">${x.time || ''}</span><span class="ic">${x.icon}</span><span class="tx">${esc(x.text)}</span>${x.badge}</button>`).join('') : '<div class="muted small agenda-empty">Ничего не запланировано</div>'}</div>`);
  }
  return `<div class="agenda">${out.join('')}</div>`;
}

// ---------------- карточки ----------------
async function bookingCard(id) {
  const b = await api('/api/admin/bookings/' + id);
  const nights = Math.round((new Date(b.checkOut) - new Date(b.checkIn)) / 86400000);
  const body = drawer(`<div class="dh"><div class="muted small">▬ Бронь №${b.number} · ${SRC[b.source] || b.source}</div><h2>${esc(b.guest?.name || 'Гость')}</h2><div class="row">${badge(BK_ST, b.status)}${badge(PAY_ST, b.paymentStatus)}</div></div>
    <section class="ds"><dl class="kv"><dt>Квартира</dt><dd>${esc(b.apartment?.title || '')}</dd><dt>Даты</dt><dd>${fmtDay(b.checkIn)} с ${b.checkInTime} → ${fmtDay(b.checkOut)} до ${b.checkOutTime} · ${nights} ноч.</dd>
      <dt>Гостей</dt><dd>${b.guestsCount}${b.pets ? ' · с животным' : ''}</dd><dt>Телефон</dt><dd>${b.guest?.phone ? `<a href="tel:${esc(b.guest.phone.replace(/\s/g, ''))}">${esc(b.guest.phone)}</a>` : '—'}${b.guest?.telegramLinked ? ' · Telegram ✓' : ''}</dd>
      <dt>Сумма</dt><dd>${money(b.totalKzt)}</dd>${b.note ? `<dt>Комментарий</dt><dd>${esc(b.note)}</dd>` : ''}</dl></section>
    <section class="ds"><h3>Трансферы</h3>${b.transfers.length ? b.transfers.map(t => `<button class="li" data-open="tr:${t.job?.id || ''}:${t.id}"><span>🚗 ${DIR[t.direction]} · ${fmtDay(t.date)} ${t.time}${t.flight ? ' · ' + esc(t.flight) : ''}${t.job?.driverName ? ` · ${esc(t.job.driverName)}` : ''}</span>${badge(TR_ST, trStatus(t))}</button>`).join('') : '<div class="muted small">Трансфер не заказан</div>'}
      ${b.status === 'request' && b.transfers.length ? '<div class="muted small" style="margin-top:6px">После подтверждения брони заказ сразу уйдёт всем водителям.</div>' : ''}</section>
    <section class="ds"><h3>Уборка</h3>${b.cleanings.length ? b.cleanings.map(c => `<button class="li" data-open="cl:${c.id}"><span>🧹 ${fmtDay(c.date)} · ${esc(c.assignee || 'не назначена')}</span>${badge(CL_ST, c.status)}</button>`).join('') : `<div class="muted small">${b.status === 'request' ? 'Появится после подтверждения' : 'Не запланирована'}</div>`}</section>
    <div class="row">${b.status === 'request' ? `<button class="btn success" data-act="confirm">Подтвердить бронь</button><button class="btn" data-act="cancel">Отклонить</button>` : b.status === 'confirmed' ? '<button class="btn danger sm" data-act="cancel">Отменить бронь</button>' : ''}</div>`);
  body.onclick = guard(async (e) => {
    const o = e.target.closest('[data-open]'); if (o) return openItem(o.dataset.open);
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'confirm') { await api(`/api/admin/bookings/${b.id}/confirm`, { method: 'POST' }); toast(`Бронь №${b.number} подтверждена${b.transfers.length ? ' — трансфер предложен водителям' : ''}`); }
    if (a.dataset.act === 'cancel') { if (!confirm(b.status === 'request' ? 'Отклонить заявку?' : 'Отменить бронь? Трансфер и уборка тоже отменятся, водитель получит уведомление.')) return; await api(`/api/admin/bookings/${b.id}/cancel`, { method: 'POST' }); toast('Готово'); }
    await bookingCard(b.id); refresh();
  });
}
function cleaningCard(id) {
  const c = S.calData?.cleanings.find(x => x.id === id); if (!c) return;
  const a = S.calData.apartments.find(x => x.id === c.apartmentId);
  drawer(`<div class="dh"><div class="muted small">🧹 Уборка</div><h2>${a ? (a.number ? 'кв. ' + esc(a.number) : esc(a.title)) : ''} · ${fmtDay(c.date)}</h2><div class="row">${badge(CL_ST, c.status)}${c.assignee ? '' : '<span class="chip amber">не назначена</span>'}</div></div>
    <section class="ds"><dl class="kv"><dt>Квартира</dt><dd>${esc(a?.title || '')}</dd><dt>С</dt><dd>${esc(c.fromTime)}</dd><dt>Клинер</dt><dd>${esc(c.assignee || '—')}</dd></dl>
    <p class="muted small">Клинер отмечает «в пути», «начала», «готово» и отчёт в приложении команды.</p></section>`);
}
function repairCard(id) {
  const r = S.calData?.repairs.find(x => x.id === id);
  if (!r) return go('repairs', id);
  const a = S.calData.apartments.find(x => x.id === r.apartmentId);
  const body = drawer(`<div class="dh"><div class="muted small">🔧 Заявка мастеру</div><h2>${esc(r.title)}</h2><div class="row">${wrBadge(r.status)}${r.priority === 'high' ? '<span class="chip red">срочно</span>' : ''}</div></div>
    <section class="ds"><dl class="kv"><dt>Квартира</dt><dd>${esc(a?.title || '')}</dd><dt>Дата</dt><dd>${fmtDay(r.date)}</dd></dl></section>
    <button class="btn primary" data-wr="${r.id}">Открыть заявку — сметы, фото, журнал</button>`);
  body.onclick = (e) => { if (e.target.closest('[data-wr]')) { closeDrawer(); go('repairs', id); } };
}
async function requestedTransferCard(transferId) {
  const list = await api('/api/admin/transfers?from=' + isoAdd(todayIso(), -60));
  const t = list.find(x => x.id === transferId); if (!t) return toast('Трансфер не найден', true);
  if (t.job) return transferCard(t.job.id);
  const body = drawer(`<div class="dh"><div class="muted small">🚗 Трансфер${t.booking ? ` · бронь №${t.booking.number}` : ''}</div><h2>${DIR[t.direction]} · ${fmtDay(t.date.slice(0, 10))}, ${t.time}</h2><div class="row">${badge(TR_ST, trStatus(t))}</div></div>
    <div class="alert violet">${t.booking?.status === 'request' ? 'Заказ водителям создастся автоматически, как только вы подтвердите бронь.' : 'Заказ водителям ещё не создан.'}</div>
    <section class="ds"><dl class="kv">${t.flight ? `<dt>Рейс</dt><dd>${esc(t.flight)}</dd>` : ''}<dt>Гость</dt><dd>${esc(t.guestName || '—')} ${t.guestPhone ? '· ' + esc(t.guestPhone) : ''}</dd><dt>Пассажиры</dt><dd>${t.pax} · багаж ${t.bags}${t.childSeats ? ` · кресел: ${t.childSeats}` : ''}</dd><dt>Цена</dt><dd>${money(t.priceKzt)}</dd></dl></section>
    <div class="row">${t.bookingId ? `<button class="btn" data-open="bk:${t.bookingId}">Открыть бронь</button>` : ''}${t.status !== 'cancelled' ? '<button class="btn primary" data-act="dispatch">Отправить водителям сейчас</button>' : ''}</div>`);
  body.onclick = guard(async (e) => {
    const o = e.target.closest('[data-open]'); if (o) return openItem(o.dataset.open);
    if (e.target.closest('[data-act=dispatch]')) { const j = await api(`/api/admin/transfers/${t.id}/dispatch`, { method: 'POST' }); toast('Заказ предложен всем водителям'); await transferCard(j.id); refresh(); }
  });
}
const PAY_RULE = { account: 'по настройке аккаунта', driver: 'ставка водителя', manual: 'задано вручную' };
async function transferCard(id) {
  const [j, drivers, settings] = await Promise.all([api('/api/admin/transfer-jobs/' + id), api('/api/admin/drivers'), S.settings ? Promise.resolve(S.settings) : api('/api/admin/settings')]);
  S.job = j; S.drivers = drivers; S.settings = settings; drawTransferCard();
}
function driverOptions(j) {
  const cur = j.driver ? `${j.driver.kind === 'user' ? 'u' : 'c'}:${j.driver.id}` : '';
  return `<option value="">— выберите водителя —</option><optgroup label="Команда">${S.drivers.team.map(d => `<option value="u:${d.userId}" ${cur === 'u:' + d.userId ? 'selected' : ''}>${esc(d.name)} · ${ROLE[d.role]}${d.vehicle ? ' · ' + esc(d.vehicle.split(',')[0]) : ''}${d.activeJobs ? ` · в работе ${d.activeJobs}` : ''}</option>`).join('')}</optgroup>
    ${S.drivers.external.length ? `<optgroup label="Внешние (по ссылке)">${S.drivers.external.map(c => `<option value="c:${c.contractorId}" ${cur === 'c:' + c.contractorId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''}`;
}
function drawTransferCard() {
  const j = S.job; const open = !['DONE', 'CANCELLED'].includes(j.status);
  const canAssign = ['OFFERED', 'UNASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(j.status);
  const next = { ACCEPTED: ['en-route', 'выехал'], EN_ROUTE: ['arrived', 'на месте'], ARRIVED: ['picked-up', 'гость в машине'], PICKED_UP: ['done', 'выполнен'] }[j.status];
  const flightUrl = j.flight ? `https://www.flightradar24.com/data/flights/${encodeURIComponent(j.flight.replace(/\s+/g, '').toLowerCase())}` : null;
  const body = drawer(`<div class="dh"><div class="muted small">🚗 Трансфер${j.booking ? ` · бронь №${j.booking.number}` : ''}${j.apartment ? ` · ${esc(j.apartment.title)}` : ''}</div>
      <h2>${DIR[j.direction]} · ${fmtDay(j.date)}, ${j.time}</h2><div class="row">${badge(TR_ST, j.status)}${j.paid ? '<span class="chip green">оплачено водителю</span>' : ''}</div></div>
    ${j.status === 'UNASSIGNED' ? '<div class="alert red">Никто из водителей не взял заказ. Назначьте водителя вручную ниже.</div>' : j.status === 'OFFERED' ? `<div class="alert amber">Заказ предложен всем водителям (${S.drivers.team.length + ' чел.'}). Кто первым нажмёт «Беру», тот и везёт. Если никто не возьмёт — придёт сигнал.</div>` : ''}
    <section class="ds"><h3>Маршрут</h3><div class="route"><div><i></i>${esc(j.from)}</div><div><i class="end"></i>${esc(j.to)}</div></div>
      <dl class="kv">${j.flight ? `<dt>Рейс</dt><dd><b>${esc(j.flight)}</b> · <a href="${flightUrl}" target="_blank" rel="noopener">проверить рейс ↗</a></dd>` : ''}${j.meetingPoint ? `<dt>Где встречать</dt><dd>${esc(j.meetingPoint)}</dd>` : ''}
      ${j.flightStatus ? `<dt>Статус рейса</dt><dd>${esc(j.flightStatus)}${j.flightEta ? `, прилёт ~${hmOf(j.flightEta)}` : ''} <span class="muted small">(проверено ${hmOf(j.flightCheckedAt)})</span></dd>` : ''}<dt>Табличка</dt><dd>${esc(j.sign || '—')}</dd><dt>Ожидание</dt><dd>бесплатно ${j.freeWaitMin} мин${j.arrivedAt ? ` · водитель на месте с ${hmOf(j.arrivedAt)}` : ''}</dd></dl></section>
    <section class="ds"><h3>Гость</h3><dl class="kv"><dt>Имя</dt><dd>${esc(j.guestName || '—')}</dd><dt>Телефон</dt><dd>${j.guestPhone ? `<a href="tel:${esc(j.guestPhone.replace(/\s/g, ''))}">${esc(j.guestPhone)}</a>` : '—'}</dd>
      <dt>Пассажиры</dt><dd>${j.pax} · багаж ${j.bags}${j.childSeats ? ` · детских кресел: ${j.childSeats}` : ''}</dd>${j.notes ? `<dt>Заметки</dt><dd>${esc(j.notes)}</dd>` : ''}</dl></section>
    <section class="ds"><h3>Водитель</h3>
      ${j.driver ? `<div class="driver"><b>${esc(j.driver.name)}</b>${j.driver.kind === 'contractor' ? ' <span class="chip">внешний</span>' : ''}<div class="muted small">${esc(j.vehicle || '')}${j.driver.phone ? ` · <a href="tel:${esc(j.driver.phone.replace(/\s/g, ''))}">${esc(j.driver.phone)}</a>` : ''}</div>${j.etaAt && j.status === 'EN_ROUTE' ? `<div class="small">Будет примерно в <b>${hmOf(j.etaAt)}</b></div>` : ''}</div>` : '<div class="muted">Пока никто не взял</div>'}
      ${j.link ? `<div class="small" style="margin-top:6px">Ссылка для внешнего водителя (отправьте ему): <a href="${esc(j.link.url)}" target="_blank" rel="noopener" style="word-break:break-all">${esc(j.link.url)}</a> <button class="btn sm" data-act="copy">Скопировать</button></div>` : ''}
      ${canAssign ? `<div class="row" style="margin-top:10px"><select id="trDriver" class="grow">${driverOptions(j)}</select><button class="btn sm primary" data-act="assign">${j.driver ? 'Заменить' : 'Назначить'}</button></div>` : ''}
      <div class="row" style="margin-top:8px">${next ? `<button class="btn sm" data-act="step" data-step="${next[0]}">Отметить за водителя: ${next[1]}</button>` : ''}${['UNASSIGNED', 'ACCEPTED'].includes(j.status) ? `<button class="btn sm" data-act="offer">${j.status === 'ACCEPTED' ? 'Снять водителя и предложить всем' : 'Предложить всем ещё раз'}</button>` : ''}</div></section>
    <section class="ds"><h3>Деньги</h3>
      <dl class="kv money-kv"><dt>Цена для гостя</dt><dd>${money(j.priceKzt)}</dd><dt>Комиссия бизнеса</dt><dd>${j.commissionKzt != null ? money(j.commissionKzt) : '—'}${j.priceKzt && j.commissionKzt != null ? ` <span class="muted small">(${Math.round(j.commissionKzt / j.priceKzt * 100)}%)</span>` : ''}</dd>
        <dt>Водителю</dt><dd><b>${j.payoutKzt != null ? money(j.payoutKzt) : '—'}</b> <span class="muted small">${PAY_RULE[j.payoutRule] || ''}</span>${j.paid ? ' <span class="chip green">оплачено</span>' : ''}</dd></dl>
      ${S.settings && !S.settings.commissionConfigured ? `<div class="alert amber small">Комиссия не настроена — водитель получает 100% цены. ${S.me.role === 'owner' ? '<a href="#settings">Настроить →</a>' : 'Настраивает владелец.'}</div>` : ''}
      ${j.status !== 'CANCELLED' && !j.paid ? `<div class="row" style="margin-top:8px"><input id="trPay" type="number" min="0" step="500" value="${j.payoutKzt ?? ''}" style="max-width:130px" aria-label="Выплата водителю"><span class="muted">₸</span><button class="btn sm" data-act="pay">Задать вручную</button>${j.payoutManual ? '<button class="btn sm" data-act="auto">По правилам</button>' : ''}</div>` : ''}
      <div class="row" style="margin-top:8px">${j.status === 'DONE' ? `<button class="btn sm ${j.paid ? '' : 'success'}" data-act="paid">${j.paid ? 'Снять «оплачено»' : 'Оплачено водителю'}</button>` : '<span class="muted small">«Оплачено» — после выполнения; выплата и комиссия попадут в финансы</span>'}</div></section>
    ${open && j.status !== 'PICKED_UP' ? `<details class="ds"><summary>Изменить время, рейс, место встречи</summary><div class="grid g3" style="margin-top:10px"><label>Дата<input id="trDate" type="date" value="${j.date}"></label><label>Время<input id="trTime" type="time" value="${j.time}"></label><label>Рейс<input id="trFlight" value="${esc(j.flight || '')}"></label>
      <label style="grid-column:1/-1">Где встречать<input id="trMeet" value="${esc(j.meetingPoint || '')}" placeholder="Зал прилёта, выход 3, у кофейни"></label></div><div class="row" style="margin-top:8px"><button class="btn sm primary" data-act="save">Сохранить${j.driver ? ' — водитель получит уведомление' : ''}</button></div></details>` : ''}
    <section class="ds"><h3>Журнал</h3><ul class="wr-log">${[...j.events].reverse().map(e => `<li><b>${TR_EV[e.type] || e.type}</b>${e.actorName ? ` — ${esc(e.actorName)}` : ''}<div class="muted small">${fmtTime(e.createdAt)}${e.note ? ' · ' + esc(e.note) : ''}${e.data?.before ? ` · ${esc(e.data.before)} → ${esc(e.data.after)}` : ''}${e.data?.etaMinutes ? ` · ETA ${e.data.etaMinutes} мин` : ''}${e.data?.driver ? ` · ${esc(e.data.driver)}` : ''}</div></li>`).join('')}</ul></section>
    ${open ? '<div class="row"><button class="btn sm danger" data-act="cancel">Отменить заказ</button></div>' : j.cancelReason ? `<div class="muted small">Причина отмены: ${esc(j.cancelReason)}</div>` : ''}`);
  body.onclick = guard(async (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const url = `/api/admin/transfer-jobs/${j.id}`; let msg = 'Сохранено';
    if (a.dataset.act === 'assign') {
      const v = $('#trDriver').value; if (!v) return toast('Выберите водителя', true);
      const [k, id] = v.split(':'); S.job = await api(url + '/assign', { method: 'POST', body: k === 'u' ? { driverUserId: id } : { driverContractorId: id } }); msg = `Назначен: ${S.job.driver.name}`;
    } else if (a.dataset.act === 'offer') { S.job = await api(url + '/offer', { method: 'POST' }); msg = 'Заказ снова предложен всем водителям'; }
    else if (a.dataset.act === 'step') { S.job = await api(url + '/status', { method: 'POST', body: { action: a.dataset.step } }); msg = TR_ST[S.job.status][1]; }
    else if (a.dataset.act === 'pay') { if ($('#trPay').value === '') return toast('Укажите сумму водителю', true); S.job = await api(url, { method: 'PATCH', body: { payoutKzt: +$('#trPay').value } }); msg = 'Выплата водителю задана вручную'; }
    else if (a.dataset.act === 'auto') { S.job = await api(url, { method: 'PATCH', body: { payoutAuto: true } }); msg = 'Выплата пересчитана по правилам'; }
    else if (a.dataset.act === 'copy') { return copyText(j.link.url); }
    else if (a.dataset.act === 'paid') { S.job = await api(url + '/paid', { method: 'POST', body: { paid: !j.paid } }); msg = S.job.paid ? 'Отмечено: оплачено водителю' : 'Отметка снята'; }
    else if (a.dataset.act === 'save') {
      const body = { date: $('#trDate').value, time: $('#trTime').value, flight: $('#trFlight').value.trim() || null, meetingPoint: $('#trMeet').value.trim() || null };
      if (body.date === j.date) delete body.date; if (body.time === j.time) delete body.time;
      S.job = await api(url, { method: 'PATCH', body }); msg = 'Изменения сохранены';
    } else if (a.dataset.act === 'cancel') { const reason = prompt('Причина отмены (водитель увидит):', ''); if (reason === null) return; S.job = await api(url + '/cancel', { method: 'POST', body: { reason: reason || undefined } }); msg = 'Заказ отменён'; }
    toast(msg); S.drivers = await api('/api/admin/drivers'); drawTransferCard(); refresh();
  });
}

// ---------------- трансферы (диспетчерская) ----------------
const TR_TABS = [['need', 'Нужно действие', ['UNASSIGNED', 'OFFERED']], ['assigned', 'Назначены', ['ACCEPTED']], ['live', 'Сейчас в пути', ['EN_ROUTE', 'ARRIVED', 'PICKED_UP']], ['done', 'Выполнены', ['DONE']], ['cancelled', 'Отменены', ['CANCELLED']], ['all', 'Все', null]];
async function renderTransfers(openId) {
  const r = await api('/api/admin/transfer-jobs?from=' + isoAdd(todayIso(), -14));
  const items = r.items; S.trCount = items.filter(x => x.status === 'UNASSIGNED').length; renderNav();
  const inTab = (t) => (x) => !t[2] || t[2].includes(x.status);
  const tab = TR_TABS.find(t => t[0] === S.trTab) || TR_TABS[items.some(inTab(TR_TABS[0])) ? 0 : 1];
  const rows = items.filter(inTab(tab));
  const unpaid = items.filter(x => x.status === 'DONE' && !x.paid).reduce((s, x) => s + (x.payoutKzt || 0), 0);
  view(`<div class="page-head"><div><h1>Трансферы</h1><p class="sub">Как в Uber: подтверждённая бронь с трансфером сразу предлагается всем, кто водит; первый «Беру» получает заказ. Никто не взял за ${30} мин или до подачи меньше 3 ч — придёт сигнал, назначьте вручную.</p></div></div>
    <div class="row" style="margin-bottom:12px"><div class="tabs scroll">${TR_TABS.map(t => `<button class="${t === tab ? 'active' : ''}" data-tab="${t[0]}">${t[1]} · ${items.filter(inTab(t)).length}</button>`).join('')}</div>${unpaid ? `<span class="chip amber">к выплате водителям: ${money(unpaid)}</span>` : ''}</div>
    <div class="card">${rows.length ? `<div class="table-wrap"><table class="t tr-table"><thead><tr><th>Когда</th><th>Маршрут</th><th>Гость</th><th>Водитель</th><th>Статус</th><th>Цена · водителю</th></tr></thead><tbody>
    ${rows.map(x => `<tr class="click" data-open="tr:${x.id}:${x.transferId}"><td style="white-space:nowrap"><b>${fmtDay(x.date)}, ${x.time}</b><div class="muted small">${DIR[x.direction]}${x.flight ? ' · ' + esc(x.flight) : ''}</div></td>
      <td><div class="small">${esc(x.from)}</div><div class="small">→ ${esc(x.to)}</div></td><td>${esc(x.guestName || '—')}<div class="muted small">${x.pax} пасс.${x.bookingNumber ? ` · бронь №${x.bookingNumber}` : ''}</div></td>
      <td>${esc(x.driverName || '—')}</td><td>${badge(TR_ST, x.status)}</td><td style="white-space:nowrap">${x.priceKzt != null ? `<b>${money(x.priceKzt)}</b>` : '—'}<div class="muted small">водителю ${x.payoutKzt != null ? money(x.payoutKzt) : '—'}${x.paid ? ' · оплачено' : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Здесь пусто</div>'}</div>
    ${legend()}`);
  $('#view').onclick = (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { S.trTab = t.dataset.tab; return renderTransfers(); }
    const o = e.target.closest('[data-open]'); if (o) openItem(o.dataset.open);
  };
  if (openId) transferCard(openId).catch(err => toast(err.message, true));
}

// ---------------- старт ----------------
api('/api/auth/session').then(me => { if (!me.authenticated || !['owner', 'admin'].includes(me.role)) return showLogin(); start(me); api('/api/admin/bookings?status=request').then(r => { S.reqCount = r.length; renderNav(); }).catch(() => {}); api('/api/admin/repairs').then(r => { S.wrCount = r.filter(x => x.pendingEstimate || x.pendingExtras).length; renderNav(); }).catch(() => {}); api('/api/admin/transfer-jobs?status=UNASSIGNED').then(r => { S.trCount = r.items.length; renderNav(); }).catch(() => {}); }).catch(() => showLogin());
