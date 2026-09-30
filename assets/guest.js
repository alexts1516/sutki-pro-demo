/* Astana Stay — логика демо-сайта для гостей. Данные квартир и занятости — из assets/data.js,
   заявки сохраняются в localStorage (assets/store.js) и появляются у владельца в «Заявках». */
(function(){
'use strict';
const TRANSFER_PRICE = 8000;
const MIN_ISO = isoOf(TODAY), MAX_ISO = '2026-12-31';
const MONTHS_ALLOWED = [8,9,10,11]; // сен–дек 2026 (индексы месяцев)
const G = {ci:null, co:null, guests:2, district:'', maxPrice:0, sort:'pop', rooms:''};
const fav = new Set();
let ST = Store.load();

const PALETTE = [[32,60],[200,45],[160,35],[345,45],[45,55],[255,35],[15,50],[185,40],[95,30],[220,40],[5,45],[280,30]];
const AREA = {'Студия':24,'1-комн.':38,'2-комн.':58,'3-комн.':82};
const ROOMS_FULL = {'Студия':'Студия','1-комн.':'1-комнатная','2-комн.':'2-комнатная','3-комн.':'3-комнатная'};
const LANDMARK = {'Есиль':'рядом с Байтереком','Алматинский':'у парка Жетысу','Сарыарка':'в старом центре','Байконур':'у набережной','Нура':'у ЭКСПО'};
const guestApts = apartments.map(a=>Object.assign({}, a, {
  title: `${ROOMS_FULL[a.rooms]} в ${a.complex}`,
  street: a.address.replace(/, кв\. \d+$/,''),
  area: AREA[a.rooms] + (a.id%6),
  rating: +aptRating(a).replace(',','.'), reviews: aptReviews(a),
  pal: PALETTE[a.id % PALETTE.length],
  parking: a.id%3!==0, ac: a.id%4!==1, balcony: a.id%2===0
}));
const gById = id => guestApts.find(a=>a.id===id);
const nightBusy = (aptId, d) => bookings.some(b=>b.aptId===aptId && b.ci<=d && d<b.co) || blocks.some(b=>b.aptId===aptId && b.from<=d && d<b.to) || (ST.requests||[]).some(r=>r.aptId===aptId && r.status!=='cancelled' && r.ci<=d && d<r.co);
const rangeFree = (aptId, ci, co) => { for(let d=ci; d<co; d++) if(nightBusy(aptId,d)) return false; return true; };
const nightsWord = n => `${n} ${plural(n,'ночь','ночи','ночей')}`;
const guestsWord = n => `${n} ${plural(n,'гость','гостя','гостей')}`;
const fDL = i => `${dd(i)} ${MON_G[mm(i)]}`;

/* ---------- SVG-«фото» квартиры (иллюстрация интерьера) ---------- */
function photo(a, v, key){
  const h = a.pal[0], s = a.pal[1];
  const wall=`hsl(${h} ${s}% 93%)`, wall2=`hsl(${h} ${s}% 86%)`, acc=`hsl(${(h+180)%360} 45% 45%)`, wood=`hsl(30 35% ${58+(a.id%3)*6}%)`;
  const sky = `<linearGradient id="sk${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec5d6"/><stop offset="1" stop-color="#f6d9a0"/></linearGradient>`;
  const win = (x,y,w,hh) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="3" fill="url(#sk${key})"/>
    <g fill="#5b7f8c" opacity=".75"><rect x="${x+w*.08}" y="${y+hh*.55}" width="${w*.1}" height="${hh*.45}"/><rect x="${x+w*.22}" y="${y+hh*.4}" width="${w*.08}" height="${hh*.6}"/><rect x="${x+w*.62}" y="${y+hh*.5}" width="${w*.12}" height="${hh*.5}"/><rect x="${x+w*.8}" y="${y+hh*.35}" width="${w*.1}" height="${hh*.65}"/></g>
    <g fill="#e9c46a"><rect x="${x+w*.445}" y="${y+hh*.3}" width="${w*.03}" height="${hh*.7}"/><circle cx="${x+w*.46}" cy="${y+hh*.26}" r="${w*.055}"/></g>
    <rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="3" fill="none" stroke="#fff" stroke-width="5"/><path d="M${x+w/2} ${y}v${hh}M${x} ${y+hh/2}h${w}" stroke="#fff" stroke-width="3"/>`;
  let body='';
  if(v===0){ // гостиная
    body = `${win(150,40,110,95)}
      <rect x="0" y="210" width="400" height="90" fill="${wood}"/><rect x="0" y="205" width="400" height="6" fill="#fff" opacity=".7"/>
      <rect x="40" y="150" width="200" height="62" rx="16" fill="${acc}"/><rect x="30" y="170" width="220" height="48" rx="14" fill="${acc}" opacity=".9"/><rect x="52" y="160" width="60" height="30" rx="10" fill="#fff" opacity=".35"/><rect x="170" y="160" width="60" height="30" rx="10" fill="#fff" opacity=".25"/>
      <rect x="44" y="218" width="8" height="14" fill="#333"/><rect x="228" y="218" width="8" height="14" fill="#333"/>
      <ellipse cx="200" cy="262" rx="120" ry="16" fill="#fff" opacity=".35"/>
      <rect x="120" y="226" width="90" height="10" rx="5" fill="#3b2f2a"/><rect x="130" y="236" width="6" height="18" fill="#3b2f2a"/><rect x="194" y="236" width="6" height="18" fill="#3b2f2a"/>
      <rect x="300" y="60" width="54" height="40" rx="3" fill="#fff"/><rect x="305" y="65" width="44" height="30" fill="hsl(${(h+40)%360} 50% 70%)"/>
      <path d="M330 205 L330 130" stroke="#333" stroke-width="3"/><path d="M312 130 h36 l-8 -24 h-20z" fill="#f4e3b5"/>
      <rect x="352" y="170" width="26" height="38" rx="4" fill="#b08968"/><circle cx="365" cy="160" r="20" fill="#4d7c4a"/><circle cx="356" cy="150" r="13" fill="#5f9657"/>`;
  } else if(v===1){ // спальня
    body = `${win(40,40,90,85)}
      <rect x="0" y="215" width="400" height="85" fill="${wood}"/>
      <rect x="150" y="95" width="200" height="70" rx="10" fill="${wall2}"/>
      <rect x="140" y="150" width="220" height="80" rx="12" fill="#fff"/><rect x="140" y="178" width="220" height="52" rx="10" fill="${acc}" opacity=".85"/>
      <rect x="160" y="140" width="80" height="30" rx="10" fill="#f6f6f6"/><rect x="258" y="140" width="80" height="30" rx="10" fill="#f6f6f6"/>
      <rect x="100" y="175" width="36" height="40" rx="4" fill="#8d6e63"/><path d="M118 175 v-26" stroke="#333" stroke-width="2"/><path d="M106 150 h24 l-5 -16 h-14z" fill="#f4e3b5"/>
      <rect x="364" y="175" width="30" height="40" rx="4" fill="#8d6e63"/>
      <rect x="215" y="40" width="70" height="44" rx="3" fill="#fff"/><path d="M220 78 l18 -20 l14 12 l10 -8 l18 16z" fill="hsl(${(h+60)%360} 40% 60%)"/>`;
  } else { // кухня
    body = `${win(250,35,110,80)}
      <rect x="0" y="220" width="400" height="80" fill="#d9d4cc"/>
      <rect x="20" y="40" width="200" height="60" rx="4" fill="${acc}" opacity=".9"/><path d="M86 40v60M152 40v60" stroke="#fff" stroke-width="2" opacity=".6"/>
      <rect x="20" y="150" width="340" height="72" rx="4" fill="${acc}"/><rect x="14" y="140" width="352" height="12" rx="3" fill="#f3f3f3"/>
      <path d="M90 150v72M160 150v72M230 150v72M300 150v72" stroke="#fff" stroke-width="2" opacity=".5"/>
      <rect x="170" y="118" width="40" height="22" rx="4" fill="#c0c7cc"/><rect x="60" y="120" width="30" height="20" rx="10" fill="#e76f51"/>
      <rect x="250" y="126" width="18" height="14" rx="3" fill="#fff"/><circle cx="330" cy="128" r="12" fill="#4d7c4a"/>
      <rect x="120" y="238" width="160" height="10" rx="5" fill="#3b2f2a"/>`;
  }
  return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Иллюстрация интерьера (демо)"><defs>${sky}</defs><rect width="400" height="300" fill="${wall}"/>${body}</svg>`;
}

/* ---------- декор: силуэт Астаны ---------- */
document.getElementById('sky').innerHTML = `<svg viewBox="0 0 1400 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="1110" cy="70" r="38" fill="#f6d27a" opacity=".55"/>
  <g fill="#0a3441" opacity=".55">
    <rect x="40" y="150" width="46" height="110"/><rect x="96" y="120" width="34" height="140"/><rect x="140" y="170" width="60" height="90"/>
    <rect x="860" y="130" width="40" height="130"/><rect x="910" y="100" width="30" height="160"/><rect x="950" y="150" width="70" height="110"/><rect x="1180" y="120" width="44" height="140"/><rect x="1234" y="160" width="60" height="100"/><rect x="1304" y="135" width="40" height="125"/>
  </g>
  <g fill="#082b36">
    <path d="M250 260 L330 130 L410 260Z"/><path d="M330 130 l-4 -24 h8z"/>
    <rect x="470" y="170" width="120" height="90"/><path d="M470 170 q60 -60 120 0z"/><rect x="527" y="95" width="6" height="30"/>
    <path d="M688 260 L698 80 L706 80 L716 260Z"/><path d="M676 260 L694 84 L700 84 L686 260Z" opacity=".8"/><path d="M728 260 L704 84 L710 84 L718 260Z" opacity=".8"/>
    <circle cx="702" cy="62" r="24" fill="#e9c46a"/><path d="M678 62 q24 -36 48 0" fill="#082b36" opacity=".3"/>
    <rect x="770" y="190" width="60" height="70"/><rect x="620" y="200" width="44" height="60"/><rect x="200" y="200" width="40" height="60"/><rect x="1040" y="180" width="110" height="80"/><rect x="1060" y="150" width="30" height="40"/>
  </g>
  <rect y="252" width="1400" height="8" fill="#082b36"/>
</svg>`;

/* ---------- статичные блоки ---------- */
document.getElementById('logoMk').innerHTML = document.getElementById('logoMk2').innerHTML = ic('home',20,2.2);
document.getElementById('kicker').innerHTML = ic('star',14)+` 4,86 · ${guestApts.length} квартир в ${DISTRICTS.length} районах`;
document.getElementById('searchBtn').innerHTML = ic('search',18)+' Найти';
document.getElementById('fD').innerHTML += DISTRICTS.map(d=>`<option value="${d}">${d}</option>`).join('');
['fCi','fCo'].forEach(id=>{ const el=document.getElementById(id); el.min=MIN_ISO; el.max=MAX_ISO; });
document.getElementById('perks').innerHTML = [['key','Заселение 24/7','кодовый замок, без ожидания'],['plane','Трансфер из NQZ','встретим с табличкой'],['card','Картой или наличными','без предоплаты при заселении'],['sparkle','Чистота с фотоотчётом','проверяем каждую уборку']]
  .map(([i,b,s])=>`<div class="perk"><span class="pi">${ic(i,20)}</span><div><b>${b}</b><span>${s}</span></div></div>`).join('');
document.getElementById('roomChips').innerHTML = [['','Все'],['Студия','Студии'],['1-комн.','1-комн.'],['2-комн.','2-комн.'],['3-комн.','3-комн.']].map(([k,l])=>`<button class="fchip ${G.rooms===k?'on':''}" data-rooms="${k}">${l}</button>`).join('');
const stars5 = ic('star',15).repeat(5);
document.getElementById('revs').innerHTML = [
  ['Дана, Алматы','Остановились в ЖК Хайвил на 3 ночи. Чисто, всё как на фото, заселение по коду в час ночи — без проблем.','#0f5566'],
  ['Ержан, Караганда','Командировка на неделю. Документы для бухгалтерии сделали сразу, трансфер из аэропорта приехал вовремя.','#e0a526'],
  ['Мария, Москва','Очень уютная студия у ЭКСПО. Ответили в Telegram за пару минут, помогли с поздним выездом.','#e76f51']
].map(([w,t,c])=>`<div class="rev"><div style="color:#e0a526">${stars5}</div><div style="margin-top:8px;color:#3b4d57">«${t}»</div><div class="who"><span class="av" style="background:${c}">${w[0]}</span><b>${w}</b></div></div>`).join('');

/* ---------- каталог ---------- */
function filtered(){
  let L = guestApts.filter(a=> a.maxGuests>=G.guests && (!G.district || a.district===G.district) && (!G.maxPrice || a.price<=G.maxPrice) && (!G.rooms || a.rooms===G.rooms));
  if(G.ci!=null && G.co!=null) L = L.filter(a=>rangeFree(a.id,G.ci,G.co));
  const s = {pop:(a,b)=>b.reviews-a.reviews, cheap:(a,b)=>a.price-b.price, exp:(a,b)=>b.price-a.price, rate:(a,b)=>b.rating-a.rating}[G.sort];
  return L.sort(s);
}
function renderGrid(){
  const L = filtered(); const n = G.ci!=null&&G.co!=null ? G.co-G.ci : 0;
  document.getElementById('resInfo').textContent = n ? `Свободно ${L.length} из ${guestApts.length} на ${fDL(G.ci)} – ${fDL(G.co)} (${nightsWord(n)})` : `${L.length} ${plural(L.length,'квартира','квартиры','квартир')} · выберите даты, чтобы увидеть свободные`;
  document.getElementById('grid').innerHTML = L.length ? L.map(a=>`<article class="apt" data-open="${a.id}" tabindex="0">
    <div class="ph">${photo(a,a.id%3,'g'+a.id)}${n?'<span class="badge free">Свободно на ваши даты</span>':a.reviews>120?'<span class="badge">Популярное</span>':a.rating>=4.9?'<span class="badge">Гости в восторге</span>':''}<button class="fav ${fav.has(a.id)?'on':''}" data-fav="${a.id}" aria-label="В избранное">${ic('star',17)}</button></div>
    <div class="bd"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="loc">${ic('pin',14)} ${a.district} · ${LANDMARK[a.district]}</span><span class="rt">${ic('star',14)} ${aptRating(a)} <small>(${a.reviews})</small></span></div>
      <h3>${esc(a.title)}</h3>
      <div class="feat"><span>${ic('bed',15)} ${a.rooms}</span><span>${ic('users',15)} до ${a.maxGuests}</span><span>${ic('home',15)} ${a.area} м²</span>${a.parking?`<span>${ic('parking',15)} парковка</span>`:''}</div>
      <div class="pr"><div><b>${money(a.price)}</b> <small>/ ночь</small>${n?`<div><small>итого ${money(a.price*n)} за ${nightsWord(n)}</small></div>`:''}</div><span class="btn brand sm">Подробнее</span></div></div></article>`).join('')
    : `<div class="empty" style="grid-column:1/-1">${ic('search',28)}<div style="margin:10px 0 12px;font-weight:600;color:#10212b">На эти даты с такими условиями свободных квартир нет</div><button class="btn sm" data-reset>Сбросить фильтры</button></div>`;
  renderMap();
}
/* ---------- условная схема Астаны ---------- */
const DZ = {
  'Сарыарка':   {c:'#bfdbfe', d:'M40 60 L250 40 L262 150 L230 176 L40 170 Z', p:[150,108]},
  'Байконур':   {c:'#c7d2fe', d:'M250 40 L410 50 L420 168 L330 184 L262 150 Z', p:[335,110]},
  'Алматинский':{c:'#fde68a', d:'M410 50 L570 70 L580 300 L450 290 L420 168 Z', p:[495,175]},
  'Есиль':      {c:'#bbf7d0', d:'M230 200 L420 190 L450 290 L420 350 L250 350 Z', p:[338,270]},
  'Нура':       {c:'#fbcfe8', d:'M30 190 L230 200 L250 350 L40 370 Z', p:[135,285]}
};
function renderMap(){
  const base = guestApts.filter(a=> a.maxGuests>=G.guests && (!G.maxPrice || a.price<=G.maxPrice) && (!G.rooms || a.rooms===G.rooms) && (G.ci==null||G.co==null||rangeFree(a.id,G.ci,G.co)));
  const cnt = d => base.filter(a=>a.district===d).length;
  const minP = d => { const l=guestApts.filter(a=>a.district===d); return l.length?Math.min(...l.map(a=>a.price)):0; };
  const river = 'M600 150 C520 160 470 200 420 186 C360 170 320 205 250 194 C180 184 120 170 0 182';
  document.getElementById('mapBox').innerHTML = `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Условная схема Астаны с районами">
    <rect width="600" height="400" fill="#f2f0ea"/>
    <g stroke="#e4e0d6" stroke-width="1">${Array.from({length:14},(_,i)=>`<path d="M${i*46} 0 V400"/>`).join('')}${Array.from({length:10},(_,i)=>`<path d="M0 ${i*44} H600"/>`).join('')}</g>
    ${Object.entries(DZ).map(([n,z])=>`<g class="dist" data-dist="${n}"><path d="${z.d}" fill="${z.c}" opacity="${!G.district||G.district===n?.85:.35}" stroke="#fff" stroke-width="3"/></g>`).join('')}
    <path d="${river}" fill="none" stroke="#7cc3dc" stroke-width="16" stroke-linecap="round"/><path d="${river}" fill="none" stroke="#a5d8ea" stroke-width="6" stroke-linecap="round"/>
    <text x="60" y="200" font-size="12" fill="#3b7f96" font-style="italic">р. Есиль</text>
    <path d="M450 290 C480 320 510 345 530 356" stroke="#cbbfa8" stroke-width="4" stroke-dasharray="8 6" fill="none"/>
    <g transform="translate(530 356)"><circle r="16" fill="#fff" stroke="#10212b" stroke-width="1.5"/><svg x="-9" y="-9" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10212b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I.plane}</svg></g>
    <text x="500" y="392" font-size="11.5" font-weight="700" fill="#10212b">Аэропорт NQZ</text>
    <g transform="translate(300 232)"><rect x="-2" y="-18" width="4" height="18" fill="#10212b"/><circle cy="-22" r="6" fill="#e0a526" stroke="#10212b" stroke-width="1.5"/><text x="10" y="-4" font-size="11" fill="#10212b" font-weight="600">Байтерек</text></g>
    <g transform="translate(268 330)"><path d="M-10 0 L0 -18 L10 0Z" fill="#10212b"/><text x="13" y="-2" font-size="11" fill="#10212b" font-weight="600">Хан Шатыр</text></g>
    <g transform="translate(80 340)"><circle r="9" fill="#10212b"/><circle r="4" fill="#7cc3dc"/><text x="13" y="4" font-size="11" fill="#10212b" font-weight="600">ЭКСПО</text></g>
    <g transform="translate(70 80)"><rect x="-8" y="-6" width="16" height="10" rx="2" fill="#10212b"/><text x="12" y="3" font-size="11" fill="#10212b" font-weight="600">Ж/д вокзал</text></g>
    ${Object.entries(DZ).map(([n,z])=>{ const c=cnt(n); return `<g class="pin" data-dist="${n}" transform="translate(${z.p[0]} ${z.p[1]})">
      <text y="30" text-anchor="middle" font-size="12.5" font-weight="700" fill="#10212b" stroke="#fff" stroke-width="3" paint-order="stroke">${n}</text>
      <g class="pin-b" style="transform-origin:0 0;transition:transform .15s"><path d="M0 12 C-4 4 -20 -2 -20 -16 A20 20 0 1 1 20 -16 C20 -2 4 4 0 12Z" fill="${G.district===n?'#e0a526':'#0b3b4a'}" stroke="#fff" stroke-width="2"/>
      <text y="-10" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">${c}</text></g></g>`; }).join('')}
  </svg><span class="note">Схема условная, не в масштабе · демо</span>`;
  document.getElementById('dlist').innerHTML = `<button class="dl ${!G.district?'on':''}" data-dist=""><span class="sw" style="background:#0b3b4a"></span><div><b>Все районы</b><small>вся Астана</small></div><span class="n">${base.length} кв.</span></button>`
    + DISTRICTS.map(d=>`<button class="dl ${G.district===d?'on':''}" data-dist="${d}"><span class="sw" style="background:${DZ[d].c}"></span><div><b>${d}</b><small>${LANDMARK[d]} · от ${money(minP(d))}</small></div><span class="n">${cnt(d)} кв.</span></button>`).join('');
}
function syncSearchInputs(){
  document.getElementById('fCi').value = G.ci!=null?isoOf(G.ci):''; document.getElementById('fCo').value = G.co!=null?isoOf(G.co):'';
  document.getElementById('fG').value = String(G.guests); document.getElementById('fD').value = G.district; document.getElementById('fP').value = String(G.maxPrice);
}
function readSearch(){
  const ci = idxOf(document.getElementById('fCi').value), co = idxOf(document.getElementById('fCo').value);
  G.ci = isNaN(ci)?null:Math.max(ci,TODAY); G.co = isNaN(co)?null:co;
  if(G.ci!=null && (G.co==null || G.co<=G.ci)) { if(G.co!=null) toast('Дата выезда должна быть позже заезда — поставили +2 ночи'); G.co = G.ci+2; }
  if(G.ci==null) G.co=null;
  G.guests = +document.getElementById('fG').value; G.district = document.getElementById('fD').value; G.maxPrice = +document.getElementById('fP').value;
  syncSearchInputs(); renderGrid();
}
function toast(t){ const el=document.createElement('div'); el.className='toast'; el.textContent=t; document.body.appendChild(el); setTimeout(()=>el.remove(),3000); }

/* ---------- модальное окно: детали, календарь, бронь, оплата ---------- */
const M = {apt:null, step:'details', ci:null, co:null, month:di(2026,10,1), guests:2, transfer:false, pay:'card', form:{name:'',phone:'+7 ',comment:''}, photo:0, saved:null};
const SUBMIT_LBL = {card:'Перейти к оплате',cash:'Забронировать',telegram:'Продолжить в Telegram',whatsapp:'Продолжить в WhatsApp'};
function openApt(id){
  const a=gById(id); if(!a) return;
  Object.assign(M, {apt:a, step:'details', photo:0, saved:null, guests:Math.min(G.guests,a.maxGuests), transfer:false, pay:'card'});
  M.ci = G.ci; M.co = G.co;
  if(M.ci!=null && !rangeFree(a.id,M.ci,M.co)){ M.ci=null; M.co=null; }
  M.month = M.ci!=null ? di(2026,mm(M.ci)+1,1) : di(2026,10,1);
  document.getElementById('modal').classList.add('open'); document.body.style.overflow='hidden';
  renderModal(); document.getElementById('modal').scrollTop=0;
}
function closeModal(){ document.getElementById('modal').classList.remove('open'); document.body.style.overflow=''; }
function calendarHTML(){
  const a=M.apt, ms=M.month, m=mm(ms); const days=new Date(Date.UTC(2026,m+1,0)).getUTCDate(); const lead=(wd(ms)+6)%7;
  let cells = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(w=>`<div class="wd">${w}</div>`).join('') + '<div></div>'.repeat(lead);
  for(let k=0;k<days;k++){ const d=ms+k; const past=d<TODAY; const busy=!past && nightBusy(a.id,d);
    const sel = d===M.ci || d===M.co; const inr = M.ci!=null && M.co!=null && d>M.ci && d<M.co;
    const canCo = M.ci!=null && M.co==null && d>M.ci && rangeFree(a.id,M.ci,d);
    const cls = [past?'past':'', busy&&!sel?'busy':'', sel?'sel':'', inr?'inr':'', d===TODAY?'today':''].join(' ').trim();
    const dis = past || (busy && !canCo && !sel);
    cells += `<button type="button" class="${cls}" data-day="${d}" ${dis?'disabled':''} title="${fDL(d)}${busy?' — занято':''}">${dd(d)}</button>`; }
  const mi = MONTHS_ALLOWED.indexOf(m);
  return `<div class="mcal-h"><button type="button" class="navb" data-mon="-1" ${mi<=0?'disabled':''} aria-label="Предыдущий месяц">${ic('chevL',16)}</button><b>${MON_N[m]} 2026</b><button type="button" class="navb" data-mon="1" ${mi>=MONTHS_ALLOWED.length-1?'disabled':''} aria-label="Следующий месяц">${ic('chevR',16)}</button></div>
    <div class="mcal" id="mcal">${cells}</div>
    <div class="legend"><span><i style="background:#fff;border:1px solid #cfd8de"></i>свободно</span><span><i style="background:repeating-linear-gradient(135deg,#f1f3f5 0 3px,#dfe3e6 3px 6px)"></i>занято</span><span><i style="background:#0b3b4a"></i>ваши даты</span></div>`;
}
function totals(){ const a=M.apt; const n = M.ci!=null&&M.co!=null ? M.co-M.ci : 0; const tr = M.transfer?TRANSFER_PRICE:0; return {n, stay:a.price*n, tr, total:a.price*n+tr}; }
function sumHTML(){ const t=totals(); if(!t.n) return `<div class="sum muted">Выберите даты заезда и выезда в календаре</div>`;
  return `<div class="sum"><div class="ln"><span>${money(M.apt.price)} × ${nightsWord(t.n)}</span><span>${money(t.stay)}</span></div>${t.tr?`<div class="ln"><span>Трансфер из аэропорта</span><span>${money(t.tr)}</span></div>`:''}<div class="ln"><span>Сервисный сбор</span><span style="color:var(--ok)">0 ₸</span></div><div class="ln tot"><span>Итого</span><span>${money(t.total)}</span></div></div>`; }
function selText(){ const t=totals(); return M.ci!=null?(M.co!=null?`${fDL(M.ci)} → ${fDL(M.co)} · ${nightsWord(t.n)}`:`Заезд ${fDL(M.ci)} — выберите дату выезда`):'Нажмите на дату заезда'; }
const CAPS=['Гостиная','Спальня','Кухня'];
function galleryHTML(a){
  return `<div class="mgal"><div class="big">${photo(a,M.photo,'m0')}<span class="cap">${CAPS[M.photo]} · иллюстрация</span></div><div class="side">${[1,2].map(k=>{ const v=(M.photo+k)%3; return `<div class="sm2" data-photo="${v}" style="cursor:pointer">${photo(a,v,'m'+k)}<span class="cap">${CAPS[v]}</span></div>`; }).join('')}</div></div>`;
}
function miniApt(a,key,sub){ return `<div class="mini-apt"><div class="th">${photo(a,0,key)}</div><div><b style="font-size:14.5px">${esc(a.title)}</b><div class="muted" style="font-size:12.5px">${sub}</div></div></div>`; }
function renderModal(){
  const a=M.apt, box=document.getElementById('mbox'); const t=totals();
  const close = `<button type="button" class="mclose" data-close aria-label="Закрыть">${ic('x',18)}</button>`;
  if(M.step==='details'){
    box.innerHTML = close + galleryHTML(a) + `<div class="mcont"><div>
      <div class="loc">${ic('pin',14)} ${a.district} р-н · ${esc(a.street)}</div>
      <h2 style="margin:6px 0 8px">${esc(a.title)}</h2>
      <div class="feat" style="font-size:14px"><span class="rt">${ic('star',15)} ${aptRating(a)} <small>· ${a.reviews} отзывов</small></span><span>${ic('bed',15)} ${a.rooms}</span><span>${ic('users',15)} до ${guestsWord(a.maxGuests)}</span><span>${ic('home',15)} ${a.area} м²</span></div>
      <p style="color:var(--ink2);margin:14px 0 0">Светлая ${a.rooms==='Студия'?'студия':ROOMS_FULL[a.rooms].toLowerCase()+' квартира'} в ${esc(a.complex)}, ${LANDMARK[a.district]}. Полностью оборудованная кухня, свежее бельё и полотенца, быстрый Wi‑Fi. Самостоятельное заселение по коду в любое время.</p>
      <div class="amen"><span>${ic('wifi',18)} Wi‑Fi 200 Мбит/с</span><span>${ic('key',18)} Заселение 24/7</span>${a.parking?`<span>${ic('parking',18)} Парковка</span>`:`<span>${ic('car',18)} Парковка рядом</span>`}<span>${ic('sparkle',18)} Уборка с фотоотчётом</span>${a.ac?`<span>${ic('moon',18)} Кондиционер</span>`:''}<span>${ic('home',18)} Стиральная машина</span>${a.balcony?`<span>${ic('building',18)} Балкон</span>`:''}<span>${ic('plane',18)} Трансфер из NQZ</span></div>
      <div class="demo-note">${ic('alert',16)}<span>Заселение с 14:00, выезд до 12:00. Фото — иллюстрации, квартира и отзывы вымышленные (демо).</span></div>
    </div>
    <aside class="bookbox"><div style="display:flex;align-items:baseline;justify-content:space-between"><div><b style="font-size:22px">${money(a.price)}</b> <span class="muted">/ ночь</span></div><span class="rt">${ic('star',14)} ${aptRating(a)}</span></div>
      <div id="calBox">${calendarHTML()}</div>
      <div id="selInfo" style="margin-top:10px;font-size:13.5px;font-weight:600">${selText()}</div>
      <div id="sumBox">${sumHTML()}</div>
      <button type="button" class="btn brand block" style="margin-top:12px;height:50px" data-to-form ${t.n?'':'disabled'} id="toFormBtn">Забронировать</button>
      <div class="muted" style="font-size:12.5px;text-align:center;margin-top:8px">Оплата картой, наличными или через мессенджер</div></aside></div>
    <div class="mbar"><div><b>${money(a.price)}</b> <span class="muted">/ ночь</span><div class="muted" style="font-size:12px" id="mbarInfo">${t.n?`${nightsWord(t.n)} · ${money(t.total)}`:'выберите даты'}</div></div><button type="button" class="btn brand" data-to-form>Забронировать</button></div>`;
  }
  else if(M.step==='form'){
    const payIc = {card:['card','#0f5566'],cash:['cash','#15803d'],telegram:['send','#229ED9'],whatsapp:['msg','#22B35E']};
    const paySub = {card:'Visa, Mastercard · мгновенное подтверждение',cash:'Оплата в ₸ при заселении',telegram:'Обсудить и оплатить в чате',whatsapp:'Обсудить и оплатить в чате'};
    box.innerHTML = close + `<div class="pane"><div class="step-h"><button type="button" class="backb" data-back="details" aria-label="Назад">${ic('chevL',18)}</button><div><h2 style="font-size:22px">Оформление брони</h2><div class="muted" style="font-size:13px">Шаг 2 из 3 · без регистрации</div></div></div>
      <form id="bookForm" class="form-grid" novalidate><div>
        <div class="two"><div class="field"><label for="bName">Имя и фамилия</label><input class="inp" id="bName" value="${esc(M.form.name)}" placeholder="Айдана Серикова" autocomplete="name"></div>
        <div class="field"><label for="bPhone">Телефон</label><input class="inp" id="bPhone" type="tel" inputmode="tel" value="${esc(M.form.phone)}" placeholder="+7 7__ ___ __ __" autocomplete="tel"></div></div>
        <div class="two"><div class="field"><label for="bCi">Заезд</label><input class="inp" type="date" id="bCi" min="${MIN_ISO}" max="${MAX_ISO}" value="${M.ci!=null?isoOf(M.ci):''}"></div>
        <div class="field"><label for="bCo">Выезд</label><input class="inp" type="date" id="bCo" min="${MIN_ISO}" max="${MAX_ISO}" value="${M.co!=null?isoOf(M.co):''}"></div></div>
        <div class="field"><label for="bG">Гости</label><select class="inp" id="bG">${Array.from({length:a.maxGuests},(_,i)=>`<option value="${i+1}" ${M.guests===i+1?'selected':''}>${guestsWord(i+1)}</option>`).join('')}</select></div>
        <label class="chk"><input type="checkbox" id="bTr" ${M.transfer?'checked':''}><div><b>${ic('plane',16)} Трансфер из аэропорта +${money(TRANSFER_PRICE)}</b><small>Водитель встретит в аэропорту Астаны (NQZ) с табличкой</small></div></label>
        <div class="field"><label for="bCom">Комментарий <span class="muted" style="font-weight:500">(необязательно)</span></label><textarea class="inp" id="bCom" placeholder="Поздний заезд, детская кроватка, номер рейса…">${esc(M.form.comment)}</textarea></div>
        <div class="field" style="margin-bottom:6px"><label>Способ оплаты</label></div>
        <div class="pays">${Object.keys(PAY_METHODS).map(k=>`<button type="button" class="pay ${M.pay===k?'on':''}" data-pay="${k}"><span class="pi" style="background:${payIc[k][1]}">${ic(payIc[k][0],18)}</span><span><b>${PAY_METHODS[k].label}</b><small>${paySub[k]}</small></span></button>`).join('')}</div>
        <div class="err" id="bErr"></div>
      </div>
      <aside><div class="bookbox">${miniApt(a,'f0',`${a.district} · ${ic('star',12)} ${aptRating(a)}`)}
        <div style="font-size:14px;display:flex;justify-content:space-between"><span class="muted">Даты</span><b id="fDates">${t.n?`${fD(M.ci)} – ${fD(M.co)}`:'—'}</b></div>
        <div id="fSum">${sumHTML()}</div>
        <button class="btn brand block" type="submit" style="margin-top:14px;height:52px" id="bSubmit">${SUBMIT_LBL[M.pay]}</button>
        <div class="muted" style="font-size:12px;text-align:center;margin-top:8px">${ic('shield',13)} Демо: данные сохраняются только в этом браузере</div></div></aside></form></div>`;
  }
  else if(M.step==='card'){
    box.innerHTML = close + `<div class="pane"><div class="step-h"><button type="button" class="backb" data-back="form" aria-label="Назад">${ic('chevL',18)}</button><div><h2 style="font-size:22px">Оплата картой</h2><div class="muted" style="font-size:13px">Шаг 3 из 3</div></div></div>
      <div class="form-grid"><div>
      <div class="demo-note">${ic('alert',16)}<span><b>Демо-оплата.</b> Реального списания нет, данные карты никуда не отправляются и не сохраняются. Номер уже заполнен тестовым.</span></div>
      <div class="cardviz"><div style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1"><span class="chip-ic"></span><b style="letter-spacing:.08em">DEMO</b></div><div class="num" id="cvNum">4242 4242 4242 4242</div><div style="display:flex;justify-content:space-between;font-size:13px;position:relative;z-index:1"><span>${esc((M.form.name||'GUEST').toUpperCase())}</span><span>12/28</span></div></div>
      <form id="cardForm" novalidate>
        <div class="field"><label for="cNum">Номер карты</label><input class="inp" id="cNum" inputmode="numeric" value="4242 4242 4242 4242" maxlength="19" autocomplete="off"></div>
        <div class="two"><div class="field"><label for="cExp">Срок</label><input class="inp" id="cExp" value="12/28" maxlength="5" autocomplete="off"></div><div class="field"><label for="cCvc">CVC</label><input class="inp" id="cCvc" value="123" maxlength="3" inputmode="numeric" type="password" autocomplete="off"></div></div>
        <div class="err" id="cErr"></div>
        <button class="btn brand block" type="submit" style="height:52px" id="payBtn">Оплатить ${money(t.total)} (демо)</button>
      </form></div>
      <aside><div class="bookbox">${miniApt(a,'c0',`${fD(M.ci)} – ${fD(M.co)} · ${guestsWord(M.guests)}`)}${sumHTML()}</div></aside></div></div>`;
  }
  else if(M.step==='chat'){
    const tg = M.pay==='telegram'; const col = tg?'#229ED9':'#128C7E';
    box.innerHTML = close + `<div class="pane"><div class="step-h"><button type="button" class="backb" data-back="form" aria-label="Назад">${ic('chevL',18)}</button><div><h2 style="font-size:22px">${tg?'Написать в Telegram':'Написать в WhatsApp'}</h2><div class="muted" style="font-size:13px">Предпросмотр сообщения</div></div></div>
      <div class="form-grid"><div>
      <div class="chat"><div class="chat-h" style="background:${col}"><span class="av">AS</span><div><b>Astana Stay</b><div style="font-size:12px;opacity:.85">${tg?'@astanastay_demo':'+7 700 000 00 00'} · отвечает за 5 минут</div></div></div>
        <div class="chat-b ${tg?'tg':''}"><div class="bub" id="chatMsg">${esc(chatText())}<small>сейчас ✓</small></div></div></div>
      </div><div>
      <div class="demo-note">${ic('alert',16)}<span><b>Демо.</b> В рабочей версии откроется ${tg?'t.me/astanastay_demo':'wa.me/77000000000'} с этим текстом. Сейчас реальные ссылки не открываются — заявка просто сохранится для владельца.</span></div>
      <div class="bookbox">${sumHTML()}<button type="button" class="btn block" id="chatSend" style="margin-top:14px;height:52px;background:${col};border-color:${col};color:#fff">${ic(tg?'send':'msg',18)} Отправить (демо)</button></div>
      </div></div></div>`;
  }
  else if(M.step==='success'){
    const r=M.saved; const pm=PAY_METHODS[r.payment];
    const status = r.payment==='card' ? `<span style="color:var(--ok)">Оплачено ${money(r.total)} (демо)</span>` : r.payment==='cash' ? 'Оплата наличными при заселении' : `Ответим в ${r.payment==='telegram'?'Telegram':'WhatsApp'} за 5 минут`;
    box.innerHTML = close + `<div class="success"><div class="okc">${ic('check',38,3)}</div>
      <h2 style="font-size:26px">${r.payment==='card'?'Оплата прошла, бронь принята!':'Заявка отправлена!'}</h2>
      <p class="muted" style="margin:8px auto 0;max-width:460px">Номер заявки <b style="color:var(--ink)">S-${r.id}</b>. Мы свяжемся с вами по номеру ${esc(r.phone)}. Код от замка придёт в день заезда.</p>
      <div class="recap"><div class="ln"><span>Квартира</span><span>${esc(a.title)}</span></div><div class="ln"><span>Даты</span><span>${fDL(r.ci)} – ${fDL(r.co)} · ${nightsWord(r.co-r.ci)}</span></div><div class="ln"><span>Гости</span><span>${r.guests}</span></div><div class="ln"><span>Трансфер</span><span>${r.transfer?'Да, из аэропорта':'Нет'}</span></div><div class="ln"><span>Способ оплаты</span><span>${pm.label}</span></div><div class="ln"><span>Статус</span><span>${status}</span></div><div class="ln"><span>Итого</span><span>${money(r.total)}</span></div></div>
      <div class="demo-note" style="max-width:460px;margin:0 auto 16px;text-align:left">${ic('alert',16)}<span>Демо: заявка сохранена в браузере. Войдите как владелец — она появится в разделе «Заявки» с источником «Сайт».</span></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn brand" data-close>Готово</button><a class="btn" href="login.html?role=owner">${ic('eye',16)} Посмотреть глазами владельца</a></div></div>`;
  }
}
function chatText(){ const a=M.apt, t=totals();
  return `Здравствуйте! Хочу забронировать «${a.title}» (${a.district}) с ${fDL(M.ci)} по ${fDL(M.co)} — ${nightsWord(t.n)}, ${guestsWord(M.guests)}.\nИмя: ${M.form.name}\nТелефон: ${M.form.phone}${M.transfer?'\nНужен трансфер из аэропорта.':''}${M.form.comment?'\nКомментарий: '+M.form.comment:''}\nСумма по сайту: ${money(t.total)}`; }
function refreshDetailsBits(){ const t=totals();
  document.getElementById('calBox').innerHTML = calendarHTML(); document.getElementById('sumBox').innerHTML = sumHTML();
  document.getElementById('selInfo').textContent = selText();
  const tf=document.getElementById('toFormBtn'); if(tf) tf.disabled=!t.n;
  const mi=document.getElementById('mbarInfo'); if(mi) mi.textContent = t.n?`${nightsWord(t.n)} · ${money(t.total)}`:'выберите даты'; }
function refreshFormBits(){ const t=totals();
  document.getElementById('fSum').innerHTML = sumHTML(); document.getElementById('fDates').textContent = t.n?`${fD(M.ci)} – ${fD(M.co)}`:'—';
  document.getElementById('bSubmit').textContent = SUBMIT_LBL[M.pay];
  document.querySelectorAll('.pay').forEach(p=>p.classList.toggle('on', p.dataset.pay===M.pay)); }
function readForm(){ M.form.name=document.getElementById('bName').value.trim(); M.form.phone=document.getElementById('bPhone').value.trim(); M.form.comment=document.getElementById('bCom').value.trim();
  M.guests=+document.getElementById('bG').value; M.transfer=document.getElementById('bTr').checked; }
function validateForm(){
  const err=document.getElementById('bErr');
  const bad = (id,msg)=>{ const el=document.getElementById(id); el.classList.add('bad'); err.textContent=msg; err.classList.add('show'); el.focus(); return false; };
  document.querySelectorAll('#bookForm .inp').forEach(i=>i.classList.remove('bad')); err.classList.remove('show');
  if(M.form.name.length<2) return bad('bName','Укажите имя');
  if(M.form.phone.replace(/\D/g,'').length<11) return bad('bPhone','Укажите телефон полностью, например +7 701 123 45 67');
  const ci=idxOf(document.getElementById('bCi').value), co=idxOf(document.getElementById('bCo').value);
  if(isNaN(ci)||ci<TODAY) return bad('bCi','Выберите дату заезда (не раньше сегодняшней)');
  if(isNaN(co)||co<=ci) return bad('bCo','Дата выезда должна быть позже даты заезда');
  if(!rangeFree(M.apt.id,ci,co)) return bad('bCi','Эти даты уже заняты — выберите другие в календаре');
  M.ci=ci; M.co=co; return true;
}
function saveRequest(){
  const a=M.apt, t=totals(); let rec;
  const res = Store.update(st=>{ const id=++st.seq; rec={id, aptId:a.id, name:M.form.name, phone:M.form.phone, ci:M.ci, co:M.co, guests:M.guests, transfer:M.transfer, comment:M.form.comment, payment:M.pay, paid:M.pay==='card', total:t.total, status:'new', time:nowHM(), day:'Сегодня', createdAt:Date.now()}; st.requests.push(rec); });
  ST = res.st; M.saved = rec; M.step='success'; renderModal(); document.getElementById('modal').scrollTop=0; renderGrid();
  if(!res.ok) toast('Не удалось сохранить в localStorage (приватный режим?) — владелец не увидит заявку');
}

/* ---------- события ---------- */
document.addEventListener('click', e=>{
  const t=e.target;
  const favB=t.closest('[data-fav]'); if(favB){ e.stopPropagation(); const id=+favB.dataset.fav; if(fav.has(id)) fav.delete(id); else fav.add(id); favB.classList.toggle('on'); toast(fav.has(id)?'Добавлено в избранное':'Убрано из избранного'); return; }
  const op=t.closest('[data-open]'); if(op){ openApt(+op.dataset.open); return; }
  if(t.closest('[data-close]') || t.id==='modal'){ closeModal(); return; }
  const dist=t.closest('[data-dist]'); if(dist){ const d=dist.dataset.dist; G.district = (d && G.district===d) ? '' : d; syncSearchInputs(); renderGrid(); document.getElementById('catalog').scrollIntoView({behavior:'smooth'}); return; }
  const rc=t.closest('[data-rooms]'); if(rc){ G.rooms=rc.dataset.rooms; document.querySelectorAll('[data-rooms]').forEach(b=>b.classList.toggle('on', b.dataset.rooms===G.rooms)); renderGrid(); return; }
  if(t.closest('[data-reset]')){ Object.assign(G,{ci:null,co:null,guests:1,district:'',maxPrice:0,rooms:''}); document.querySelectorAll('[data-rooms]').forEach(b=>b.classList.toggle('on', b.dataset.rooms==='')); syncSearchInputs(); renderGrid(); return; }
  const ph=t.closest('[data-photo]'); if(ph){ M.photo=+ph.dataset.photo; document.querySelector('.mgal').outerHTML = galleryHTML(M.apt); return; }
  const mon=t.closest('[data-mon]'); if(mon){ if(mon.disabled) return; const m=mm(M.month)+(+mon.dataset.mon); if(MONTHS_ALLOWED.includes(m)){ M.month=di(2026,m+1,1); document.getElementById('calBox').innerHTML=calendarHTML(); } return; }
  const day=t.closest('[data-day]'); if(day){ if(day.disabled) return; const d=+day.dataset.day;
    if(M.ci!=null && M.co==null && d>M.ci){ if(rangeFree(M.apt.id,M.ci,d)) M.co=d; else toast('В этом периоде есть занятые даты'); }
    else if(!nightBusy(M.apt.id,d)){ M.ci=d; M.co=null; } else toast('Эта дата занята');
    refreshDetailsBits(); return; }
  if(t.closest('[data-to-form]')){ if(!totals().n){ document.getElementById('calBox').scrollIntoView({behavior:'smooth',block:'center'}); toast('Сначала выберите даты заезда и выезда'); return; } M.step='form'; renderModal(); document.getElementById('modal').scrollTop=0; return; }
  const back=t.closest('[data-back]'); if(back){ if(M.step==='form') readForm(); M.step=back.dataset.back; renderModal(); return; }
  const pay=t.closest('[data-pay]'); if(pay){ M.pay=pay.dataset.pay; refreshFormBits(); return; }
  if(t.closest('#chatSend')){ saveRequest(); return; }
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && document.getElementById('modal').classList.contains('open')) closeModal(); if(e.key==='Enter' && e.target.matches && e.target.matches('.apt')) openApt(+e.target.dataset.open); });
document.addEventListener('change', e=>{
  const id=e.target.id;
  if(id==='sort'){ G.sort=e.target.value; renderGrid(); }
  if(id==='fCi'||id==='fCo'||id==='fG'||id==='fD'||id==='fP'){ readSearch(); }
  if(id==='bTr'||id==='bG'){ readForm(); refreshFormBits(); }
  if(id==='bCi'||id==='bCo'){ const ci=idxOf(document.getElementById('bCi').value), co=idxOf(document.getElementById('bCo').value);
    if(!isNaN(ci)){ M.ci=Math.max(ci,TODAY); if(!isNaN(co)&&co>M.ci) M.co=co; else { M.co=M.ci+1; document.getElementById('bCo').value=isoOf(M.co); } }
    const err=document.getElementById('bErr');
    if(M.ci!=null && M.co!=null && !rangeFree(M.apt.id,M.ci,M.co)){ err.textContent='Эти даты заняты — выберите другие'; err.classList.add('show'); } else err.classList.remove('show');
    refreshFormBits(); }
});
document.addEventListener('input', e=>{ if(e.target.id==='cNum'){ const v=e.target.value.replace(/\D/g,'').slice(0,16); e.target.value=v.replace(/(.{4})/g,'$1 ').trim(); document.getElementById('cvNum').textContent = e.target.value || '•••• •••• •••• ••••'; } });
document.addEventListener('submit', e=>{
  if(e.target.id==='searchForm'){ e.preventDefault(); readSearch(); document.getElementById('catalog').scrollIntoView({behavior:'smooth'}); }
  if(e.target.id==='bookForm'){ e.preventDefault(); readForm(); if(!validateForm()) return;
    if(M.pay==='card'){ M.step='card'; renderModal(); document.getElementById('modal').scrollTop=0; }
    else if(M.pay==='cash'){ saveRequest(); }
    else { M.step='chat'; renderModal(); document.getElementById('modal').scrollTop=0; } }
  if(e.target.id==='cardForm'){ e.preventDefault(); const n=document.getElementById('cNum').value.replace(/\D/g,''); const err=document.getElementById('cErr');
    if(n.length<16){ err.textContent='Введите 16 цифр номера карты (в демо подойдёт любой)'; err.classList.add('show'); return; }
    if(!/^\d\d\/\d\d$/.test(document.getElementById('cExp').value)){ err.textContent='Срок в формате ММ/ГГ'; err.classList.add('show'); return; }
    const b=document.getElementById('payBtn'); b.disabled=true; b.innerHTML='<span class="spinner"></span> Обработка платежа (демо)…';
    setTimeout(saveRequest, 1100); }
});
window.addEventListener('storage', e=>{ if(e.key===STORE_KEY){ ST=Store.load(); renderGrid(); } });

/* ---------- старт ---------- */
syncSearchInputs(); renderGrid();
const qa = +new URLSearchParams(location.search).get('apt'); if(qa) openApt(qa);
window.__guest = {G, M, openApt};
})();
