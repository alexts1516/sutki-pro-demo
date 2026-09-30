// Админка владельца: квартиры и фото, тексты сайта, бренд и логотип, брони, команда, журнал уведомлений.
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

const VIEWS = [['apartments', '🏠', 'Квартиры и фото'], ['bookings', '📅', 'Брони и заявки'], ['texts', '✏️', 'Тексты сайта'], ['brand', '🎨', 'Бренд и логотип'], ['team', '👥', 'Команда и Telegram'], ['notifications', '🔔', 'Уведомления']];
function start(me) {
  S.me = me; $('#login').hidden = true; $('#app').hidden = false;
  $('#accName').textContent = me.account.name;
  $('#userBox').innerHTML = `<b>${esc(me.user.name)}</b>${esc(ROLE[me.role])}`;
  const [v, id] = location.hash.slice(1).split('/');
  go(VIEWS.some(x => x[0] === v) ? v : 'apartments', id);
}
function renderNav() {
  $('#nav').innerHTML = VIEWS.map(([k, i, l]) => `<button class="${S.view === k ? 'active' : ''}" data-nav="${k}"><span>${i}</span>${l}${k === 'bookings' && S.reqCount ? `<span class="cnt">${S.reqCount}</span>` : ''}</button>`).join('');
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) go(b.dataset.nav); });
function go(view, id) {
  S.view = view; renderNav(); $('#sidebar').classList.remove('open');
  $('#crumb').textContent = VIEWS.find(v => v[0] === view)[2];
  history.replaceState(null, '', '#' + view + (id ? '/' + id : ''));
  window.scrollTo(0, 0);
  guard(async () => {
    if (view === 'apartments') return id ? openApartment(id) : renderApartments();
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
  ['Основное', [['title', 'Название (как видят гости)', 'text', 'ЖК Хайвил, кв. 45'], ['titleEn', 'Название по-английски', 'text', 'Highvill residence, apt 45'], ['code', 'Номер квартиры', 'text'], ['complex', 'Жилой комплекс', 'text'],
    ['address', 'Адрес', 'text', 'пр. Кошкарбаева, 10/1, блок G-1, кв. 45'], ['district', 'Район', 'select', ['Сарайшык', 'Есиль', 'Алматинский', 'Сарыарка', 'Байконур', 'Нура']], ['rooms', 'Комнат', 'select', ['Студия', '1-комн.', '2-комн.', '3-комн.']],
    ['maxGuests', 'Максимум гостей', 'number'], ['areaM2', 'Площадь, м²', 'number'], ['description', 'Описание', 'textarea'], ['descriptionEn', 'Описание по-английски', 'textarea']]],
  ['Цена и правила', [['basePriceKzt', 'Цена за ночь, ₸', 'number'], ['petsAllowed', 'Можно с животными', 'checkbox'], ['petFeeKzt', 'Доплата за животное, ₸', 'number'], ['petNote', 'Условия для животных', 'text', 'до 10 кг, не больше 2'], ['active', 'Показывать на сайте', 'checkbox']]],
  ['Доступ в квартиру (гости видят только в день заезда)', [['entrance', 'Подъезд', 'text'], ['floor', 'Этаж', 'number'], ['intercom', 'Домофон', 'text'], ['lockCode', 'Код замка', 'text'], ['keyboxCode', 'Код ключницы', 'text'], ['wifiName', 'Wi‑Fi сеть', 'text'], ['wifiPassword', 'Wi‑Fi пароль', 'text'], ['accessNote', 'Как пройти, заметки', 'textarea']]],
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
api('/api/auth/session').then(me => { if (!me.authenticated || !['owner', 'admin'].includes(me.role)) return showLogin(); start(me); api('/api/admin/bookings?status=request').then(r => { S.reqCount = r.length; renderNav(); }).catch(() => {}); }).catch(() => showLogin());
