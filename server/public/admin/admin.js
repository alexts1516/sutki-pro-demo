// Админка владельца: квартиры и фото, тексты сайта, бренд и логотип, брони, заявки мастерам, команда, журнал уведомлений.
// Обычный JavaScript без сборки. Все данные — через REST API сервера (/api/admin/...).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₸';
const fmtDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][m - 1]}`; };
const ROLE = { owner: 'Владелец', admin: 'Администратор', cleaning: 'Клининг', master: 'Мастер' };
const SRC = { site: 'Сайт', airbnb: 'Airbnb', booking: 'Booking', telegram: 'Telegram', whatsapp: 'WhatsApp', direct: 'Напрямую' };
const S = { me: null, view: 'apartments', apt: null, txLang: 'ru', texts: null, brand: null, drag: null };

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

const VIEWS = [['apartments', '🏠', 'Квартиры и фото'], ['bookings', '📅', 'Брони и заявки'], ['repairs', '🛠', 'Заявки мастерам'], ['texts', '✏️', 'Тексты сайта'], ['brand', '🎨', 'Бренд и логотип'], ['team', '👥', 'Команда и Telegram'], ['notifications', '🔔', 'Уведомления']];
function start(me) {
  S.me = me; $('#login').hidden = true; $('#app').hidden = false;
  $('#accName').textContent = me.account.name;
  $('#userBox').innerHTML = `<b>${esc(me.user.name)}</b>${esc(ROLE[me.role])}`;
  const [v, id] = location.hash.slice(1).split('/');
  go(VIEWS.some(x => x[0] === v) ? v : 'apartments', id);
}
function renderNav() {
  $('#nav').innerHTML = VIEWS.map(([k, i, l]) => `<button class="${S.view === k ? 'active' : ''}" data-nav="${k}"><span>${i}</span>${l}${k === 'bookings' && S.reqCount ? `<span class="cnt">${S.reqCount}</span>` : ''}${k === 'repairs' && S.wrCount ? `<span class="cnt">${S.wrCount}</span>` : ''}</button>`).join('');
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) go(b.dataset.nav); });
function go(view, id) {
  S.view = view; renderNav(); $('#sidebar').classList.remove('open');
  $('#crumb').textContent = VIEWS.find(v => v[0] === view)[2];
  history.replaceState(null, '', '#' + view + (id ? '/' + id : ''));
  window.scrollTo(0, 0);
  guard(async () => {
    if (view === 'apartments') return id ? openApartment(id) : renderApartments();
    if (view === 'repairs') return id ? (id === 'new' ? newRepair() : openRepair(id)) : renderRepairs();
    return ({ bookings: renderBookings, texts: renderTexts, brand: renderBrand, team: renderTeam, notifications: renderNotifications })[view]();
  })();
}
const view = (html) => { $('#view').innerHTML = html; };
window.addEventListener('hashchange', () => { if (!S.me) return; const [v, id] = location.hash.slice(1).split('/'); if (VIEWS.some(x => x[0] === v)) go(v, id); });

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
  const pay = { paid: ['green', 'Оплачено'], prepaid: ['amber', 'Предоплата'], unpaid: ['red', 'Не оплачено'], refunded: ['', 'Возврат'] };
  const st = { request: ['violet', 'Заявка'], confirmed: ['green', 'Подтверждена'], cancelled: ['', 'Отменена'], completed: ['', 'Завершена'] };
  const row = (b, actions) => `<tr><td><b>№${b.number}</b><div class="muted small">${SRC[b.source] || b.source}</div></td><td>${esc(b.guest?.name || '—')}<div class="muted small">${esc(b.guest?.phone || '')}${b.guest?.telegramLinked ? ' · Telegram ✓' : ''}</div></td>
    <td>${esc(b.apartment?.title || '')}</td><td style="white-space:nowrap">${fmtDay(b.checkIn)} → ${fmtDay(b.checkOut)}<div class="muted small">${b.guestsCount} гост.</div></td><td style="white-space:nowrap">${money(b.totalKzt)}${b.currencyShown !== 'KZT' && b.amountShown ? `<div class="muted small">гость видел ${b.amountShown} ${b.currencyShown}</div>` : ''}</td>
    <td><span class="chip ${st[b.status][0]}">${st[b.status][1]}</span> <span class="chip ${pay[b.paymentStatus][0]}">${pay[b.paymentStatus][1]}</span></td><td>${actions || ''}</td></tr>`;
  view(`<div class="page-head"><div><h1>Брони и заявки</h1><p class="sub">Подтверждение заявки отправит гостю сообщение в Telegram (если он подключил бота по ссылке)</p></div></div>
    <div class="stack"><div class="card"><div class="card-h"><h2>Новые заявки · ${req.length}</h2></div>${req.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Бронь</th><th>Гость</th><th>Квартира</th><th>Даты</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody>
      ${req.map(b => row(b, `<div class="row"><button class="btn sm success" data-confirm="${b.id}">Подтвердить</button><button class="btn sm" data-cancel="${b.id}">Отклонить</button></div>`)).join('')}</tbody></table></div>` : '<div class="empty">Новых заявок нет</div>'}</div>
    <div class="card"><div class="card-h"><h2>Ближайшие брони</h2><span class="muted small">неделя назад — 2 месяца вперёд</span></div><div class="table-wrap"><table class="t"><thead><tr><th>Бронь</th><th>Гость</th><th>Квартира</th><th>Даты</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody>
      ${list.filter(b => b.status !== 'request').slice(0, 150).map(b => row(b)).join('')}</tbody></table></div></div></div>`);
  $('#view').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.confirm) { const x = await api(`/api/admin/bookings/${b.dataset.confirm}/confirm`, { method: 'POST' }); toast(`Бронь №${x.number} подтверждена`); renderBookings(); }
    if (b.dataset.cancel) { if (!confirm('Отклонить заявку?')) return; const x = await api(`/api/admin/bookings/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast(`Заявка №${x.number} отклонена`); renderBookings(); }
  });
}

// ---------------- заявки мастерам ----------------
const WR_ST = { NEW: ['violet', 'Новая'], VISIT_INSPECTION: ['blue', 'Выезд / осмотр'], AWAITING_OWNER_APPROVAL: ['amber', 'Ожидает подтверждения хозяина'], REJECTED: ['red', 'Смета отклонена'],
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
    ${e.status === 'pending' && t.status === 'AWAITING_OWNER_APPROVAL' ? `<div class="row" style="margin-top:8px"><button class="btn sm success" data-est-ok="${e.id}">Одобрить смету</button><button class="btn sm" data-est-no="${e.id}">Отклонить…</button></div>` : ''}</div>`;
  const extra = (x) => `<div class="wr-item"><div class="row"><b class="grow">${money(x.amountKzt)} · ${esc(x.description)}</b>${x.status === 'PENDING' ? '<span class="chip amber">ждёт решения</span>' : x.status === 'APPROVED' ? '<span class="chip green">одобрен</span>' : '<span class="chip red">отклонён</span>'}</div>
    <div class="muted small">Почему: ${esc(x.reason)} · ${esc(x.byName || '')} · ${fmtTime(x.createdAt)}</div>${x.photos.length ? `<div class="wr-photos sm">${x.photos.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="background-image:url('${esc(p.url)}')"></a>`).join('')}</div>` : ''}
    ${x.decisionNote ? `<div class="small">💬 ${esc(x.decisionNote)}</div>` : ''}
    ${x.status === 'PENDING' && !t.paid && t.status !== 'CANCELLED' ? `<div class="row" style="margin-top:8px"><button class="btn sm success" data-x-ok="${x.id}">Одобрить</button><button class="btn sm" data-x-no="${x.id}">Отклонить…</button></div>` : ''}</div>`;
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
      ${t.link && open ? `<div class="card"><div class="card-h"><h2>Ссылка без входа</h2></div><div class="card-b small"><div class="muted">Для подрядчика без аккаунта (страница для ссылки — следующий шаг, сейчас это адрес API)</div><code style="word-break:break-all">${esc(t.link.api)}</code><div><button class="btn sm" id="wrLink" style="margin-top:8px">Выпустить новую ссылку</button></div></div></div>` : ''}
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
  view(`<div class="page-head"><div><h1>Команда и Telegram</h1><p class="sub">Чтобы получать уведомления, каждый открывает свою ссылку-приглашение в Telegram (нужен бот — см. README_SERVER.md)</p></div></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Сотрудник</th><th>Роль</th><th>Доступ</th><th>Telegram</th><th></th></tr></thead><tbody>
    ${list.map(m => `<tr><td><b>${esc(m.name)}</b><div class="muted small">${esc(m.email || m.phone || '')}</div></td><td>${ROLE[m.role]}</td><td>${m.active ? '<span class="chip green">включён</span>' : '<span class="chip">отключён</span>'}</td>
      <td>${m.telegramLinked ? '<span class="chip green">подключён</span>' : '<span class="chip amber">не подключён</span>'}</td><td><button class="btn sm" data-invite="${m.userId}">Ссылка для Telegram</button><div class="muted small" id="inv-${m.userId}"></div></td></tr>`).join('')}</tbody></table></div></div>`);
  $('#view').onclick = guard(async (e) => {
    const b = e.target.closest('[data-invite]'); if (!b) return;
    const r = await api(`/api/admin/team/${b.dataset.invite}/telegram-invite`, { method: 'POST' });
    $('#inv-' + b.dataset.invite).innerHTML = r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link)}</a>` : `Код: <code>/start ${esc(r.payload)}</code> — бот ещё не настроен (нет TELEGRAM_BOT_USERNAME)`;
  });
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

// ---------------- старт ----------------
api('/api/auth/session').then(me => { if (!me.authenticated || !['owner', 'admin'].includes(me.role)) return showLogin(); start(me); api('/api/admin/bookings?status=request').then(r => { S.reqCount = r.length; renderNav(); }).catch(() => {}); api('/api/admin/repairs').then(r => { S.wrCount = r.filter(x => x.pendingEstimate || x.pendingExtras).length; renderNav(); }).catch(() => {}); }).catch(() => showLogin());
