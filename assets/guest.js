/* Astana Stay — логика демо-сайта для гостей (главная страница прототипа).
   Данные квартир и занятости — из assets/data.js, заявки на бронь и трансфер сохраняются
   в localStorage (assets/store.js) и появляются у владельца в «Заявках» и «Трансферах». */
(function(){
'use strict';
const $ = id => document.getElementById(id);
/* месяцы, доступные в календаре: сентябрь 2026 — март 2027 */
const MONTHS = []; for(let k=0;k<7;k++){ const y=2026+Math.floor((8+k)/12), m=(8+k)%12; MONTHS.push(di(y,m+1,1)); }
const MAX_DAY = di(2027,4,1) - 1;
const G = {ci:null, co:null, guests:2, district:'', maxPrice:0, sort:'pop', rooms:'', pets:false};
const fav = new Set();
let ST = Store.load();
/* ---------- валюта сайта: курсы и ручные цены задаёт владелец (Настройки → Валюты и цены) ---------- */
const CUR_LS = 'astanastay.cur';
let FX = fxGet(ST);
let CUR = localStorage.getItem(CUR_LS) || (IS_EN ? 'USD' : 'KZT'); if(!FX.show[CUR] || !FX_CUR[CUR]) CUR = 'KZT';
/* статичный текст страницы → EN (если выбран английский), затем бренд из assets/brand.js */
if(window.I18N) I18N.applyStatic();
BRAND.apply();
function renderSwitch(){
  const shown = FX_CODES.filter(c=>c==='KZT' || FX.show[c]);
  $('lsw').innerHTML = `<div class="lang" role="group" aria-label="Language / Язык"><button type="button" data-lang="ru" class="${IS_EN?'':'on'}" aria-pressed="${!IS_EN}">RU</button><button type="button" data-lang="en" class="${IS_EN?'on':''}" aria-pressed="${IS_EN}">EN</button></div>`
    + (shown.length>1 ? `<label class="cursel"><span class="sr">${tx("Валюта")}</span><select id="curSel" aria-label="${tx("Валюта")}">${shown.map(c=>`<option value="${c}" ${c===CUR?'selected':''}>${FX_CUR[c].sym} ${c}</option>`).join('')}</select></label>` : '');
}
renderSwitch();
const conv = kzt => fxConv(kzt, CUR, FX);
const fc = v => fxFmt(v, CUR);
const gm = kzt => fc(conv(kzt));
const nightC = a => fxNight(a, CUR, FX);
const gmN = a => fc(nightC(a));
const grt = r => r.cur ? fxFmt(r.cur.total, r.cur.code) : grt(r);

const PALETTE = [[32,60],[200,45],[160,35],[345,45],[45,55],[255,35],[15,50],[185,40],[95,30],[220,40],[5,45],[280,30]];
const AREA = {'Студия':24,'1-комн.':38,'2-комн.':58,'3-комн.':82};
const ROOMS_FULL = {'Студия':tx('Студия'),'1-комн.':tx('1-комнатная'),'2-комн.':tx('2-комнатная'),'3-комн.':tx('3-комнатная')};
const LANDMARK = {'Есиль':tx('рядом с Байтереком'),'Алматинский':tx('у парка Жетысу'),'Сарыарка':tx('в старом центре'),'Байконур':tx('у набережной'),'Нура':tx('у ЭКСПО')};
const txStreet = st => { if(!IS_EN) return st; const m=/^(ул\.|пр\.)\s*(.+?),\s*(\S+)$/.exec(st); return m ? `${m[3]} ${tx(m[2])} ${m[1]==='пр.'?'Ave':'St'}` : tx(st); };
const guestApts = apartments.map(a=>Object.assign({}, a, {
  title: `${ROOMS_FULL[a.rooms]} ${tx("в")} ${tx(a.complex)}`,
  near: a.embassy ? tx('рядом с посольством США') : LANDMARK[a.district],
  street: a.address.replace(/, кв\. \d+$/,''),
  area: AREA[a.rooms] + (a.id%6),
  rating: +aptRating(a).replace(',','.'), reviews: aptReviews(a),
  pal: PALETTE[a.id % PALETTE.length],
  parking: a.id%3!==0, ac: a.id%4!==1, balcony: a.id%2===0,
  pets: aptPets(a)
}));
const gById = id => guestApts.find(a=>a.id===id);
const nightBusy = (aptId, d) => bookings.some(b=>b.aptId===aptId && b.ci<=d && d<b.co) || blocks.some(b=>b.aptId===aptId && b.from<=d && d<b.to) || (ST.requests||[]).some(r=>r.type!=='transfer' && r.aptId===aptId && r.status!=='cancelled' && r.ci<=d && d<r.co);
const rangeFree = (aptId, ci, co) => { for(let d=ci; d<co; d++) if(nightBusy(aptId,d)) return false; return true; };
const nightsWord = n => `${n} ${plural(n,tx('ночь'),tx('ночи'),tx('ночей'))}`;
const guestsWord = n => `${n} ${plural(n,tx('гость'),tx('гостя'),tx('гостей'))}`;
const fDL = i => `${dd(i)} ${MON_G[mm(i)]}`;
const fDW = i => `${dd(i)} ${MON_S[mm(i)]}, ${WD[wd(i)].toLowerCase()}`;
const petText = p => !p.allowed ? tx('Без животных') : `${tx("Можно с животными:")} ${p.count===1?tx('1 питомец'):tx('до 2 питомцев')} ${p.weight}, ${p.fee?`${tx("доплата")} ${gm(p.fee)} ${tx("за проживание")}`:tx('без доплаты')}`;
function toast(t){ document.querySelectorAll('.toast').forEach(x=>x.remove()); const el=document.createElement('div'); el.className='toast'; el.textContent=t; document.body.appendChild(el); setTimeout(()=>el.remove(),3200); }
const TIMES = []; for(let h=0;h<24;h++) for(let q=0;q<60;q+=15) TIMES.push(String(h).padStart(2,'0')+':'+String(q).padStart(2,'0'));
const timeOpts = (v, ph) => `<option value="">${ph||'--:--'}</option>` + TIMES.map(t=>`<option ${t===v?'selected':''}>${t}</option>`).join('');

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
  return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${tx("Иллюстрация интерьера (демо)")}"><defs>${sky}</defs><rect width="400" height="300" fill="${wall}"/>${body}</svg>`;
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
$('kicker').innerHTML = ic('star',14)+` 4,86 · ${guestApts.filter(a=>a.embassy).length} ${tx("из")} ${guestApts.length} ${tx("квартир — в ЖК Хайвил, рядом с посольством США")}`;
function renderPerks(){ $('perks').innerHTML = [['pin',tx('Центр, рядом с посольством США'),`${tx("ЖК Хайвил")} · ${guestApts.filter(a=>a.embassy).length} ${tx("квартир на карте")}`,'#map'],['key',tx('Заселение 24/7'),tx('кодовый замок, без ожидания'),''],['plane',tx('Трансфер из NQZ'),`${tx('встретим с табличкой · от')} ${gm(8000)}`,'#transfer'],['paw',tx('Можно с питомцем'),`${guestApts.filter(a=>a.pets.allowed).length} ${tx("квартир принимают животных")}`,'#pets']]
  .map(([i,b,s,h])=>h ? `<a class="perk link" href="${h}" ${h==='#pets'?'data-petperk':''}><span class="pi">${ic(i,20)}</span><div><b>${b}</b><span>${s}</span></div>${ic('arrowR',16)}</a>` : `<div class="perk"><span class="pi">${ic(i,20)}</span><div><b>${b}</b><span>${s}</span></div></div>`).join(''); }
renderPerks();
const stars5 = ic('star',15).repeat(5);
$('revs').innerHTML = [
  [tx('Дана, Алматы'),tx('Остановились в ЖК Хайвил на 3 ночи. Чисто, всё как на фото, заселение по коду в час ночи — без проблем.'),'#0f5566'],
  [tx('Ержан, Караганда'),tx('Командировка на неделю, жил в Хайвиле — до посольства США пешком, центр рядом. Документы для бухгалтерии сделали сразу, водитель встретил с табличкой.'),'#e0a526'],
  [tx('Мария, Москва'),tx('Приехали с собакой — нашли квартиру, где можно с животными. Ответили в Telegram за пару минут.'),'#e76f51']
].map(([w,t,c])=>`<div class="rev"><div style="color:#e0a526">${stars5}</div><div style="margin-top:8px;color:#3b4d57">«${t}»</div><div class="who"><span class="av" style="background:${c}">${w[0]}</span><b>${w}</b></div></div>`).join('');

/* ---------- поиск: одна разметка для блока на первом экране и для выпадающей панели ---------- */
function searchFormHTML(p){
  return `<button type="button" class="sf dsf" data-dp-search="ci"><span class="lb">${ic('calendar',14)} ${tx("Заезд")}</span><span class="dv" id="${p}Ci"></span></button>
    <button type="button" class="sf dsf" data-dp-search="co"><span class="lb">${ic('calendar',14)} ${tx("Выезд")}</span><span class="dv" id="${p}Co"></span></button>
    <div class="sf"><label for="${p}G">${tx("Гости")}</label><select id="${p}G" data-sf="guests">${[1,2,3,4,5,6].map(n=>`<option value="${n}">${guestsWord(n)}</option>`).join('')}</select></div>
    <div class="sf"><label for="${p}D">${tx("Район")}</label><select id="${p}D" data-sf="district"><option value="">${tx("Все районы")}</option>${DISTRICTS.map(d=>`<option value="${d}">${tx(d)}</option>`).join('')}</select></div>
    <div class="sf"><label for="${p}P">${tx("Цена за ночь")}</label><select id="${p}P" data-sf="maxPrice"><option value="0">${tx("Любая")}</option>${[20000,25000,35000,50000].map(v=>`<option value="${v}">${tx("до")} ${gm(v)}</option>`).join('')}</select></div>
    <button class="btn gold" type="submit">${ic('search',18)} ${tx("Найти")}</button>
    <div class="sf-extra"><label class="petsw"><input type="checkbox" data-sf="pets" id="${p}Pets"><span class="sw"></span>${ic('paw',16)} ${tx("Можно с животными")}</label><span class="sf-hint">${ic('calendar',14)} ${tx("Даты — в большом календаре на два месяца, с днями недели")}</span></div>`;
}
$('searchForm').innerHTML = searchFormHTML('h');
$('sheetForm').innerHTML = searchFormHTML('s');
function syncSearch(){
  ['h','s'].forEach(p=>{
    $(p+'Ci').innerHTML = G.ci!=null ? `<b>${fDW(G.ci)}</b>` : tx('<span class="ph">Добавьте дату</span>');
    $(p+'Co').innerHTML = G.co!=null ? `<b>${fDW(G.co)}</b>` : tx('<span class="ph">Добавьте дату</span>');
    $(p+'G').value=String(G.guests); $(p+'D').value=G.district; $(p+'P').value=String(G.maxPrice); $(p+'Pets').checked=G.pets;
  });
  document.querySelectorAll('[data-rooms]').forEach(b=>b.classList.toggle('on', b.dataset.rooms===G.rooms));
  const pc=$('petChip'); if(pc) pc.classList.toggle('on', G.pets);
  renderSbar();
}
function renderSbar(){
  const n = G.ci!=null&&G.co!=null ? G.co-G.ci : 0;
  const dates = n ? (mm(G.ci)===mm(G.co) ? `${dd(G.ci)}–${dd(G.co)} ${MON_S[mm(G.co)]}` : `${fD(G.ci)} – ${fD(G.co)}`) : tx('Любые даты');
  const f = [G.district?tx(G.district):tx('Вся Астана')].concat(G.maxPrice?[`${tx("до")} ${gm(G.maxPrice)}`]:[], G.rooms?[tx(G.rooms)]:[]).join(', ');
  $('sbar').innerHTML = `<span class="sb-ic">${ic('search',16)}</span><span class="sb-t"><b>${dates}</b>${n?` <span class="sb-n">· ${nightsWord(n)}</span>`:''}</span><span class="sb-d">·</span><span class="sb-t">${guestsWord(G.guests)}</span><span class="sb-d hide-xs">·</span><span class="sb-t hide-xs">${esc(f)}${G.pets?' '+ic('paw',14):''}</span><span class="sb-go">${ic('sliders',15)}<span class="hide-xs">${tx("Изменить")}</span></span>`;
}
function setSearch(k, v){ G[k]=v; syncSearch(); renderGrid(); }
function openSheet(){ $('ssheet').classList.add('open'); syncSearch(); }
function closeSheet(){ $('ssheet').classList.remove('open'); }
/* компактная панель поиска: появляется, когда большой блок поиска ушёл за верх экрана */
new IntersectionObserver(([en])=>{ const show = !en.isIntersecting && en.boundingClientRect.top < 0; document.body.classList.toggle('sb-on', show); $('sbar').hidden = !show; if(!show) closeSheet(); }, {rootMargin:'-70px 0px 0px 0px'}).observe($('searchForm'));

/* ---------- каталог ---------- */
$('roomChips').innerHTML = [['',tx('Все')],['Студия',tx('Студии')],['1-комн.',tx('1-комн.')],['2-комн.',tx('2-комн.')],['3-комн.',tx('3-комн.')]].map(([k,l])=>`<button class="fchip" data-rooms="${k}">${l}</button>`).join('') + `<button class="fchip pet" id="petChip" data-petchip>${ic('paw',14)} ${tx("С животными")}</button>`;
function filtered(){
  let L = guestApts.filter(a=> a.maxGuests>=G.guests && (!G.district || a.district===G.district) && (!G.maxPrice || a.price<=G.maxPrice) && (!G.rooms || a.rooms===G.rooms) && (!G.pets || a.pets.allowed));
  if(G.ci!=null && G.co!=null) L = L.filter(a=>rangeFree(a.id,G.ci,G.co));
  const s = {pop:(a,b)=>b.reviews-a.reviews, cheap:(a,b)=>a.price-b.price, exp:(a,b)=>b.price-a.price, rate:(a,b)=>b.rating-a.rating}[G.sort];
  return L.sort(s);
}
function renderGrid(){
  const L = filtered(); const n = G.ci!=null&&G.co!=null ? G.co-G.ci : 0;
  $('resInfo').textContent = n ? `${tx("Свободно")} ${L.length} ${tx("из")} ${guestApts.length} ${tx("на")} ${fDL(G.ci)} – ${fDL(G.co)} (${nightsWord(n)})${G.pets?tx(' · можно с животными'):''}` : `${L.length} ${plural(L.length,tx('квартира'),tx('квартиры'),tx('квартир'))}${G.pets?tx(' с животными'):''} ${tx("· выберите даты, чтобы увидеть свободные")}`;
  $('grid').innerHTML = L.length ? L.map(a=>`<article class="apt" data-open="${a.id}" tabindex="0">
    <div class="ph">${photo(a,a.id%3,'g'+a.id)}${n?tx('<span class="badge free">Свободно на ваши даты</span>'):a.reviews>120?tx('<span class="badge">Популярное</span>'):a.rating>=4.9?tx('<span class="badge">Гости в восторге</span>'):''}<button class="fav ${fav.has(a.id)?'on':''}" data-fav="${a.id}" aria-label="${tx("В избранное")}">${ic('star',17)}</button>${a.pets.allowed?`<span class="pawb" title="${esc(petText(a.pets))}">${ic('paw',14)} ${tx("можно с животными")}</span>`:''}</div>
    <div class="bd"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="loc">${ic('pin',14)} ${tx(a.district)} · ${a.near}</span><span class="rt">${ic('star',14)} ${aptRating(a)} <small>(${a.reviews})</small></span></div>
      <h3>${esc(a.title)}</h3>
      <div class="feat"><span>${ic('bed',15)} ${tx(a.rooms)}</span><span>${ic('users',15)} ${tx("до")} ${a.maxGuests}</span><span>${ic('home',15)} ${a.area} ${tx("м²")}</span>${a.parking?`<span>${ic('parking',15)} ${tx("парковка")}</span>`:''}</div>
      <div class="pr"><div><b>${gmN(a)}</b> <small>${tx("/ ночь")}</small>${n?`<div><small>${tx("итого")} ${fc(nightC(a)*n)} ${tx("за")} ${nightsWord(n)}</small></div>`:''}</div><span class="btn brand sm">${tx("Подробнее")}</span></div></div></article>`).join('')
    : `<div class="empty" style="grid-column:1/-1">${ic('search',28)}<div style="margin:10px 0 12px;font-weight:600;color:#10212b">${tx("На эти даты с такими условиями свободных квартир нет")}</div><button class="btn sm" data-reset>${tx("Сбросить фильтры")}</button></div>`;
  renderMap();
  const sc=$('sheetCount'); if(sc) sc.textContent = `${tx("Показать")} ${L.length} ${plural(L.length,tx('квартиру'),tx('квартиры'),tx('квартир'))}`;
}
/* ---------- условная схема Астаны ---------- */
const kvW = n => IS_EN ? (n===1?'apt':'apts') : 'кв.';
const DZ = {
  'Сарыарка':   {c:'#bfdbfe', d:'M40 60 L250 40 L262 150 L230 176 L40 170 Z', p:[150,108]},
  'Байконур':   {c:'#c7d2fe', d:'M250 40 L410 50 L420 168 L330 184 L262 150 Z', p:[335,110]},
  'Алматинский':{c:'#fde68a', d:'M410 50 L570 70 L580 300 L450 290 L420 168 Z', p:[495,175]},
  'Есиль':      {c:'#bbf7d0', d:'M230 200 L420 190 L450 290 L420 350 L250 350 Z', p:[338,270]},
  'Нура':       {c:'#fbcfe8', d:'M30 190 L230 200 L250 350 L40 370 Z', p:[135,285]}
};
function renderMap(){
  const base = guestApts.filter(a=> a.maxGuests>=G.guests && (!G.maxPrice || a.price<=G.maxPrice) && (!G.rooms || a.rooms===G.rooms) && (!G.pets || a.pets.allowed) && (G.ci==null||G.co==null||rangeFree(a.id,G.ci,G.co)));
  const cnt = d => base.filter(a=>a.district===d).length;
  const minP = d => { const l=guestApts.filter(a=>a.district===d); return l.length?Math.min(...l.map(a=>a.price)):0; };
  const river = 'M600 150 C520 160 470 200 420 186 C360 170 320 205 250 194 C180 184 120 170 0 182';
  document.getElementById('mapBox').innerHTML = `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${tx("Условная схема Астаны с районами")}">
    <rect width="600" height="400" fill="#f2f0ea"/>
    <g stroke="#e4e0d6" stroke-width="1">${Array.from({length:14},(_,i)=>`<path d="M${i*46} 0 V400"/>`).join('')}${Array.from({length:10},(_,i)=>`<path d="M0 ${i*44} H600"/>`).join('')}</g>
    ${Object.entries(DZ).map(([n,z])=>`<g class="dist" data-dist="${n}"><path d="${z.d}" fill="${z.c}" opacity="${!G.district||G.district===n?.85:.35}" stroke="#fff" stroke-width="3"/></g>`).join('')}
    <path d="${river}" fill="none" stroke="#7cc3dc" stroke-width="16" stroke-linecap="round"/><path d="${river}" fill="none" stroke="#a5d8ea" stroke-width="6" stroke-linecap="round"/>
    <text x="60" y="200" font-size="12" fill="#3b7f96" font-style="italic">${tx("р. Есиль")}</text>
    <path d="M450 290 C480 320 510 345 530 356" stroke="#cbbfa8" stroke-width="4" stroke-dasharray="8 6" fill="none"/>
    <g transform="translate(530 356)"><circle r="16" fill="#fff" stroke="#10212b" stroke-width="1.5"/><svg x="-9" y="-9" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10212b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I.plane}</svg></g>
    <text x="500" y="392" font-size="11.5" font-weight="700" fill="#10212b">${tx("Аэропорт NQZ")}</text>
    <g transform="translate(300 232)"><rect x="-2" y="-18" width="4" height="18" fill="#10212b"/><circle cy="-22" r="6" fill="#e0a526" stroke="#10212b" stroke-width="1.5"/><text x="10" y="-4" font-size="11" fill="#10212b" font-weight="600">${tx("Байтерек")}</text></g>
    <g transform="translate(268 330)"><path d="M-10 0 L0 -18 L10 0Z" fill="#10212b"/><text x="13" y="-2" font-size="11" fill="#10212b" font-weight="600">${tx("Хан Шатыр")}</text></g>
    <g transform="translate(80 340)"><circle r="9" fill="#10212b"/><circle r="4" fill="#7cc3dc"/><text x="13" y="4" font-size="11" fill="#10212b" font-weight="600">${tx("ЭКСПО")}</text></g>
    <g class="hv" transform="translate(376 222)"><circle r="9" fill="#e0a526" stroke="#10212b" stroke-width="1.5"/><path d="M0-5l1.5 3 3.3.5-2.4 2.3.6 3.3L0 2.5l-3 1.6.6-3.3-2.4-2.3 3.3-.5z" fill="#10212b"/><text x="14" y="-2" font-size="12" fill="#10212b" font-weight="800" stroke="#fff" stroke-width="3" paint-order="stroke">${tx("ЖК Хайвил")}</text><text x="14" y="12" font-size="10.5" fill="#3b4d57" font-weight="600" stroke="#fff" stroke-width="3" paint-order="stroke">${tx("большинство наших квартир")}</text></g>
    <g transform="translate(414 256)"><rect x="-1" y="-16" width="2" height="18" fill="#10212b"/><rect x="1" y="-16" width="13" height="8" fill="#1d4ed8"/><path d="M1 -12h13" stroke="#fff" stroke-width="1.2"/><text x="18" y="-6" font-size="10.5" fill="#10212b" font-weight="700" stroke="#fff" stroke-width="3" paint-order="stroke">${tx("Посольство США")}</text></g>
    <g transform="translate(70 80)"><rect x="-8" y="-6" width="16" height="10" rx="2" fill="#10212b"/><text x="12" y="3" font-size="11" fill="#10212b" font-weight="600">${tx("Ж/д вокзал")}</text></g>
    ${Object.entries(DZ).map(([n,z])=>{ const c=cnt(n); return `<g class="pin" data-dist="${n}" transform="translate(${z.p[0]} ${z.p[1]})">
      <text y="30" text-anchor="middle" font-size="12.5" font-weight="700" fill="#10212b" stroke="#fff" stroke-width="3" paint-order="stroke">${tx(n)}</text>
      <g class="pin-b" style="transform-origin:0 0;transition:transform .15s"><path d="M0 12 C-4 4 -20 -2 -20 -16 A20 20 0 1 1 20 -16 C20 -2 4 4 0 12Z" fill="${G.district===n?'#e0a526':'#0b3b4a'}" stroke="#fff" stroke-width="2"/>
      <text y="-10" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">${c}</text></g></g>`; }).join('')}
  </svg><span class="note">${tx("Схема условная, не в масштабе · демо")}</span>`;
  document.getElementById('dlist').innerHTML = `<button class="dl ${!G.district?'on':''}" data-dist=""><span class="sw" style="background:#0b3b4a"></span><div><b>${tx("Все районы")}</b><small>${tx("вся Астана")}</small></div><span class="n">${base.length} ${kvW(base.length)}</span></button>`
    + DISTRICTS.map(d=>`<button class="dl ${G.district===d?'on':''}" data-dist="${d}"><span class="sw" style="background:${DZ[d].c}"></span><div><b>${tx(d)}</b><small>${d==='Есиль'?tx('ЖК Хайвил, посольство США'):LANDMARK[d]} ${tx("· от")} ${gm(minP(d))}</small></div><span class="n">${cnt(d)} ${kvW(cnt(d))}</span></button>`).join('');
}

/* ---------- большой календарь: выбор периода (и одной даты для трансфера) ----------
   Состояния живут в PK: search — поиск на главной, apt — даты внутри квартиры (с занятостью),
   trArr/trDep — даты прилёта/вылета для трансфера, dp — временная копия для всплывающего окна. */
const PK = {};
const WDN = [tx('Пн'),tx('Вт'),tx('Ср'),tx('Чт'),tx('Пт'),tx('Сб'),tx('Вс')];
const isMob = () => matchMedia('(max-width:700px)').matches;
const monthIdx = d => { let k=0; MONTHS.forEach((ms,i)=>{ if(d>=ms) k=i; }); return k; };
function firstBusyFrom(aptId, from){ for(let d=from; d<=MAX_DAY; d++) if(nightBusy(aptId,d)) return d; return MAX_DAY+1; }
function cellHTML(s, d, lim){
  const cls=[]; let dis=false, title=fDL(d);
  const past = d<TODAY; const w=wd(d); if(w===0||w===6) cls.push('we');
  if(s.mode==='single'){
    const out = d<(s.min!=null?s.min:TODAY) || d>(s.max!=null?s.max:MAX_DAY);
    if(past){ cls.push('past'); dis=true; } else if(out){ cls.push('out'); dis=true; }
    if(d===s.d) cls.push('start','end');
  } else {
    const busy = !past && s.aptId && nightBusy(s.aptId,d);
    const picking = s.ci!=null && s.co==null;
    if(past || d>MAX_DAY){ cls.push('past'); dis=true; }
    else if(picking && lim!=null && d>s.ci && d<=lim && busy){ cls.push('coo'); title+=tx(' — только выезд: дальше занято'); }
    else if(busy){ cls.push('busy'); dis=true; title+=tx(' — занято'); }
    else if(picking && lim!=null && d>lim){ cls.push('out'); dis=true; title+=tx(' — нельзя: между датами есть занятые дни'); }
    if(d===s.ci) cls.push('start'); if(d===s.co) cls.push('end');
    if(s.ci!=null && s.co!=null){ if(d>s.ci && d<s.co) cls.push('inr'); if(d===s.ci||d===s.co) cls.push('rng'); }
  }
  if(d===TODAY){ cls.push('today'); title+=tx(' — сегодня'); }
  return `<button type="button" class="dc ${cls.join(' ')}" data-d="${d}" ${dis?'disabled':''} title="${title}" aria-label="${title}"><span>${dd(d)}</span></button>`;
}
function monthHTML(s, k, nav, wdRow, lim){
  const ms=MONTHS[k], m=mm(ms), y=dt(ms).getUTCFullYear(), days=new Date(Date.UTC(y,m+1,0)).getUTCDate(), lead=(wd(ms)+6)%7;
  const nb = (dir, on) => on===undefined ? '<span class="navsp"></span>' : `<button type="button" class="navb" data-dpnav="${dir}" ${on?'':'disabled'} aria-label="${dir<0?tx('Предыдущий'):tx('Следующий')} месяц">${ic(dir<0?'chevL':'chevR',16)}</button>`;
  let h = `<div class="dpm"><div class="dpm-h">${nb(-1,nav.prev)}<b>${MON_N[m]} ${y}</b>${nb(1,nav.next)}</div>`;
  if(wdRow) h += `<div class="dpg wdr">${WDN.map((w,i)=>`<span class="${i>4?'we':''}">${w}</span>`).join('')}</div>`;
  h += `<div class="dpg">${'<span></span>'.repeat(lead)}`; for(let i=0;i<days;i++) h+=cellHTML(s, ms+i, lim);
  return h + '</div></div>';
}
function legendHTML(s){
  if(!s.aptId || s.mode!=='range') return '';
  return `<div class="dp-leg"><span><i class="lg-free"></i>${tx("свободно")}</span><span><i class="lg-busy"></i>${tx("занято")}</span><span><i class="lg-sel"></i>${tx("ваши даты")}</span><span><i class="lg-today"></i>${tx("сегодня")}</span></div>`;
}
function containerHTML(key, view){
  const s=PK[key]; const lim = (s.aptId && s.mode==='range' && s.ci!=null && s.co==null) ? firstBusyFrom(s.aptId, s.ci) : null;
  const last = MONTHS.length-1;
  if(view==='overlay' && isMob()) return `<div class="dpms col">${MONTHS.map((_,k)=>monthHTML(s,k,{},false,lim)).join('')}</div>`;
  if(view==='inline' && isMob()){ s.off=Math.min(s.off||0,last); return `<div class="dpms">${monthHTML(s,s.off,{prev:s.off>0,next:s.off<last},true,lim)}</div>${legendHTML(s)}`; }
  s.off = Math.max(0, Math.min(s.off||0, last-1));
  return `<div class="dpms two">${monthHTML(s,s.off,{prev:s.off>0},true,lim)}${monthHTML(s,s.off+1,{next:s.off<last-1},true,lim)}</div>${legendHTML(s)}`;
}
function renderPK(key){
  document.querySelectorAll(`[data-pk="${key}"]`).forEach(c=>{ c.innerHTML = containerHTML(key, c.dataset.view); });
  if(key==='dp') renderDPFoot();
}
function dpSummary(s){
  if(s.mode==='single') return s.d!=null ? `<b>${fDW(s.d)}</b>` : tx('<span class="muted">Выберите дату</span>');
  if(s.ci==null) return `<span class="muted">${s.aptId?tx('Выберите дату заезда — занятые дни зачёркнуты'):tx('Выберите дату заезда')}</span>`;
  if(s.co==null) return `<b>${tx("Заезд")} ${fDW(s.ci)}</b><span class="muted"> ${tx("— теперь выберите дату выезда")}</span>`;
  const n=s.co-s.ci;
  return `<b>${fD(s.ci)} → ${fD(s.co)}</b> · ${nightsWord(n)}${s.price?` · <b>${gm(s.price*n+(s.extra?s.extra():0))}</b>`:''}`;
}
function renderDPFoot(){ const s=PK.dp; $('dpSum').innerHTML = dpSummary(s); $('dpDone').disabled = s.mode==='range' && s.ci!=null && s.co==null; }
/* клик по дню: возвращает 'done' для выбора одной даты */
function pickDay(s, d){
  if(s.mode==='single'){ s.d=d; return 'done'; }
  if(s.ci!=null && s.co==null && d>s.ci){
    if(s.aptId && !rangeFree(s.aptId,s.ci,d)){ toast(tx('В этом периоде есть занятые даты — выберите выезд раньше')); return; }
    s.co=d; return 'range';
  }
  if(s.aptId && nightBusy(s.aptId,d)){ toast(tx('Эта дата занята')); return; }
  s.ci=d; s.co=null; return 'start';
}
function openDP(target, part, title, sub){
  const t=PK[target]; const s = PK.dp = Object.assign({}, t, {target});
  if(s.mode==='range' && part==='co' && s.ci!=null) s.co=null;
  const focus = s.mode==='single' ? (s.d!=null?s.d:(s.min!=null?s.min:TODAY)) : (s.ci!=null?s.ci:TODAY);
  s.off = monthIdx(focus);
  $('dpTitle').textContent = title; $('dpSub').textContent = sub||'';
  const dp=$('dp'); dp.classList.add('open'); dp.dataset.mode=s.mode; document.body.classList.add('dp-lock');
  renderPK('dp');
  if(isMob()){ const b=$('dpBody'); const el=b.querySelectorAll('.dpm')[monthIdx(focus)]; b.scrollTop = el ? el.offsetTop-6 : 0; }
  setTimeout(()=>{ const f=$('dpBody').querySelector('.dc.start:not([disabled])')||$('dpBody').querySelector('.dc:not([disabled])'); if(f && !isMob()) f.focus({preventScroll:true}); }, 30);
}
function closeDP(){ $('dp').classList.remove('open'); if(!$('modal').classList.contains('open')) document.body.classList.remove('dp-lock'); }
function commitDP(){
  const s=PK.dp, t=PK[s.target];
  if(s.mode==='single') t.d=s.d; else { if(s.ci!=null && s.co==null) return; t.ci=s.ci; t.co=s.co; }
  closeDP(); if(t.onDone) t.onDone();
}
function hoverPreview(box, cell){
  const s=PK[box.dataset.pk]; if(!s || s.mode!=='range' || s.ci==null || s.co!=null) return;
  const d = cell ? +cell.dataset.d : -1; const ok = cell && !cell.disabled && d>s.ci;
  box.querySelectorAll('.dc').forEach(x=>{ const v=+x.dataset.d; x.classList.toggle('hov', !!ok && v>s.ci && v<d); x.classList.toggle('hovend', !!ok && v===d); });
  box.querySelectorAll('.dc.start').forEach(x=>x.classList.toggle('rng', !!ok));
  if(box.dataset.pk==='dp') $('dpSum').innerHTML = ok ? `<b>${fD(s.ci)} → ${fD(d)}</b> · ${nightsWord(d-s.ci)}${s.price?` · <b>${gm(s.price*(d-s.ci)+(s.extra?s.extra():0))}</b>`:''}` : dpSummary(s);
}
/* состояние поиска на главной */
PK.search = {mode:'range', aptId:null, ci:null, co:null, off:0, onDone(){ G.ci=PK.search.ci; G.co=PK.search.co; syncSearch(); renderGrid(); }};

/* ---------- трансфер: блок заказа (в форме брони и отдельный заказ) ---------- */
const newTr = o => Object.assign({on:false, place:'airport', dir:'from', cls:'standard', arrDate:null, arrTime:'', arrCode:'', depDate:null, depTime:'', depCode:'', pax:2, bags:2, seats:0, sign:''}, o||{});
const TR = {bk:newTr(), sa:newTr()};
const fits = (T, cls) => T.pax<=TR_CLASSES[cls].pax && T.bags<=TR_CLASSES[cls].bags;
const roundSave = (place, cls) => TR_PRICES[place][cls].one*2 - TR_PRICES[place][cls].round;
function trAuto(T){ if(!fits(T,'standard')) T.cls='minivan'; }
function stepperHTML(k, label, val, min, max, sub){
  return `<div class="stp2"><div><b>${label}</b>${sub?`<small>${sub}</small>`:''}</div><div class="stp2-c"><button type="button" data-trstep="${k}" data-delta="-1" ${val<=min?'disabled':''} aria-label="${tx("Меньше")}">−</button><output>${val}</output><button type="button" data-trstep="${k}" data-delta="1" ${val>=max?'disabled':''} aria-label="${tx("Больше")}">+</button></div></div>`;
}
function trLegHTML(T, kind){
  const P=TR_PLACES[T.place]; const arr=kind==='arr'; const d=arr?T.arrDate:T.depDate; const tm=arr?T.arrTime:T.depTime; const code=arr?T.arrCode:T.depCode;
  const air = T.place==='airport';
  const head = arr ? `${ic(air?'plane':'train',16)} ${air?tx('Прилёт'):tx('Прибытие поезда')} ${tx("— встреча с табличкой")}` : `${ic('home',16)} ${air?tx('Вылет'):tx('Отправление поезда')} ${tx("— подача к дому")}`;
  const pick = !arr && tm ? hmAdd(tm, -P.lead) : '';
  const hint = arr ? `${tx("Водитель встретит")} ${P.meet} ${tx("с табличкой.")} ${air?tx('Следим за рейсом: при задержке подождём, '):''}${tx("ожидание")} ${P.wait} ${tx("мин бесплатно.")}`
    : (pick ? `${tx("Подача к дому в")} <b>${pick}</b> ${tx("— за ")} ${P.lead/60} ${plural(P.lead/60,tx('час'),tx('часа'),tx('часов'))} ${air?tx('до вылета'):tx('до отправления')}.` : `${tx("Машина приедет за")} ${P.lead/60} ${plural(P.lead/60,tx('час'),tx('часа'),tx('часов'))} ${air?tx('до вылета'):tx('до отправления')}.`);
  return `<div class="trleg"><div class="trleg-h">${head}</div><div class="tr3">
    <div class="field"><label>${arr?(air?tx("Дата прилёта"):tx("Дата прибытия")):(air?tx("Дата вылета"):tx("Дата отправления"))}</label><button type="button" class="inp dbtn ${d==null?'empty':''}" data-trdate="${kind}">${ic('calendar',16)} ${d!=null?fDW(d):tx('Выбрать дату')}</button></div>
    <div class="field"><label>${arr?(air?tx("Время прилёта"):tx("Время прибытия")):(air?tx("Время вылета"):tx("Время отправления"))}</label><select class="inp" data-trf="${arr?'arrTime':'depTime'}">${timeOpts(tm,tx('Выберите'))}</select></div>
    <div class="field"><label>${P.code} <span class="opt">${arr&&air?'':tx('(необяз.)')}</span></label><input class="inp" data-trf="${arr?'arrCode':'depCode'}" value="${esc(code)}" placeholder="${P.codePh}" autocomplete="off"></div></div>
    <div class="trhint">${ic('clock',14)}<span>${hint}</span></div></div>`;
}
function trPriceHTML(T){
  const p=trPrice(T);
  return `<div class="trsum">${p.lines.map(([l,v])=>`<div class="ln ${v<0?'save':''}"><span>${l}</span><span>${v<0?'−'+gm(-v):gm(v)}</span></div>`).join('')}<div class="ln tot"><span>${tx("Трансфер итого")}</span><span>${gm(p.total)}</span></div></div>`;
}
function trBlockHTML(T, c){
  trAuto(T); const P=TR_PLACES[T.place];
  return `<div class="trb" data-tr="${c}">
    <div class="trrow"><div class="lbl">${tx("Где встретить или куда отвезти")}</div><div class="seg">
      ${[['airport','plane',tx('Аэропорт NQZ'),tx('Международный аэропорт Астаны')],['station','train',tx('Ж/д вокзал «Нурлы Жол»'),tx('Главный вокзал, левый берег')]].map(([k,i,b,s])=>`<button type="button" class="${T.place===k?'on':''}" data-trk="place" data-v="${k}">${ic(i,18)}<span><b>${b}</b><small>${s}</small></span></button>`).join('')}</div></div>
    <div class="trrow"><div class="lbl">${tx("Направление")}</div><div class="seg three">
      ${[['from',T.place==='airport'?tx('встреча с табличкой'):tx('встреча у вагона')],['to',tx('подача к дому')],['round',`${tx("выгоднее на")} ${gm(roundSave(T.place,T.cls))}`]].map(([k,s])=>`<button type="button" class="${T.dir===k?'on':''}" data-trk="dir" data-v="${k}">${ic(k==='round'?'swap':k==='from'?'in':'out',17)}<span><b>${P.dirs[k]}</b><small class="${k==='round'?'save':''}">${s}</small></span></button>`).join('')}</div></div>
    ${T.dir!=='to'?trLegHTML(T,'arr'):''}${T.dir!=='from'?trLegHTML(T,'dep'):''}
    <div class="trrow"><div class="lbl">${tx("Пассажиры и багаж")}</div><div class="stps">
      ${stepperHTML('pax',tx('Пассажиры'),T.pax,1,7,tx('включая детей'))}${stepperHTML('bags',tx('Чемоданы'),T.bags,0,8,tx('ручная кладь не в счёт'))}${stepperHTML('seats',tx('Детские кресла'),T.seats,0,3,`+${gm(TR_SEAT)} ${tx("за поездку")}`)}</div></div>
    <div class="trrow"><div class="lbl">${tx("Класс автомобиля")}</div><div class="cls2">
      ${Object.entries(TR_CLASSES).map(([k,C])=>{ const ok=fits(T,k); const pr=TR_PRICES[T.place][k]; return `<button type="button" class="clsc ${T.cls===k?'on':''}" data-trk="cls" data-v="${k}" ${ok?'':'disabled'}>
        <span class="cl-car">${carSVG(k)}</span><span class="cl-t"><b>${C.name}</b><small>${C.car}</small><small>${ic('users',13)} ${tx("до")} ${C.pax} · ${ic('luggage',13)} ${tx("до")} ${C.bags} ${tx("чемоданов")}</small></span>
        <span class="cl-p">${ok?`<b>${gm(T.dir==='round'?pr.round:pr.one)}</b><small>${T.dir==='round'?tx('туда и обратно'):tx('в одну сторону')}</small>`:tx('<small class="bad">не поместятся</small>')}</span></button>`; }).join('')}</div>
      ${!fits(T,'standard')?`<div class="trhint">${ic('alert',14)}<span>${T.pax} ${tx("пасс. и")} ${T.bags} ${plural(T.bags,tx('чемодан'),tx('чемодана'),tx('чемоданов'))} ${tx("не поместятся в седан — выбран минивэн.")}</span></div>`:''}</div>
    <div class="field"><label>${tx("Имя на табличке")}</label><input class="inp" data-trf="sign" value="${esc(T.sign)}" placeholder="${tx("Например, AIDANA SERIKOVA")}" autocomplete="off"></div>
    <div class="trp" id="${c}TrPrice">${trPriceHTML(T)}</div>
  </div>`;
}
function carSVG(k){
  const body = k==='minivan'
    ? '<path d="M6 30 L10 14 Q11 11 15 11 L52 11 Q58 11 61 16 L68 24 Q72 25 72 30 L72 34 L6 34Z" fill="#0f5566"/><path d="M14 14h12v9H12zM29 14h13v9H29zM45 14h8q3 0 5 3l4 6H45z" fill="#cfe7ee"/>'
    : '<path d="M4 31 Q4 25 10 24 L20 22 L28 14 Q30 12 34 12 L48 12 Q52 12 55 15 L62 22 L70 24 Q74 25 74 30 L74 34 L4 34Z" fill="#0b3b4a"/><path d="M24 22 L31 15 H40 V22Z M43 15 H48 Q50 15 52 17 L57 22 H43Z" fill="#cfe7ee"/>';
  return `<svg viewBox="0 0 78 42" width="78" height="42" aria-hidden="true">${body}<circle cx="20" cy="34" r="6" fill="#10212b"/><circle cx="20" cy="34" r="2.5" fill="#cbd5dc"/><circle cx="58" cy="34" r="6" fill="#10212b"/><circle cx="58" cy="34" r="2.5" fill="#cbd5dc"/><rect x="70" y="27" width="4" height="3" rx="1" fill="#e0a526"/></svg>`;
}
const trData = T => ({place:T.place, dir:T.dir, cls:T.cls, arrDate:T.dir!=='to'?T.arrDate:null, arrTime:T.dir!=='to'?T.arrTime:'', arrCode:T.dir!=='to'?T.arrCode:'', depDate:T.dir!=='from'?T.depDate:null, depTime:T.dir!=='from'?T.depTime:'', depCode:T.dir!=='from'?T.depCode:'', pax:T.pax, bags:T.bags, seats:T.seats, sign:T.sign, price:trPrice(T).total});
/* проверка блока трансфера; bad(el, msg) подсвечивает поле */
function trValidate(T, c, bad){
  const q = s => document.querySelector(`[data-tr="${c}"] ${s}`);
  if(T.dir!=='to'){ if(T.arrDate==null) return bad(q('[data-trdate="arr"]'),tx('Трансфер: выберите дату прилёта')); if(!T.arrTime) return bad(q('[data-trf="arrTime"]'),tx('Трансфер: укажите время прилёта — водитель будет ждать к этому времени'));
    if(T.place==='airport' && T.arrCode.trim().length<3) return bad(q('[data-trf="arrCode"]'),tx('Трансфер: укажите номер рейса — по нему водитель отследит задержку')); }
  if(T.dir!=='from'){ if(T.depDate==null) return bad(q('[data-trdate="dep"]'),tx('Трансфер: выберите дату вылета')); if(!T.depTime) return bad(q('[data-trf="depTime"]'),tx('Трансфер: укажите время вылета — рассчитаем время подачи')); }
  if(T.dir==='round' && (T.depDate<T.arrDate || (T.depDate===T.arrDate && T.depTime<=T.arrTime))) return bad(q('[data-trdate="dep"]'),tx('Трансфер: обратная поездка должна быть позже прилёта'));
  if(!fits(T,T.cls)) return bad(q('[data-trk="cls"]'),tx('Трансфер: выберите минивэн — в седан столько не поместится'));
  return true;
}
function rerenderTr(c){
  const el=document.querySelector(`[data-tr="${c}"]`); if(!el) return;
  el.outerHTML = trBlockHTML(TR[c], c);
  if(c==='bk' && M.step==='form') refreshFormBits(); if(c==='sa') refreshTrSide();
}
function openTrDate(c, kind){
  const T=TR[c]; const key=c+(kind==='arr'?'Arr':'Dep');
  const min = kind==='dep' && T.dir==='round' && T.arrDate!=null ? T.arrDate : TODAY;
  PK[key] = {mode:'single', d:kind==='arr'?T.arrDate:T.depDate, min, max:MAX_DAY, off:0, onDone(){ if(kind==='arr'){ T.arrDate=this.d; if(T.depDate!=null && T.depDate<T.arrDate) T.depDate=null; } else T.depDate=this.d; rerenderTr(c); }};
  const air=T.place==='airport';
  openDP(key, null, kind==='arr'?(air?tx('Дата прилёта'):tx('Дата прибытия поезда')):(air?tx('Дата вылета'):tx('Дата отправления поезда')), c==='bk' && M.ci!=null ? `${tx("Ваше проживание:")} ${fD(M.ci)} – ${fD(M.co)}` : tx('Трансфер · встреча и проводы'));
}

/* ---------- раздел «Трансфер» на странице ---------- */
function renderTransferSection(){
  const row = (place, cls) => { const p=TR_PRICES[place][cls]; return `<tr><td>${TR_CLASSES[cls].name}<small>${tx("до")} ${TR_CLASSES[cls].pax} ${tx("пасс. ·")} ${TR_CLASSES[cls].bags} ${tx("чем.")}</small></td><td class="num">${gm(p.one)}</td><td class="num"><b>${gm(p.round)}</b><small class="save">−${gm(p.one*2-p.round)}</small></td></tr>`; };
  $('trSec').innerHTML = `
  <div class="tr-grid">
    <div class="tr-info">
      <div class="tr-sign" aria-hidden="true"><div class="sg-card"><small>ASTANA STAY</small><b>AIDANA SERIKOVA</b></div><div class="sg-txt"><b>${tx("Встретим с табличкой")}</b><span>${tx("в аэропорту NQZ или на вокзале «Нурлы Жол» и довезём до двери")}</span></div></div>
      <ul class="tr-points">
        <li><span class="pi">${ic('sign',18)}</span><div><b>${tx("Табличка с вашим именем")}</b><span>${tx("Аэропорт — в зоне прилёта у выхода из таможни; вокзал — у выхода с платформы в главном зале.")}</span></div></li>
        <li><span class="pi">${ic('clock',18)}</span><div><b>${tx("Бесплатное ожидание")}</b><span>${tx("60 минут в аэропорту (следим за рейсом — задержка не страшна) и 20 минут на вокзале.")}</span></div></li>
        <li><span class="pi">${ic('luggage',18)}</span><div><b>${tx("Поможем с багажом")}</b><span>${tx("Стандарт — до 4 пассажиров и 3 чемоданов, минивэн — до 7 и 7. Цена за машину, а не за человека.")}</span></div></li>
        <li><span class="pi">${ic('baby',18)}</span><div><b>${tx("Детское кресло")}</b><span>${tx("По запросу, +")}${gm(TR_SEAT)} ${tx("за поездку. Ночью (23:00–06:00) +")}${gm(TR_NIGHT)}.</span></div></li>
        <li><span class="pi">${ic('cash',18)}</span><div><b>${tx("Оплата")}</b><span>${tx("Водителю наличными или Kaspi — или картой онлайн при заказе.")}</span></div></li>
      </ul>
    </div>
    <div class="tr-side">
      <div class="tr-card"><h3>${tx("Цены на трансфер")}</h3>
        <table class="prt"><thead><tr><th>${tx("Класс")}</th><th class="num">${tx("В одну сторону")}</th><th class="num">${tx("Туда и обратно")}</th></tr></thead><tbody>
          <tr class="grp"><td colspan="3">${ic('plane',15)} ${tx("Аэропорт NQZ ↔ квартира")} <small>${tx("≈ 25–35 мин")}</small></td></tr>${row('airport','standard')}${row('airport','minivan')}
          <tr class="grp"><td colspan="3">${ic('train',15)} ${tx("Вокзал «Нурлы Жол» ↔ квартира")} <small>${tx("≈ 15–20 мин")}</small></td></tr>${row('station','standard')}${row('station','minivan')}
        </tbody></table></div>
      <div class="tr-card cta"><h3>${tx("Заказать трансфер")}</h3><p>${tx("Уже забронировали жильё — у нас, на Airbnb или Booking? Закажите трансфер отдельно, это 2 минуты:")}</p>
        <div class="tr-dirs">${[['from','in',tx('Из аэропорта')],['to','out',tx('В аэропорт')],['round','swap',tx('Туда и обратно')]].map(([k,i,l])=>`<button type="button" class="btn ${k==='round'?'gold':'brand'}" data-trorder="${k}">${ic(i,17)} ${l}</button>`).join('')}</div>
        <div class="tr-note">${ic('home',15)}<span>${tx("Бронируете квартиру у нас? Трансфер добавляется прямо в форме бронирования.")} <a href="#catalog">${tx("Выбрать квартиру →")}</a></span></div></div>
    </div>
  </div>
  <div class="steps tr-steps"><div class="stp"><div class="n">1</div><b>${tx("Оформите заказ")}</b><span>${tx("Направление, рейс или поезд, пассажиры и багаж — цена считается сразу.")}</span></div><div class="stp"><div class="n">2</div><b>${tx("Подтвердим за 15 минут")}</b><span>${tx("Пришлём имя водителя, марку и номер машины в Telegram или WhatsApp.")}</span></div><div class="stp"><div class="n">3</div><b>${tx("Водитель встретит")}</b><span>${tx("С табличкой с вашим именем, поможет с багажом и довезёт до двери.")}</span></div></div>`;
}
renderTransferSection();

/* ---------- модальное окно: квартира → бронь → оплата; отдельный заказ трансфера ---------- */
const M = {flow:'booking', apt:null, step:'details', ci:null, co:null, guests:2, pet:false, pay:'card', form:{name:'',phone:'+7 ',comment:''}, photo:0, saved:null, ref:{src:'site',num:'',addr:''}, trPay:'driver'};
const SUBMIT_LBL = {card:tx('Перейти к оплате'),cash:tx('Забронировать'),telegram:tx('Продолжить в Telegram'),whatsapp:tx('Продолжить в WhatsApp')};
function showModal(){ $('modal').classList.add('open'); document.body.classList.add('dp-lock'); $('modal').scrollTop=0; }
function openApt(id){
  const a=gById(id); if(!a) return;
  Object.assign(M, {flow:'booking', apt:a, step:'details', photo:0, saved:null, guests:Math.min(G.guests,a.maxGuests), pet:G.pets && a.pets.allowed, pay:'card'});
  M.ci = G.ci; M.co = G.co;
  if(M.ci!=null && (M.co==null || !rangeFree(a.id,M.ci,M.co))){ M.ci=null; M.co=null; }
  TR.bk = newTr({pax:M.guests, bags:Math.min(M.guests,3), autoDates:true});
  PK.apt = {mode:'range', aptId:a.id, ci:M.ci, co:M.co, off:monthIdx(M.ci!=null?M.ci:TODAY), price:a.price, extra:()=>totals().pet, onDone:aptDatesChanged};
  showModal(); renderModal();
}
function closeModal(){ $('modal').classList.remove('open'); document.body.classList.remove('dp-lock'); }
function aptDatesChanged(){
  M.ci=PK.apt.ci; M.co=PK.apt.co;
  if(TR.bk.autoDates){ TR.bk.arrDate=M.ci; TR.bk.depDate=M.co; }
  if(M.step==='details') refreshDetailsBits(); else if(M.step==='form'){ if(TR.bk.on) rerenderTr('bk'); refreshFormBits(); }
}
function totals(){ const a=M.apt; const n = M.ci!=null&&M.co!=null ? M.co-M.ci : 0; const tr = TR.bk.on?trPrice(TR.bk).total:0; const pet = M.pet&&a.pets.allowed ? a.pets.fee : 0;
  const cStay = nightC(a)*n, cTr = conv(tr), cPet = conv(pet);
  return {n, stay:a.price*n, tr, pet, total:a.price*n+tr+pet, cStay, cTr, cPet, cTotal:cStay+cTr+cPet}; }
function sumHTML(){ const t=totals(); if(!t.n) return `<div class="sum muted">${tx("Выберите даты заезда и выезда в календаре")}</div>`;
  const P=TR_PLACES[TR.bk.place];
  return `<div class="sum"><div class="ln"><span>${gmN(M.apt)} × ${nightsWord(t.n)}</span><span>${fc(t.cStay)}</span></div>${TR.bk.on?`<div class="ln"><span>${tx("Трансфер:")} ${P.dirs[TR.bk.dir].toLowerCase()}${TR.bk.place==='station'&&TR.bk.dir==='round'?tx(' (вокзал)'):''}</span><span>${fc(t.cTr)}</span></div>`:''}${M.pet&&M.apt.pets.allowed?`<div class="ln"><span>${ic('paw',13)} ${tx("Проживание с животным")}</span><span>${t.pet?fc(t.cPet):tx('<span style="color:var(--ok)">бесплатно</span>')}</span></div>`:''}<div class="ln"><span>${tx("Сервисный сбор")}</span><span style="color:var(--ok)">${fc(0)}</span></div><div class="ln tot"><span>${tx("Итого")}</span><span>${fc(t.cTotal)}</span></div></div>`; }
function selText(){ const t=totals(); return M.ci!=null?(M.co!=null?`${fDL(M.ci)} → ${fDL(M.co)} · ${nightsWord(t.n)}`:`${tx("Заезд")} ${fDL(M.ci)} ${tx("— выберите дату выезда")}`):''; }
const CAPS=[tx('Гостиная'),tx('Спальня'),tx('Кухня')];
function galleryHTML(a){
  return `<div class="mgal"><div class="big">${photo(a,M.photo,'m0')}<span class="cap">${CAPS[M.photo]} ${tx("· иллюстрация")}</span></div><div class="side">${[1,2].map(k=>{ const v=(M.photo+k)%3; return `<div class="sm2" data-photo="${v}" style="cursor:pointer">${photo(a,v,'m'+k)}<span class="cap">${CAPS[v]}</span></div>`; }).join('')}</div></div>`;
}
function miniApt(a,key,sub){ return `<div class="mini-apt"><div class="th">${photo(a,0,key)}</div><div><b style="font-size:14.5px">${esc(a.title)}</b><div class="muted" style="font-size:12.5px">${sub}</div></div></div>`; }
function dateFieldsHTML(attr){
  return `<div class="dfs"><button type="button" class="dfb" ${attr}="ci" id="dfCi"><small>${tx("Заезд")}</small><b>${M.ci!=null?fDW(M.ci):tx('<span class="ph">Выбрать</span>')}</b></button><button type="button" class="dfb" ${attr}="co" id="dfCo"><small>${tx("Выезд")}</small><b>${M.co!=null?fDW(M.co):tx('<span class="ph">Выбрать</span>')}</b></button></div>`;
}
function petRuleHTML(a){ const p=a.pets;
  return `<div class="rule ${p.allowed?'ok':'no'}" id="petRule"><span class="ri">${ic('paw',17)}</span><div><b>${p.allowed?tx('Можно с животными'):tx('Без животных')}</b><span>${p.allowed?`${p.count===1?tx('Один питомец'):tx('До двух питомцев')} ${p.weight}. ${p.fee?`${tx("Доплата")} ${gm(p.fee)} ${tx("за всё проживание.")}`:tx('Без доплаты.')} ${tx("Не оставляйте питомца одного надолго, лоток и миски — ваши.")}`:tx('В этой квартире нельзя с питомцами. Ищете жильё с животным — включите фильтр «Можно с животными».')}</span></div></div>`;
}
function renderModal(){
  const a=M.apt, box=$('mbox');
  const close = `<button type="button" class="mclose" data-close aria-label="${tx("Закрыть")}">${ic('x',18)}</button>`;
  if(M.flow==='tr'){ renderTrModal(box, close); return; }
  const t=totals();
  if(M.step==='details'){
    box.innerHTML = close + galleryHTML(a) + `<div class="mcont"><div>
      <div class="loc">${ic('pin',14)} <span>${tx(a.district)} ${tx("р-н ·")} ${esc(txStreet(a.street))}${a.embassy?` · <b>${tx('рядом с посольством США')}</b>`:''}</span></div>
      <h2 style="margin:6px 0 8px">${esc(a.title)}</h2>
      <div class="feat" style="font-size:14px"><span class="rt">${ic('star',15)} ${aptRating(a)} <small>· ${a.reviews} ${tx("отзывов")}</small></span><span>${ic('bed',15)} ${tx(a.rooms)}</span><span>${ic('users',15)} ${tx("до")} ${guestsWord(a.maxGuests)}</span><span>${ic('home',15)} ${a.area} ${tx("м²")}</span>${a.pets.allowed?`<span class="pawt">${ic('paw',15)} ${tx("можно с животными")}</span>`:''}</div>
      <p style="color:var(--ink2);margin:14px 0 0">${tx("Светлая")} ${a.rooms==='Студия'?tx('студия'):ROOMS_FULL[a.rooms].toLowerCase()+tx(' квартира')} ${tx("в")} ${esc(tx(a.complex))}, ${a.near}${tx(". Полностью оборудованная кухня, свежее бельё и полотенца, быстрый Wi‑Fi. Самостоятельное заселение по коду в любое время.")}</p>
      <div class="amen"><span>${ic('wifi',18)} ${tx("Wi‑Fi 200 Мбит/с")}</span><span>${ic('key',18)} ${tx("Заселение 24/7")}</span>${a.parking?`<span>${ic('parking',18)} ${tx("Парковка")}</span>`:`<span>${ic('car',18)} ${tx("Парковка рядом")}</span>`}<span>${ic('sparkle',18)} ${tx("Уборка с фотоотчётом")}</span>${a.ac?`<span>${ic('moon',18)} ${tx("Кондиционер")}</span>`:''}<span>${ic('home',18)} ${tx("Стиральная машина")}</span>${a.balcony?`<span>${ic('building',18)} ${tx("Балкон")}</span>`:''}<a href="#transfer" data-close class="amen-l">${ic('plane',18)} ${tx("Трансфер из NQZ")}</a></div>
      <h3 class="rh">${tx("Правила проживания")}</h3>
      <div class="rules"><div class="rule"><span class="ri">${ic('clock',17)}</span><div><b>${tx("Заезд с 14:00, выезд до 12:00")}</b><span>${tx("Самостоятельное заселение по коду, ранний заезд — по запросу.")}</span></div></div>
        ${petRuleHTML(a)}
        <div class="rule"><span class="ri">${ic('shield',17)}</span><div><b>${tx("Без вечеринок и курения")}</b><span>${tx("Тишина с 23:00 до 08:00, залог не берём.")}</span></div></div></div>
      <div class="demo-note">${ic('alert',16)}<span>${tx("Фото — иллюстрации, квартира и отзывы вымышленные (демо).")}</span></div>
    </div>
    <aside class="bookbox"><div style="display:flex;align-items:baseline;justify-content:space-between"><div><b style="font-size:22px">${gmN(a)}</b> <span class="muted">${tx("/ ночь")}</span></div><span class="rt">${ic('star',14)} ${aptRating(a)}</span></div>
      ${dateFieldsHTML('data-dp-apt')}
      <div id="selInfo" class="selinfo">${selText()}</div>
      <div id="sumBox">${sumHTML()}</div>
      <button type="button" class="btn brand block" style="margin-top:12px;height:50px" data-to-form id="toFormBtn">${t.n?tx('Забронировать'):tx('Выбрать даты')}</button>
      <div class="muted" style="font-size:12.5px;text-align:center;margin-top:8px">${tx("Оплата картой, наличными или через мессенджер")}</div></aside></div>
    <div class="avail" id="availBox"><div class="avail-h"><div><h3>${tx("Свободные даты")}</h3><p class="muted">${tx("Зачёркнутые дни заняты. Нажмите на день заезда, затем на день выезда — ночи и сумма посчитаются сразу.")}</p></div></div>
      <div class="dpc inline" data-pk="apt" data-view="inline"></div></div>
    <div class="mbar"><div><b>${gmN(a)}</b> <span class="muted">${tx("/ ночь")}</span><div class="muted" style="font-size:12px" id="mbarInfo">${t.n?`${nightsWord(t.n)} · ${fc(t.cTotal)}`:tx('выберите даты')}</div></div><button type="button" class="btn brand" data-to-form>${t.n?tx('Забронировать'):tx('Выбрать даты')}</button></div>`;
    renderPK('apt');
  }
  else if(M.step==='form'){
    const payIc = {card:['card','#0f5566'],cash:['cash','#15803d'],telegram:['send','#229ED9'],whatsapp:['msg','#22B35E']};
    const paySub = {card:tx('Visa, Mastercard · мгновенное подтверждение'),cash:tx('Оплата в ₸ при заселении'),telegram:tx('Обсудить и оплатить в чате'),whatsapp:tx('Обсудить и оплатить в чате')};
    const p=a.pets;
    box.innerHTML = close + `<div class="pane has-bar"><div class="step-h"><button type="button" class="backb" data-back="details" aria-label="${tx("Назад")}">${ic('chevL',18)}</button><div><h2 style="font-size:22px">${tx("Оформление брони")}</h2><div class="muted" style="font-size:13px">${tx("Шаг 2 из 3 · без регистрации")}</div></div></div>
      <form id="bookForm" class="form-grid" novalidate><div>
        <div class="two"><div class="field"><label for="bName">${tx("Имя и фамилия")}</label><input class="inp" id="bName" value="${esc(M.form.name)}" placeholder="${tx("Айдана Серикова")}" autocomplete="name"></div>
        <div class="field"><label for="bPhone">${tx("Телефон")}</label><input class="inp" id="bPhone" type="tel" inputmode="tel" value="${esc(M.form.phone)}" placeholder="+7 7__ ___ __ __" autocomplete="tel"></div></div>
        <div class="field"><label>${tx("Даты проживания")}</label><div id="formDates">${dateFieldsHTML('data-dp-apt')}</div></div>
        <div class="field"><label for="bG">${tx("Гости")}</label><select class="inp" id="bG">${Array.from({length:a.maxGuests},(_,i)=>`<option value="${i+1}" ${M.guests===i+1?'selected':''}>${guestsWord(i+1)}</option>`).join('')}</select></div>
        <label class="chk ${p.allowed?'':'dis'}" id="petChk"><input type="checkbox" id="bPet" ${M.pet&&p.allowed?'checked':''} ${p.allowed?'':'disabled'}><div><b>${ic('paw',16)} ${tx("Еду с животным")} ${p.allowed?(p.fee?`+${gm(p.fee)}`:tx('— бесплатно')):''}</b><small>${p.allowed?`${p.count===1?tx('Один питомец'):tx('До двух питомцев')} ${p.weight} ${tx("· доплата за всё проживание, не за ночь")}`:tx('В этой квартире нельзя с животными — выберите квартиру со значком «можно с животными»')}</small></div></label>
        <div class="trwrap ${TR.bk.on?'on':''}" id="trWrap">${trWrapInner()}</div>
        <div class="field"><label for="bCom">${tx("Комментарий")} <span class="muted" style="font-weight:500">${tx("(необязательно)")}</span></label><textarea class="inp" id="bCom" placeholder="${tx("Поздний заезд, детская кроватка…")}">${esc(M.form.comment)}</textarea></div>
        <div class="field" style="margin-bottom:6px"><label>${tx("Способ оплаты")}</label></div>
        <div class="pays">${Object.keys(PAY_METHODS).map(k=>`<button type="button" class="pay ${M.pay===k?'on':''}" data-pay="${k}"><span class="pi" style="background:${payIc[k][1]}">${ic(payIc[k][0],18)}</span><span><b>${PAY_METHODS[k].label}</b><small>${paySub[k]}</small></span></button>`).join('')}</div>
        <div class="err" id="bErr"></div>
      </div>
      <aside><div class="bookbox">${miniApt(a,'f0',`${tx(a.district)} · ${ic('star',12)} ${aptRating(a)}${p.allowed?` · ${ic('paw',12)} ${tx("с животными")}`:''}`)}
        <div style="font-size:14px;display:flex;justify-content:space-between"><span class="muted">${tx("Даты")}</span><b id="fDates">${t.n?`${fD(M.ci)} – ${fD(M.co)}`:'—'}</b></div>
        <div id="fSum">${sumHTML()}</div>
        <button class="btn brand block" type="submit" style="margin-top:14px;height:52px" id="bSubmit">${SUBMIT_LBL[M.pay]}</button>
        <div class="muted" style="font-size:12px;text-align:center;margin-top:8px">${ic('shield',13)} ${tx("Демо: данные сохраняются только в этом браузере")}</div></div></aside></form></div>
      <div class="mbar"><div><b id="mbTot">${t.n?fc(t.cTotal):'—'}</b><div class="muted" style="font-size:12px">${tx("итого")}${t.n?tx(' за ')+nightsWord(t.n):''}</div></div><button type="submit" form="bookForm" class="btn brand" id="mbSubmit">${SUBMIT_LBL[M.pay]}</button></div>`;
  }
  else if(M.step==='card'){ box.innerHTML = close + cardStepHTML(fc(t.cTotal), miniApt(a,'c0',`${fD(M.ci)} – ${fD(M.co)} · ${guestsWord(M.guests)}`)+sumHTML(), 'form', tx('Шаг 3 из 3')); }
  else if(M.step==='chat'){
    const tg = M.pay==='telegram'; const col = tg?'#229ED9':'#128C7E';
    box.innerHTML = close + `<div class="pane"><div class="step-h"><button type="button" class="backb" data-back="form" aria-label="${tx("Назад")}">${ic('chevL',18)}</button><div><h2 style="font-size:22px">${tg?tx('Написать в Telegram'):tx('Написать в WhatsApp')}</h2><div class="muted" style="font-size:13px">${tx("Предпросмотр сообщения")}</div></div></div>
      <div class="form-grid"><div>
      <div class="chat"><div class="chat-h" style="background:${col}"><span class="av">${esc(BRAND.short)}</span><div><b>${esc(BRAND.name)}</b><div style="font-size:12px;opacity:.85">${tg?'@'+BRAND.contacts.telegram:BRAND.contacts.phone} ${tx("· отвечает за 5 минут")}</div></div></div>
        <div class="chat-b ${tg?'tg':''}"><div class="bub" id="chatMsg">${esc(chatText())}<small>${tx("сейчас ✓")}</small></div></div></div>
      </div><div>
      <div class="demo-note">${ic('alert',16)}<span><b>${tx("Демо.")}</b> ${tx("В рабочей версии откроется")} ${tg?'t.me/'+BRAND.contacts.telegram:'wa.me/'+BRAND.contacts.whatsapp} ${tx("с этим текстом. Сейчас реальные ссылки не открываются — заявка просто сохранится для владельца.")}</span></div>
      <div class="bookbox">${sumHTML()}<button type="button" class="btn block" id="chatSend" style="margin-top:14px;height:52px;background:${col};border-color:${col};color:#fff">${ic(tg?'send':'msg',18)} ${tx("Отправить (демо)")}</button></div>
      </div></div></div>`;
  }
  else if(M.step==='success'){
    const r=M.saved; const pm=PAY_METHODS[r.payment];
    const status = r.payment==='card' ? `<span style="color:var(--ok)">${tx("Оплачено")} ${grt(r)} ${tx("(демо)")}</span>` : r.payment==='cash' ? tx('Оплата наличными при заселении') : `${tx("Ответим в")} ${r.payment==='telegram'?'Telegram':'WhatsApp'} ${tx("за 5 минут")}`;
    box.innerHTML = close + `<div class="success"><div class="okc">${ic('check',38,3)}</div>
      <h2 style="font-size:26px">${r.payment==='card'?tx('Оплата прошла, бронь принята!'):tx('Заявка отправлена!')}</h2>
      <p class="muted" style="margin:8px auto 0;max-width:460px">${tx("Номер брони")} <b style="color:var(--ink)">S-${r.id}</b>${tx(". Мы свяжемся с вами по номеру")} ${esc(r.phone)}${tx(". Код от замка придёт в день заезда.")}</p>
      <div class="recap"><div class="ln"><span>${tx("Квартира")}</span><span>${esc(a.title)}</span></div><div class="ln"><span>${tx("Даты")}</span><span>${fDL(r.ci)} – ${fDL(r.co)} · ${nightsWord(r.co-r.ci)}</span></div><div class="ln"><span>${tx("Гости")}</span><span>${r.guests}${r.pet?tx(' + питомец'):''}</span></div>
        <div class="ln"><span>${tx("Трансфер")}</span><span>${r.tr?trRecap(r.tr):tx('Нет')}</span></div>${r.pet?`<div class="ln"><span>${tx("Животное")}</span><span>${r.petFee?gm(r.petFee):tx('без доплаты')}</span></div>`:''}<div class="ln"><span>${tx("Способ оплаты")}</span><span>${pm.label}</span></div><div class="ln"><span>${tx("Статус")}</span><span>${status}</span></div><div class="ln"><span>${tx("Итого")}</span><span>${grt(r)}</span></div></div>
      <div class="demo-note" style="max-width:460px;margin:0 auto 16px;text-align:left">${ic('alert',16)}<span>${tx("Демо: заявка сохранена в этом браузере. Владелец увидит её в панели Сутки·Pro (ссылка «Вход для команды» внизу страницы) — в «Заявках»")}${r.tr?tx(' и «Трансферах»'):''}.</span></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn brand" data-close>${tx("Готово")}</button>${r.tr?'':`<button type="button" class="btn" data-trorder="from">${ic('plane',16)} ${tx("Заказать трансфер")}</button>`}</div></div>`;
  }
}
function trWrapInner(){
  const T=TR.bk; const from = Math.min(...Object.values(TR_PRICES).map(p=>p.standard.one));
  return `<button type="button" class="trtoggle" data-trtoggle aria-expanded="${T.on}"><span class="pi">${ic('plane',18)}</span><span class="tt"><b>${tx("Трансфер из аэропорта или вокзала")}</b><small>${T.on?`${esc(trSummary(T))} · ${gm(trPrice(T).total)}`:`${tx("Встретим с табличкой · от")} ${gm(from)} ${tx("· туда и обратно со скидкой")}`}</small></span><span class="swc ${T.on?'on':''}"><i></i></span></button>
    ${T.on?trBlockHTML(T,'bk'):''}`;
}
function trRecap(tr){ const P=TR_PLACES[tr.place]; return trLegs(tr).map(l=>`${l.dir==='in'?tx('встреча'):tx('подача')} ${fD(l.date)}, ${l.time}`).join(tx(' и '))+` · ${P.short} · ${TR_CLASSES[tr.cls].name} · ${gm(tr.price)}`; }
function cardStepHTML(total, asideHTML, back, stepLbl){
  return `<div class="pane"><div class="step-h"><button type="button" class="backb" data-back="${back}" aria-label="${tx("Назад")}">${ic('chevL',18)}</button><div><h2 style="font-size:22px">${tx("Оплата картой")}</h2><div class="muted" style="font-size:13px">${stepLbl}</div></div></div>
    <div class="form-grid"><div>
    <div class="demo-note">${ic('alert',16)}<span><b>${tx("Демо-оплата.")}</b> ${tx("Реального списания нет, данные карты никуда не отправляются и не сохраняются. Номер уже заполнен тестовым.")}</span></div>
    <div class="cardviz"><div style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1"><span class="chip-ic"></span><b style="letter-spacing:.08em">DEMO</b></div><div class="num" id="cvNum">4242 4242 4242 4242</div><div style="display:flex;justify-content:space-between;font-size:13px;position:relative;z-index:1"><span>${esc((M.form.name||'GUEST').toUpperCase())}</span><span>12/28</span></div></div>
    <form id="cardForm" novalidate>
      <div class="field"><label for="cNum">${tx("Номер карты")}</label><input class="inp" id="cNum" inputmode="numeric" value="4242 4242 4242 4242" maxlength="19" autocomplete="off"></div>
      <div class="two"><div class="field"><label for="cExp">${tx("Срок")}</label><input class="inp" id="cExp" value="12/28" maxlength="5" autocomplete="off"></div><div class="field"><label for="cCvc">CVC</label><input class="inp" id="cCvc" value="123" maxlength="3" inputmode="numeric" type="password" autocomplete="off"></div></div>
      <div class="err" id="cErr"></div>
      <button class="btn brand block" type="submit" style="height:52px" id="payBtn">${tx("Оплатить")} ${typeof total==='string'?total:gm(total)} ${tx("(демо)")}</button>
    </form></div>
    <aside><div class="bookbox">${asideHTML}</div></aside></div></div>`;
}
function chatText(){ const a=M.apt, t=totals(); const T=TR.bk;
  return `${tx("Здравствуйте! Хочу забронировать «")}${a.title}» (${tx(a.district)}${tx(") с")} ${fDL(M.ci)} ${tx("по")} ${fDL(M.co)} — ${nightsWord(t.n)}, ${guestsWord(M.guests)}${tx(".\nИмя:")} ${M.form.name}${tx("\nТелефон:")} ${M.form.phone}${M.pet?tx('\nЕду с животным.'):''}${T.on?tx('\nТрансфер: ')+trSummary(T)+' — '+trLegs(T).map(l=>`${l.dir==='in'?tx('встреча'):tx('подача')} ${fD(l.date)} ${tx("в")} ${l.time}${l.code?' ('+l.code+')':''}`).join(', ')+'.':''}${M.form.comment?tx('\nКомментарий: ')+M.form.comment:''}${tx("\nСумма по сайту:")} ${fc(t.cTotal)}`; }
function refreshDetailsBits(){ const t=totals();
  renderPK('apt'); $('sumBox').innerHTML = sumHTML(); $('selInfo').textContent = selText();
  document.querySelector('.bookbox .dfs').outerHTML = dateFieldsHTML('data-dp-apt');
  document.querySelectorAll('[data-to-form]').forEach(b=>b.textContent = t.n?tx('Забронировать'):tx('Выбрать даты'));
  const mi=$('mbarInfo'); if(mi) mi.textContent = t.n?`${nightsWord(t.n)} · ${fc(t.cTotal)}`:tx('выберите даты'); }
function refreshFormBits(){ const t=totals();
  $('fSum').innerHTML = sumHTML(); $('fDates').textContent = t.n?`${fD(M.ci)} – ${fD(M.co)}`:'—';
  $('formDates').innerHTML = dateFieldsHTML('data-dp-apt');
  $('bSubmit').textContent = SUBMIT_LBL[M.pay];
  if($('mbSubmit')){ $('mbSubmit').textContent = SUBMIT_LBL[M.pay]; $('mbTot').textContent = t.n?fc(t.cTotal):'—'; }
  const tg=document.querySelector('.trtoggle small'); if(tg && TR.bk.on) tg.textContent = `${trSummary(TR.bk)} · ${gm(trPrice(TR.bk).total)}`;
  document.querySelectorAll('.pay[data-pay]').forEach(p=>p.classList.toggle('on', p.dataset.pay===M.pay)); }
function readForm(){ if(!$('bName')) return; M.form.name=$('bName').value.trim(); M.form.phone=$('bPhone').value.trim(); M.form.comment=$('bCom').value.trim();
  M.guests=+$('bG').value; M.pet=$('bPet').checked; }
function makeBad(errId){
  const err=$(errId);
  return (el,msg)=>{ if(el){ el.classList.add('bad'); el.scrollIntoView({block:'center',behavior:'smooth'}); if(el.focus) el.focus({preventScroll:true}); } err.textContent=msg; err.classList.add('show'); return false; };
}
function clearBad(root, errId){ document.querySelectorAll(root+' .bad').forEach(i=>i.classList.remove('bad')); $(errId).classList.remove('show'); }
function validateForm(){
  const bad=makeBad('bErr'); clearBad('#bookForm','bErr');
  if(M.form.name.length<2) return bad($('bName'),tx('Укажите имя'));
  if(M.form.phone.replace(/\D/g,'').length<11) return bad($('bPhone'),tx('Укажите телефон полностью, например +7 701 123 45 67'));
  if(M.ci==null) return bad($('dfCi'),tx('Выберите дату заезда'));
  if(M.co==null || M.co<=M.ci) return bad($('dfCo'),tx('Выберите дату выезда'));
  if(!rangeFree(M.apt.id,M.ci,M.co)) return bad($('dfCi'),tx('Эти даты уже заняты — выберите другие в календаре'));
  if(M.pet && !M.apt.pets.allowed) return bad($('bPet'),tx('В этой квартире нельзя с животными'));
  if(TR.bk.on){ if(!TR.bk.sign) TR.bk.sign=M.form.name; if(!trValidate(TR.bk,'bk',bad)) return false; }
  return true;
}
function saveRequest(){
  const a=M.apt, t=totals(); let rec;
  const res = Store.update(st=>{ const id=++st.seq; rec={id, aptId:a.id, name:M.form.name, phone:M.form.phone, ci:M.ci, co:M.co, guests:M.guests, transfer:TR.bk.on, tr:TR.bk.on?trData(TR.bk):null, pet:!!(M.pet&&a.pets.allowed), petFee:M.pet&&a.pets.allowed?a.pets.fee:0, comment:M.form.comment, payment:M.pay, paid:M.pay==='card', total:t.total, cur:{code:CUR, total:t.cTotal, rate:CUR==='KZT'?1:FX.rates[CUR], night:nightC(a), lang:IS_EN?'en':'ru'}, status:'new', time:nowHM(), day:'Сегодня', createdAt:Date.now()}; st.requests.push(rec); });
  ST = res.st; M.saved = rec; M.step='success'; renderModal(); $('modal').scrollTop=0; renderGrid();
  if(!res.ok) toast(tx('Не удалось сохранить в localStorage (приватный режим?) — владелец не увидит заявку'));
}

/* ---------- отдельный заказ трансфера (без брони квартиры у нас) ---------- */
const REF_SRC = {site:[BRAND.name,tx('Номер брони или имя, на кого бронь'),tx('S-1001 или Айдана Серикова')], airbnb:['Airbnb',tx('Код брони Airbnb или имя гостя'),tx('HMA4K2PX9Q или имя')], booking:['Booking.com',tx('Номер брони Booking.com или имя'),tx('4205 118 734 или имя')], other:[tx('Другое'),tx('Где остановились и на чьё имя'),tx('Отель, квартира друзей…')]};
function openTrOrder(dir){
  const keep = TR.sa;
  TR.sa = newTr({dir, place:keep.place, pax:keep.pax, bags:keep.bags, seats:keep.seats, sign:keep.sign});
  Object.assign(M, {flow:'tr', step:'tr', saved:null, trPay:'driver'});
  showModal(); renderModal();
}
function trLegsListHTML(T){
  const P=TR_PLACES[T.place];
  return trLegs(T).map(l=>`<div class="leg ${l.dir}"><span class="li">${ic(l.dir==='in'?'in':'out',15)}</span><div><b>${l.dir==='in'?`${tx("Встреча:")} ${P.short} ${tx("→ квартира")}`:`${tx("Подача: квартира →")} ${P.short}`}</b><span>${l.date!=null?fDW(l.date):tx('дата не выбрана')}${l.time?`, ${l.time}`:''}${l.dir==='out'&&l.depTime?` · ${T.place==='airport'?tx('вылет'):tx('поезд')} ${tx("в")} ${l.depTime}`:''}${l.code?` · ${esc(l.code)}`:''}</span></div></div>`).join('');
}
function refreshTrSide(){
  const el=$('trSide'); if(!el) return; const T=TR.sa; const p=trPrice(T); const C=TR_CLASSES[T.cls];
  el.innerHTML = `<div class="trs-h"><span class="pi">${ic(T.place==='airport'?'plane':'train',18)}</span><div><b>${TR_PLACES[T.place].dirs[T.dir]}${T.place==='station'&&T.dir==='round'?tx(' · вокзал'):''}</b><small>${C.name} · ${C.car}</small></div></div>
    ${trLegsListHTML(T)}
    <div class="trs-m">${ic('users',14)} ${T.pax} ${tx("пасс. ·")} ${ic('luggage',14)} ${T.bags} ${tx("чем.")}${T.seats?` · ${ic('baby',14)} ${T.seats}`:''}</div>
    ${trPriceHTML(T)}
    <button class="btn brand block" type="submit" style="margin-top:14px;height:52px" id="tSubmit">${M.trPay==='card'?tx('Перейти к оплате'):tx('Заказать трансфер')} · ${gm(p.total)}</button>
    <div class="muted" style="font-size:12px;text-align:center;margin-top:8px">${ic('shield',13)} ${tx("Демо: заказ сохраняется только в этом браузере")}</div>`;
  if($('mbTot')){ $('mbTot').textContent = gm(p.total); $('mbSubmit').textContent = M.trPay==='card'?tx('К оплате'):tx('Заказать'); }
}
function readTrForm(){ if(!$('tName')) return; M.form.name=$('tName').value.trim(); M.form.phone=$('tPhone').value.trim(); M.form.comment=$('tCom').value.trim(); M.ref.num=$('tRef').value.trim(); M.ref.addr=$('tAddr').value.trim(); }
function renderTrModal(box, close){
  const T=TR.sa;
  if(M.step==='tr'){
    const rs=REF_SRC[M.ref.src];
    box.innerHTML = close + `<div class="pane has-bar"><div class="step-h"><span class="pi-big">${ic('plane',20)}</span><div><h2 style="font-size:22px">${tx("Заказ трансфера")}</h2><div class="muted" style="font-size:13px">${tx("Для гостей Astana Stay, Airbnb, Booking и других · цена считается сразу").replace('Astana Stay', BRAND.name)}</div></div></div>
      <form id="trForm" class="form-grid" novalidate><div>
        <h3 class="fh"><span>1</span> ${tx("Поездка")}</h3>
        ${trBlockHTML(T,'sa')}
        <h3 class="fh"><span>2</span> ${tx("Где вы остановились")}</h3>
        <div class="seg four">${Object.entries(REF_SRC).map(([k,v])=>`<button type="button" class="${M.ref.src===k?'on':''}" data-refsrc="${k}"><span><b>${v[0]}</b></span></button>`).join('')}</div>
        <div class="two" style="margin-top:12px"><div class="field"><label for="tRef">${rs[1]}</label><input class="inp" id="tRef" value="${esc(M.ref.num)}" placeholder="${rs[2]}" autocomplete="off"></div>
          <div class="field"><label for="tAddr">${tx("Адрес в Астане")} ${M.ref.src==='site'?tx('<span class="opt">(необяз.)</span>'):''}</label><input class="inp" id="tAddr" value="${esc(M.ref.addr)}" placeholder="${tx("ЖК, улица, дом")}" autocomplete="off"></div></div>
        <h3 class="fh"><span>3</span> ${tx("Контакты и оплата")}</h3>
        <div class="two"><div class="field"><label for="tName">${tx("Имя и фамилия")}</label><input class="inp" id="tName" value="${esc(M.form.name)}" placeholder="${tx("Айдана Серикова")}" autocomplete="name"></div>
          <div class="field"><label for="tPhone">${tx("Телефон (Telegram/WhatsApp)")}</label><input class="inp" id="tPhone" type="tel" inputmode="tel" value="${esc(M.form.phone)}" placeholder="+7 7__ ___ __ __" autocomplete="tel"></div></div>
        <div class="field"><label for="tCom">${tx("Комментарий")} <span class="opt">${tx("(необязательно)")}</span></label><textarea class="inp" id="tCom" placeholder="${tx("Например: с нами собака в переноске, нужна помощь с коляской")}">${esc(M.form.comment)}</textarea></div>
        <div class="pays">${Object.entries(TR_PAY).map(([k,v])=>`<button type="button" class="pay ${M.trPay===k?'on':''}" data-trpay="${k}"><span class="pi" style="background:${k==='card'?'#0f5566':'#15803d'}">${ic(k==='card'?'card':'cash',18)}</span><span><b>${v.label}</b><small>${v.sub}</small></span></button>`).join('')}</div>
        <div class="err" id="tErr"></div>
      </div>
      <aside><div class="bookbox" id="trSide"></div></aside></form></div>
      <div class="mbar"><div><b id="mbTot"></b><div class="muted" style="font-size:12px">${tx("трансфер итого")}</div></div><button type="submit" form="trForm" class="btn brand" id="mbSubmit"></button></div>`;
    refreshTrSide();
  }
  else if(M.step==='trcard'){ box.innerHTML = close + cardStepHTML(trPrice(T).total, `<div class="trs-h"><span class="pi">${ic('plane',18)}</span><div><b>${TR_PLACES[T.place].dirs[T.dir]}</b><small>${esc(trSummary(T))}</small></div></div>${trLegsListHTML(T)}${trPriceHTML(T)}`, 'tr', tx('Шаг 2 из 2')); }
  else if(M.step==='trsuccess'){
    const r=M.saved; const tr=r.tr; const P=TR_PLACES[tr.place];
    box.innerHTML = close + `<div class="success"><div class="okc">${ic('check',38,3)}</div>
      <h2 style="font-size:26px">${tx("Трансфер заказан!")}</h2>
      <p class="muted" style="margin:8px auto 0;max-width:470px">${tx("Номер заказа")} <b style="color:var(--ink)">T-${r.id}</b>${tx(". Подтвердим в течение 15 минут и пришлём имя водителя, марку и номер машины на")} ${esc(r.phone)}.</p>
      <div class="recap">${trLegs(tr).map(l=>`<div class="ln"><span>${l.dir==='in'?tx('Встреча'):tx('Подача')}</span><span>${fDW(l.date)}, ${l.time}${l.code?' · '+esc(l.code):''}<br><small class="muted">${l.dir==='in'?`${P.short} → ${esc(r.address||tx('квартира'))}`:`${esc(r.address||tx('квартира'))} → ${P.short}`}</small></span></div>`).join('')}
        <div class="ln"><span>${tx("Автомобиль")}</span><span>${TR_CLASSES[tr.cls].name} · ${tr.pax} ${tx("пасс.,")} ${tr.bags} ${tx("чем.")}${tr.seats?`, ${tr.seats} ${tx("дет. кресл.")}`:''}</span></div>
        <div class="ln"><span>${tx("Табличка")}</span><span>${esc(tr.sign||r.name)}</span></div>
        <div class="ln"><span>${tx("Бронь жилья")}</span><span>${REF_SRC[r.refSource][0]} · ${esc(r.ref)}</span></div>
        <div class="ln"><span>${tx("Оплата")}</span><span>${r.paid?`<span style="color:var(--ok)">${tx("Оплачено картой (демо)")}</span>`:TR_PAY.driver.label}</span></div>
        <div class="ln"><span>${tx("Итого")}</span><span>${grt(r)}</span></div></div>
      <div class="demo-note" style="max-width:470px;margin:0 auto 16px;text-align:left">${ic('alert',16)}<span>${tx("Демо: заказ сохранён в этом браузере — владелец увидит его в «Заявках» и «Трансферах» панели Сутки·Pro.")}</span></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn brand" data-close>${tx("Готово")}</button><a class="btn" href="#catalog" data-close>${ic('home',16)} ${tx("Посмотреть квартиры")}</a></div></div>`;
  }
}
function validateTr(){
  const bad=makeBad('tErr'); clearBad('#trForm','tErr'); const T=TR.sa;
  if(!T.sign) T.sign = M.form.name;
  if(!trValidate(T,'sa',bad)) return false;
  if(M.ref.num.length<2) return bad($('tRef'), M.ref.src==='site'?tx('Укажите номер брони или имя, на кого бронь'):tx('Укажите номер брони или имя — чтобы мы нашли вас'));
  if(M.ref.src!=='site' && M.ref.addr.length<5) return bad($('tAddr'),tx('Укажите адрес в Астане — куда везти или откуда забрать'));
  if(M.form.name.length<2) return bad($('tName'),tx('Укажите имя'));
  if(M.form.phone.replace(/\D/g,'').length<11) return bad($('tPhone'),tx('Укажите телефон полностью, например +7 701 123 45 67'));
  return true;
}
function saveTransfer(){
  const T=TR.sa; const p=trPrice(T); let rec;
  const res = Store.update(st=>{ const id=++st.seq;
    rec={id, type:'transfer', name:M.form.name, phone:M.form.phone, ref:M.ref.num, refSource:M.ref.src, address:M.ref.addr, aptId:null, tr:trData(T), comment:M.form.comment, payment:M.trPay, paid:M.trPay==='card', total:p.total, cur:{code:CUR, total:conv(p.total), rate:CUR==='KZT'?1:FX.rates[CUR], lang:IS_EN?'en':'ru'}, status:'new', time:nowHM(), day:'Сегодня', createdAt:Date.now()};
    const m = M.ref.src==='site' && /(\d{4,})/.exec(M.ref.num); const linked = m && st.requests.find(q=>q.id===+m[1] && q.type!=='transfer');
    if(linked){ rec.aptId=linked.aptId; rec.linkedReq=linked.id; }
    st.requests.push(rec); });
  ST=res.st; M.saved=rec; M.step='trsuccess'; renderModal(); $('modal').scrollTop=0;
  if(!res.ok) toast(tx('Не удалось сохранить в localStorage (приватный режим?) — владелец не увидит заказ'));
}

/* ---------- события ---------- */
function trCtx(el){ const w=el.closest('[data-tr]'); return w ? w.dataset.tr : null; }
document.addEventListener('click', e=>{
  const t=e.target;
  /* календарь */
  if(t.closest('[data-dpclose]') || t.id==='dp'){ closeDP(); return; }
  if(t.closest('[data-dpreset]')){ const s=PK.dp; s.ci=s.co=null; s.d=null; renderPK('dp'); return; }
  if(t.closest('#dpDone')){ commitDP(); return; }
  const nav=t.closest('[data-dpnav]'); if(nav){ const key=nav.closest('[data-pk]').dataset.pk; PK[key].off=(PK[key].off||0)+(+nav.dataset.dpnav); renderPK(key); return; }
  const dc=t.closest('.dc'); if(dc){ if(dc.disabled) return; const key=dc.closest('[data-pk]').dataset.pk; const res=pickDay(PK[key], +dc.dataset.d); renderPK(key);
    if(key==='dp' && res==='done') commitDP(); if(key==='apt') aptDatesChanged(); return; }
  const ds=t.closest('[data-dp-search]'); if(ds){ PK.search.ci=G.ci; PK.search.co=G.co; openDP('search', ds.dataset.dpSearch, tx('Даты поездки'), tx('Выберите день заезда и день выезда')); return; }
  const da=t.closest('[data-dp-apt]'); if(da){ openDP('apt', da.dataset.dpApt, M.apt.title, tx('Зачёркнутые дни заняты · ')+gmN(M.apt)+tx(' за ночь')); return; }
  /* компактный поиск */
  if(t.closest('#sbar')){ openSheet(); return; }
  if(t.closest('[data-ssclose]') || t.id==='ssheet'){ closeSheet(); return; }
  /* каталог и карта */
  const favB=t.closest('[data-fav]'); if(favB){ e.stopPropagation(); const id=+favB.dataset.fav; if(fav.has(id)) fav.delete(id); else fav.add(id); favB.classList.toggle('on'); toast(fav.has(id)?tx('Добавлено в избранное'):tx('Убрано из избранного')); return; }
  const op=t.closest('[data-open]'); if(op){ openApt(+op.dataset.open); return; }
  const tro=t.closest('[data-trorder]'); if(tro){ openTrOrder(tro.dataset.trorder); return; }
  if(t.closest('[data-close]') || t.id==='modal'){ closeModal(); return; }
  const dist=t.closest('[data-dist]'); if(dist){ const d=dist.dataset.dist; G.district = (d && G.district===d) ? '' : d; syncSearch(); renderGrid(); $('catalog').scrollIntoView({behavior:'smooth'}); return; }
  const rc=t.closest('[data-rooms]'); if(rc){ setSearch('rooms', rc.dataset.rooms); return; }
  if(t.closest('[data-petchip]')){ setSearch('pets', !G.pets); return; }
  if(t.closest('[data-petperk]')){ e.preventDefault(); setSearch('pets', true); $('catalog').scrollIntoView({behavior:'smooth'}); toast(tx('Показываем квартиры, где можно с животными')); return; }
  if(t.closest('[data-reset]')){ Object.assign(G,{ci:null,co:null,guests:1,district:'',maxPrice:0,rooms:'',pets:false}); syncSearch(); renderGrid(); return; }
  const ph=t.closest('[data-photo]'); if(ph){ M.photo=+ph.dataset.photo; document.querySelector('.mgal').outerHTML = galleryHTML(M.apt); return; }
  /* бронь */
  if(t.closest('[data-to-form]')){ if(!totals().n){ openDP('apt','ci', M.apt.title, tx('Зачёркнутые дни заняты · ')+gmN(M.apt)+tx(' за ночь')); return; } M.step='form'; renderModal(); $('modal').scrollTop=0; return; }
  const back=t.closest('[data-back]'); if(back){ if(M.step==='form') readForm(); if(M.step==='trcard') {} M.step=back.dataset.back; renderModal(); return; }
  const pay=t.closest('[data-pay]'); if(pay){ M.pay=pay.dataset.pay; refreshFormBits(); return; }
  if(t.closest('#chatSend')){ saveRequest(); return; }
  /* трансфер */
  if(t.closest('[data-trtoggle]')){ readForm(); const T=TR.bk; T.on=!T.on; if(T.on){ if(T.autoDates!==false){ T.arrDate=M.ci; T.depDate=M.co; } T.pax=Math.max(T.pax, M.guests); if(!T.sign) T.sign=M.form.name; }
    const w=$('trWrap'); w.classList.toggle('on',T.on); w.innerHTML=trWrapInner(); refreshFormBits(); if(T.on) w.scrollIntoView({block:'nearest',behavior:'smooth'}); return; }
  const trk=t.closest('[data-trk]'); if(trk){ if(trk.disabled) return; const c=trCtx(trk); const T=TR[c]; T[trk.dataset.trk]=trk.dataset.v; rerenderTr(c); return; }
  const trs=t.closest('[data-trstep]'); if(trs){ const c=trCtx(trs); const T=TR[c]; const k=trs.dataset.trstep; const lim={pax:[1,7],bags:[0,8],seats:[0,3]}[k];
    T[k]=Math.max(lim[0],Math.min(lim[1],T[k]+(+trs.dataset.delta))); const before=T.cls; trAuto(T); if(before!==T.cls) toast(tx('Не помещается в седан — переключили на минивэн')); rerenderTr(c); return; }
  const trd=t.closest('[data-trdate]'); if(trd){ const c=trCtx(trd); if(c==='bk') TR.bk.autoDates=false; openTrDate(c, trd.dataset.trdate); return; }
  const rs=t.closest('[data-refsrc]'); if(rs){ readTrForm(); M.ref.src=rs.dataset.refsrc; renderModal(); setTimeout(()=>$('tRef').focus({preventScroll:true}),0); return; }
  const tp=t.closest('[data-trpay]'); if(tp){ M.trPay=tp.dataset.trpay; document.querySelectorAll('[data-trpay]').forEach(p=>p.classList.toggle('on',p.dataset.trpay===M.trPay)); refreshTrSide(); return; }
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ if($('dp').classList.contains('open')) closeDP(); else if($('ssheet').classList.contains('open')) closeSheet(); else if($('modal').classList.contains('open')) closeModal(); return; }
  if(e.key==='Enter' && e.target.matches && e.target.matches('.apt')) openApt(+e.target.dataset.open);
});
document.addEventListener('change', e=>{
  const el=e.target, id=el.id;
  if(id==='sort'){ G.sort=el.value; renderGrid(); return; }
  if(el.dataset.sf){ const k=el.dataset.sf; setSearch(k, k==='pets'?el.checked:k==='district'?el.value:+el.value); return; }
  if(id==='bG'||id==='bPet'){ readForm(); refreshFormBits(); if(id==='bPet') $('petChk').classList.toggle('on', M.pet); return; }
  if(el.dataset.trf && el.tagName==='SELECT'){ const c=trCtx(el); TR[c][el.dataset.trf]=el.value; rerenderTr(c); return; }
});
document.addEventListener('input', e=>{
  const el=e.target;
  if(el.id==='cNum'){ const v=el.value.replace(/\D/g,'').slice(0,16); el.value=v.replace(/(.{4})/g,'$1 ').trim(); $('cvNum').textContent = el.value || '•••• •••• •••• ••••'; return; }
  if(el.dataset.trf && el.tagName==='INPUT'){ const c=trCtx(el); TR[c][el.dataset.trf]= el.dataset.trf==='sign' ? el.value.toUpperCase() : el.value; if(el.dataset.trf==='sign'){ const p=el.selectionStart; el.value=el.value.toUpperCase(); el.setSelectionRange(p,p); } el.classList.remove('bad'); if(c==='sa') refreshTrSide(); }
});
document.addEventListener('mouseover', e=>{ const c=e.target.closest && e.target.closest('.dc'); if(!c) return; const box=c.closest('[data-pk]'); if(box) hoverPreview(box, c); });
document.addEventListener('mouseout', e=>{ const box=e.target.closest && e.target.closest('[data-pk]'); if(box && !(e.relatedTarget && box.contains(e.relatedTarget))) hoverPreview(box, null); });
document.addEventListener('submit', e=>{
  const id=e.target.id;
  if(id==='searchForm'||id==='sheetForm'){ e.preventDefault(); closeSheet(); $('catalog').scrollIntoView({behavior:'smooth'}); return; }
  if(id==='bookForm'){ e.preventDefault(); readForm(); if(!validateForm()) return;
    if(M.pay==='card'){ M.step='card'; renderModal(); $('modal').scrollTop=0; }
    else if(M.pay==='cash'){ saveRequest(); }
    else { M.step='chat'; renderModal(); $('modal').scrollTop=0; } return; }
  if(id==='trForm'){ e.preventDefault(); readTrForm(); if(!validateTr()) return;
    if(M.trPay==='card'){ M.step='trcard'; renderModal(); $('modal').scrollTop=0; } else saveTransfer(); return; }
  if(id==='cardForm'){ e.preventDefault(); const n=$('cNum').value.replace(/\D/g,''); const err=$('cErr');
    if(n.length<16){ err.textContent=tx('Введите 16 цифр номера карты (в демо подойдёт любой)'); err.classList.add('show'); return; }
    if(!/^\d\d\/\d\d$/.test($('cExp').value)){ err.textContent=tx('Срок в формате ММ/ГГ'); err.classList.add('show'); return; }
    const b=$('payBtn'); b.disabled=true; b.innerHTML=tx('<span class="spinner"></span> Обработка платежа (демо)…');
    setTimeout(M.flow==='tr'?saveTransfer:saveRequest, 1100); }
});
let rsz, wasMob=isMob();
window.addEventListener('resize', ()=>{ clearTimeout(rsz); rsz=setTimeout(()=>{ if(isMob()!==wasMob){ wasMob=isMob(); if($('dp').classList.contains('open')) renderPK('dp'); if(PK.apt && $('modal').classList.contains('open') && M.step==='details') renderPK('apt'); } },150); });
/* смена валюты на сайте и изменения курсов владельцем (в другой вкладке) — перерисовываем все цены */
function rerenderAll(){
  FX = fxGet(ST); if(CUR!=='KZT' && !FX.show[CUR]) CUR='KZT';
  $('searchForm').innerHTML = searchFormHTML('h'); $('sheetForm').innerHTML = searchFormHTML('s');
  syncSearch(); renderGrid(); renderPerks(); renderTransferSection(); renderSwitch();
  if($('modal').classList.contains('open')){ if(M.flow==='tr') readTrForm(); else readForm(); renderModal(); }
}
document.addEventListener('change', e=>{ if(e.target.id==='curSel'){ CUR=e.target.value; localStorage.setItem(CUR_LS, CUR); rerenderAll(); } });
document.addEventListener('click', e=>{ const b=e.target.closest('[data-lang]'); if(b && window.I18N) I18N.set(b.dataset.lang); });
window.addEventListener('storage', e=>{
  if(e.key===STORE_KEY){ ST=Store.load(); rerenderAll(); }
  else if(e.key===CUR_LS && e.newValue){ CUR=e.newValue; rerenderAll(); }
});

/* ---------- старт ---------- */
syncSearch(); renderGrid();
const qs = new URLSearchParams(location.search);
const qa = +qs.get('apt'); if(qa) openApt(qa);
if(qs.get('transfer')) openTrOrder(['from','to','round'].includes(qs.get('transfer'))?qs.get('transfer'):'from');
window.__guest = {G, M, TR, PK, openApt, openTrOrder, openDP};
})();
