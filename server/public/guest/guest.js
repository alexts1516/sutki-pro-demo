const $ = selector => document.querySelector(selector);
const slug = document.body.dataset.account;
const state = { apartments: [], selected: null, quote: null, submitting: false, operationKey: null, operationFingerprint: null, bookingToken: null, paymentKey: null };
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

function rememberBooking(token) {
  state.bookingToken=token;
  try { sessionStorage.setItem(`guest-payment:${slug}`,token); } catch { /* private mode: текущая вкладка всё ещё продолжит flow */ }
}
function rememberedBooking() {
  if(state.bookingToken)return state.bookingToken;
  try{return sessionStorage.getItem(`guest-payment:${slug}`);}catch{return null;}
}
function paymentMessage(html,kind='success') { $('#checkoutResult').innerHTML=`<div class="result ${kind}" data-testid="payment-state">${html}</div>`; }
function renderServerPayment(result) {
  if(result.bookingStatus==='confirmed') {
    paymentMessage('<strong>Бронирование подтверждено</strong>Оплата проверена сервером. Бронирование подтверждено.');
    return 'confirmed';
  }
  if(['failed','cancelled'].includes(result.payment?.status)) {
    paymentMessage(`<strong>Оплата не завершена</strong>Бронирование не подтверждено. Можно создать новую попытку оплаты.<br><button type="button" class="choose" id="retryPayment">Повторить оплату</button>`,'error');
    $('#retryPayment').addEventListener('click',()=>{state.paymentKey=null;startPayment(rememberedBooking());});
    return 'failed';
  }
  paymentMessage('<strong>Проверяем оплату</strong>Возврат из платёжной формы не подтверждает оплату. Ожидаем проверенный ответ платёжного сервиса.');
  return 'processing';
}
async function refreshPaymentStatus(token,{poll=false,attempt=0}={}) {
  if(!token)return;
  try {
    const result=await api(`/bookings/${encodeURIComponent(token)}/payment`);
    const stateName=renderServerPayment(result);
    if(poll && stateName==='processing' && attempt<90)setTimeout(()=>refreshPaymentStatus(token,{poll:true,attempt:attempt+1}),1000);
  } catch(error) { paymentMessage(escapeHtml(error.message),'error'); }
}
function loadScript(src) {
  return new Promise((resolve,reject)=>{const existing=document.querySelector(`script[src="${CSS.escape(src)}"]`);if(existing){if(existing.dataset.ready)return resolve();existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return;}const script=document.createElement('script');script.src=src;script.onload=()=>{script.dataset.ready='1';resolve();};script.onerror=reject;document.head.append(script);});
}
async function openPayment(intent,token) {
  if(intent.bookingStatus==='confirmed'||intent.paid){await refreshPaymentStatus(token);return;}
  if(intent.type==='redirect'&&intent.url){location.assign(intent.url);return;}
  if(intent.type==='widget'&&intent.script&&intent.params){await loadScript(intent.script);const Widget=window.cp?.CloudPayments;if(!Widget)throw new Error('Платёжная форма не загрузилась');new Widget().start(intent.params);await refreshPaymentStatus(token,{poll:true});return;}
  await refreshPaymentStatus(token,{poll:true});
}
async function startPayment(token) {
  if(!token)return;
  state.submitting=true;$('#checkoutButton').disabled=true;paymentMessage('<strong>Открываем оплату…</strong>Даты остаются временно удержанными.');
  try {
    if(!state.paymentKey){const issued=await api('/operation-key',{method:'POST'});state.paymentKey=issued.operationKey;}
    const intent=await api(`/bookings/${encodeURIComponent(token)}/pay`,{method:'POST',headers:{'Idempotency-Key':state.paymentKey}});
    await openPayment(intent,token);
  } catch(error) { paymentMessage(`<strong>Оплата не запущена</strong>${escapeHtml(error.message)}`,'error'); }
  finally {state.submitting=false;$('#checkoutButton').textContent='Перейти к оплате';$('#checkoutButton').disabled=!state.quote?.available;}
}

$('#checkoutForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(state.submitting || !state.selected || !state.quote?.available)return;
  if(!event.currentTarget.reportValidity())return;
  state.submitting=true;$('#checkoutButton').disabled=true;$('#checkoutButton').textContent='Удерживаем даты…';$('#checkoutResult').innerHTML='';
  const selected=state.apartments.find(a=>a.ref===state.selected),values=query();
  const body={apartmentId:state.selected,checkIn:values.checkIn,checkOut:values.checkOut,guests:values.guests,pets:values.pets,name:$('#guestName').value.trim(),phone:$('#guestPhone').value.trim(),email:$('#guestEmail').value.trim(),comment:$('#guestComment').value.trim(),paymentMethod:'card'};
  try{
    const booking=await checkoutOperation(body);
    rememberBooking(booking.token);
    $('#checkoutResult').innerHTML=`<div class="result success" data-testid="hold-created"><strong>Даты временно удерживаются</strong>${escapeHtml(selected.title)}, ${escapeHtml(booking.checkIn)} → ${escapeHtml(booking.checkOut)} · ${booking.nights} ноч. · ${money(booking.totalKzt)}.<br>Даты временно удерживаются за вами до ${new Date(booking.holdUntil).toLocaleString('ru-RU')}. Завершите оплату, чтобы подтвердить бронирование.</div>`;
    await startPayment(booking.token);
  }catch(error){$('#checkoutResult').innerHTML=`<div class="result error">${escapeHtml(error.message)}</div>`;if(/занят|недоступ/i.test(error.message))await loadCatalog();}
  finally{state.submitting=false;$('#checkoutButton').textContent='Перейти к оплате';$('#checkoutButton').disabled=!state.quote?.available;}
});

$('#search').addEventListener('click',loadCatalog);
for(const selector of ['#checkIn','#checkOut','#guests','#pets']) $(selector).addEventListener('change',()=>{state.operationKey=null;state.operationFingerprint=null;loadCatalog();});

async function init(){
  $('#checkIn').min=isoAfter(0);$('#checkOut').min=isoAfter(1);$('#checkIn').value=isoAfter(3);$('#checkOut').value=isoAfter(5);
  try{applySite(await api('/site'));await loadCatalog();if(new URLSearchParams(location.search).get('payment')==='processing'){const token=rememberedBooking();if(token){$('#checkout').scrollIntoView({block:'start'});await refreshPaymentStatus(token,{poll:true});}else paymentMessage('<strong>Проверяем оплату</strong>Вернитесь к вкладке, где начинали оплату, чтобы увидеть состояние.');}}catch(error){$('#catalog').innerHTML=`<div class="load-error">${escapeHtml(error.message)}</div>`;$('#catalogStatus').textContent='Сайт временно недоступен';}
}
init();
