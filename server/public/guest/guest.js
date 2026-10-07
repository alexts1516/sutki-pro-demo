const $ = selector => document.querySelector(selector);
const slug = document.body.dataset.account;
const state = { apartments: [], selected: null, quote: null, submitting: false, operationKey: null, operationFingerprint: null };
const money = value => `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const isoAfter = days => { const date = new Date(); date.setHours(12,0,0,0); date.setDate(date.getDate()+days); return date.toISOString().slice(0,10); };

async function api(path, options = {}) {
  const response = await fetch(`/api/public/${encodeURIComponent(slug)}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Сервис временно недоступен');
  return data;
}

function applySite(site) {
  const brand = site.brand || {}, texts = site.texts?.ru || {};
  document.title = `${brand.name || site.account.name} · ${brand.taglineRu || 'Apart Hotel'}`;
  $('#brandName').textContent = brand.name || site.account.name;
  $('#brandTagline').textContent = brand.taglineRu || 'Apart Hotel';
  $('#brandMark').textContent = brand.short || 'TA';
  $('#heroTitle').textContent = texts['hero.title'] || 'Апартаменты в Астане';
  $('#heroSubtitle').textContent = texts['hero.subtitle'] || '';
  $('#catalogTitle').textContent = texts['catalog.title'] || 'Наши квартиры';
  $('#footerAbout').textContent = texts['footer.about'] || brand.name || site.account.name;
  if (brand.phone) { $('#footerPhone').textContent = brand.phone; $('#footerPhone').href = `tel:${brand.phone.replace(/[^+\d]/g,'')}`; }
  const colors = brand.colors || {};
  for (const [name,value] of Object.entries({brand:colors.brand,brand2:colors.brand2,accent:colors.accent})) if (value) document.documentElement.style.setProperty(`--${name}`,value);
  if (brand.logoUrl) { const image = document.createElement('img'); image.src=brand.logoUrl; image.alt=''; image.onload=()=>{ $('#brandMark').textContent=''; $('#brandMark').append(image); }; }
}

function query() {
  return { checkIn:$('#checkIn').value, checkOut:$('#checkOut').value, guests:Number($('#guests').value), pets:$('#pets').checked };
}

function datesValid() {
  const {checkIn,checkOut}=query(); return checkIn && checkOut && checkOut>checkIn;
}

function card(apartment) {
  const image = apartment.cover?.url ? `<img src="${escapeHtml(apartment.cover.url)}" alt="${escapeHtml(apartment.cover.caption || apartment.title)}">` : '';
  const available = apartment.available !== false;
  const preview = apartment.quote ? `<strong>${money(apartment.quote.totalKzt)}</strong><span>${apartment.quote.nights} ноч. · ${money(apartment.quote.nightlyKzt)} за ночь${apartment.quote.petFeeKzt ? ` · питомец ${money(apartment.quote.petFeeKzt)}`:''}</span>` : `<strong>от ${money(apartment.basePriceKzt)}</strong><span>за ночь</span>`;
  return `<article class="apartment${state.selected===apartment.ref?' selected':''}" data-ref="${escapeHtml(apartment.ref)}">
    <div class="photo">${image}<span class="availability${available?'':' busy'}">${available?'Свободна':'Занята на эти даты'}</span></div>
    <div class="apartment-body"><div><h3>${escapeHtml(apartment.title)}</h3><div class="meta"><span>${escapeHtml(apartment.rooms)}</span><span>до ${apartment.maxGuests} гостей</span>${apartment.areaM2?`<span>${apartment.areaM2} м²</span>`:''}</div></div>
    ${apartment.description?`<p class="description">${escapeHtml(apartment.description)}</p>`:''}<div class="price">${preview}</div>
    <button class="choose" type="button" data-choose="${escapeHtml(apartment.ref)}" ${available?'':'disabled'}>${state.selected===apartment.ref?'Выбрано':'Выбрать'}</button></div></article>`;
}

function renderCatalog() {
  $('#catalog').innerHTML = state.apartments.length ? state.apartments.map(card).join('') : '<div class="empty">На выбранные параметры квартир не найдено.</div>';
  document.querySelectorAll('[data-choose]').forEach(button => button.addEventListener('click',()=>selectApartment(button.dataset.choose)));
}

async function loadCatalog() {
  if (!datesValid()) { $('#catalogStatus').textContent='Проверьте даты'; return; }
  $('#catalogStatus').textContent='Проверяем свободные даты…'; $('#search').disabled=true;
  try {
    const params = new URLSearchParams({...query(),pets:query().pets?'1':'0'});
    state.apartments = await api(`/apartments?${params}`);
    if (!state.apartments.some(a=>a.ref===state.selected && a.available)) state.selected = null;
    renderCatalog(); $('#catalogStatus').textContent = `${state.apartments.filter(a=>a.available).length} свободно`;
    if (state.selected) await loadQuote(); else clearQuote();
  } catch (error) { $('#catalog').innerHTML=`<div class="load-error">${escapeHtml(error.message)}</div>`; $('#catalogStatus').textContent='Не удалось загрузить'; clearQuote(); }
  finally { $('#search').disabled=false; }
}

function clearQuote() {
  state.quote=null; $('#quote').hidden=true; $('#selection').textContent='Выберите свободную квартиру из каталога.'; $('#checkoutButton').disabled=true;
}

async function selectApartment(ref) {
  state.selected=ref; renderCatalog(); await loadQuote(); $('#checkout').scrollIntoView({behavior:'smooth',block:'start'});
}

async function loadQuote() {
  const apartment=state.apartments.find(a=>a.ref===state.selected); if(!apartment)return clearQuote();
  $('#selection').textContent=`${apartment.title} · ${apartment.rooms}`; $('#quote').hidden=false; $('#quote').textContent='Сервер проверяет цену и доступность…'; $('#checkoutButton').disabled=true;
  try {
    const params=new URLSearchParams({...query(),pets:query().pets?'1':'0'}); state.quote=await api(`/apartments/${encodeURIComponent(state.selected)}/quote?${params}`);
    const q=state.quote; $('#quote').innerHTML=`<div class="quote-row"><span>${escapeHtml(q.checkIn)} → ${escapeHtml(q.checkOut)}</span><strong>${q.nights} ноч.</strong></div><div class="quote-row"><span>${money(q.nightlyKzt)} × ${q.nights}</span><strong>${money(q.nightlyKzt*q.nights)}</strong></div>${q.petFeeKzt?`<div class="quote-row"><span>Питомец</span><strong>${money(q.petFeeKzt)}</strong></div>`:''}<div class="quote-row total"><span>Итого</span><strong data-testid="quote-total">${money(q.totalKzt)}</strong></div>`;
    if(!q.available){$('#quote').insertAdjacentHTML('beforeend','<div class="result error">Эти даты уже заняты. Выберите другие даты.</div>');}
    $('#checkoutButton').disabled=!q.available;
  } catch(error){state.quote=null;$('#quote').innerHTML=`<div class="result error">${escapeHtml(error.message)}</div>`;}
}

function operationFingerprint(body) { return JSON.stringify(body); }
async function checkoutOperation(body) {
  const fingerprint=operationFingerprint(body);
  if(!state.operationKey || state.operationFingerprint!==fingerprint){const issued=await api('/operation-key',{method:'POST'});state.operationKey=issued.operationKey;state.operationFingerprint=fingerprint;}
  return api('/bookings',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':state.operationKey},body:JSON.stringify(body)});
}

$('#checkoutForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(state.submitting || !state.selected || !state.quote?.available)return;
  if(!event.currentTarget.reportValidity())return;
  state.submitting=true;$('#checkoutButton').disabled=true;$('#checkoutButton').textContent='Удерживаем даты…';$('#checkoutResult').innerHTML='';
  const selected=state.apartments.find(a=>a.ref===state.selected),values=query();
  const body={apartmentId:state.selected,checkIn:values.checkIn,checkOut:values.checkOut,guests:values.guests,pets:values.pets,name:$('#guestName').value.trim(),phone:$('#guestPhone').value.trim(),email:$('#guestEmail').value.trim(),comment:$('#guestComment').value.trim(),paymentMethod:'card'};
  try{
    const booking=await checkoutOperation(body);
    $('#checkoutResult').innerHTML=`<div class="result success" data-testid="hold-created"><strong>Даты временно удерживаются</strong>${escapeHtml(selected.title)}, ${escapeHtml(booking.checkIn)} → ${escapeHtml(booking.checkOut)} · ${booking.nights} ноч. · ${money(booking.totalKzt)}.<br>Даты временно удерживаются за вами до ${new Date(booking.holdUntil).toLocaleString('ru-RU')}. Завершите оплату, чтобы подтвердить бронирование.<br><span class="muted">Платёжный шаг пока не подключён.</span></div>`;
  }catch(error){$('#checkoutResult').innerHTML=`<div class="result error">${escapeHtml(error.message)}</div>`;if(/занят|недоступ/i.test(error.message))await loadCatalog();}
  finally{state.submitting=false;$('#checkoutButton').textContent='Перейти к оплате';$('#checkoutButton').disabled=!state.quote?.available;}
});

$('#search').addEventListener('click',loadCatalog);
for(const selector of ['#checkIn','#checkOut','#guests','#pets']) $(selector).addEventListener('change',()=>{state.operationKey=null;state.operationFingerprint=null;loadCatalog();});

async function init(){
  $('#checkIn').min=isoAfter(0);$('#checkOut').min=isoAfter(1);$('#checkIn').value=isoAfter(3);$('#checkOut').value=isoAfter(5);
  try{applySite(await api('/site'));await loadCatalog();}catch(error){$('#catalog').innerHTML=`<div class="load-error">${escapeHtml(error.message)}</div>`;$('#catalogStatus').textContent='Сайт временно недоступен';}
}
init();
