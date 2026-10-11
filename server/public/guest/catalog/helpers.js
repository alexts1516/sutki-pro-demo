// Original display utilities; no generated apartments, bookings or browser booking store.
'use strict';
/* перевод строк сайта для гостей (assets/i18n.js); на остальных страницах — без перевода */
window.tx = window.tx || (s => s);
const IS_EN = !!(window.I18N && window.I18N.lang==='en');
/* =================== Утилиты =================== */
const DAY = 86400000;
const di = (y,m,d) => Math.round(Date.UTC(y,m-1,d)/DAY);
const dt = i => new Date(i*DAY);
const TODAY = Math.floor(Date.now()/DAY);
const MON_S = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MON_G = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MON_N = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MON_D = ['январю','февралю','марту','апрелю','маю','июню','июлю','августу','сентябрю','октябрю','ноябрю','декабрю'];
const WD = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const WD_L = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const dd = i => dt(i).getUTCDate();
const mm = i => dt(i).getUTCMonth();
const wd = i => dt(i).getUTCDay();
const fD = i => `${dd(i)} ${MON_S[mm(i)]}`;
const relDay = i => i===TODAY?tx('Сегодня'):i===TODAY+1?tx('Завтра'):i===TODAY-1?tx('Вчера'):fD(i);
const money = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0') + '\u00a0₸';
const moneyShort = n => n>=1e6 ? (n/1e6).toFixed(1).replace('.',',')+'\u00a0млн\u00a0₸' : n>=1e4 ? Math.round(n/1e3)+'\u00a0тыс\u00a0₸' : money(n);
const plural = (n,a,b,c) => { if(IS_EN) return n===1 ? a : (c||b); const m10=n%10,m100=n%100; return m10===1&&m100!==11?a:(m10>=2&&m10<=4&&(m100<10||m100>=20))?b:c; };
if(IS_EN){ MON_S.splice(0,12,'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'); MON_G.splice(0,12,'January','February','March','April','May','June','July','August','September','October','November','December'); MON_N.splice(0,12,'January','February','March','April','May','June','July','August','September','October','November','December'); WD.splice(0,7,'Sun','Mon','Tue','Wed','Thu','Fri','Sat'); WD_L.splice(0,7,'Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'); }
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const initials = n => n.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rnd = mulberry32(20260930);
const ri = (a,b) => a+Math.floor(rnd()*(b-a+1));
const pick = arr => arr[Math.floor(rnd()*arr.length)];
const wpick = items => { const tot=items.reduce((s,x)=>s+x[1],0); let r=rnd()*tot; for(const it of items){ if((r-=it[1])<0) return it[0]; } return items[0][0]; };

/* =================== Иконки (inline SVG) =================== */
const I = {
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sparkle:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  chart:'<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  car:'<path d="M5 17H3v-5l2.2-5.2A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.8 1.3L21 12v5h-2"/><path d="M3 12h18M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  chevL:'<path d="M15 18l-6-6 6-6"/>', chevR:'<path d="M9 18l6-6-6-6"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>', check:'<path d="M20 6 9 17l-5-5"/>', menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  in:'<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  percent:'<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  wallet:'<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16" cy="14" r="1.2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  plane:'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  home:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  msg:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>',
  bell:'<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  camera:'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  trend:'<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  arrowR:'<path d="M5 12h14M12 5l7 7-7 7"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  star:'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  pin:'<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  door:'<path d="M3 21h18M5 21V3h11v18M13 12h.01"/><path d="M16 5h3v16"/>',
  bed:'<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  card:'<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  cash:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  wifi:'<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
  parking:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  refresh:'<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  eye:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  trash:'<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2"/>',
  building:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  nav:'<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
  play:'<path d="M5 3l14 9-14 9V3z"/>',
  flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  paw:'<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  luggage:'<path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2"/><path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M10 20h4"/><circle cx="16" cy="20" r="2"/><circle cx="8" cy="20" r="2"/>',
  baby:'<path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
  train:'<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  swap:'<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  drop:'<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  bolt:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  washer:'<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7.5 6.5h2"/>',
  sofa:'<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z"/><path d="M5 18v2M19 18v2"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  sign:'<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M7 9h10M7 12h6M12 16v5"/>',
  check2:'<path d="M20 6 9 17l-5-5"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
};

const ic = (n,s=18,sw=2) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;


// Display-only demo ratings from the original prototype; never server authority.
const aptRating = a => a.rating==null?'—':String(a.rating);
const aptReviews = a => a.reviews??0;
const DISTRICTS = ['Сарайшык','Есиль','Алматинский','Сарыарка','Байконур','Нура'];
const aptPets=a=>a.pets;
const apartments=window.SERVER_HOME.apartments;

const FX_CUR = {
  KZT: {sym:'₸', name:'Тенге',           en:'Tenge',          pre:false, base:true},
  RUB: {sym:'₽', name:'Российский рубль', en:'Russian rouble', pre:false},
  USD: {sym:'$', name:'Доллар США',       en:'US dollar',      pre:true},
  EUR: {sym:'€', name:'Евро',             en:'Euro',           pre:true}
};
const FX_CODES = Object.keys(FX_CUR);
/* ДЕМО-курсы (не реальные): сколько тенге стоит 1 единица валюты */
const FX_DEFAULT = () => ({rates:{RUB:6.3, USD:510, EUR:575}, show:{KZT:true, RUB:true, USD:true, EUR:true}, round:{mode:'nearest', step:{RUB:10, USD:1, EUR:1}}, over:{}, updated:null});
function fxGet(st){ st = st || {fx:window.SERVER_HOME.fx}; const d = FX_DEFAULT(); const f = st.fx || {};
  return {rates:Object.assign(d.rates, f.rates||{}), show:Object.assign(d.show, f.show||{}), round:{mode:(f.round&&f.round.mode)||d.round.mode, step:Object.assign(d.round.step, (f.round&&f.round.step)||{})}, over:f.over||{}, updated:f.updated||null}; }
function fxRound(v, code, fx){ if(code==='KZT') return Math.round(v); const st = fx.round.step[code]||1; const m = fx.round.mode; const q = v/st;
  return (m==='up' ? Math.ceil(q-1e-9) : m==='down' ? Math.floor(q+1e-9) : Math.round(q)) * st; }
function fxConv(kzt, code, fx){ if(!code || code==='KZT') return Math.round(kzt); const r = fx.rates[code]; return r>0 ? fxRound(kzt/r, code, fx) : Math.round(kzt); }
/* цена за ночь в валюте: ручная цена владельца для квартиры, если задана, иначе — по курсу */
function fxNight(apt, code, fx){ const o = (fx.over[apt.id]||{})[code]; return (o>0) ? +o : fxConv(apt.price, code, fx); }
function fxFmt(v, code){ const c = FX_CUR[code]||FX_CUR.KZT; const n = String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, (IS_EN?',':'\u00a0'));
  return c.pre ? c.sym+n : n+'\u00a0'+c.sym; }

const TR_CLASSES = {
  standard: {name:tx('Стандарт'), car:tx('Toyota Camry или аналог'), pax:4, bags:3},
  minivan:  {name:tx('Минивэн'),  car:tx('Hyundai Staria или аналог'), pax:7, bags:7}
};
/* цены за машину (не за человека); «туда и обратно» — со скидкой */
const TR_PRICES = {
  airport: {standard:{one:8000, round:14000}, minivan:{one:12000, round:21000}},
  station: {standard:{one:6000, round:10000}, minivan:{one:9000,  round:16000}}
};
const TR_SEAT = 2000;   // детское кресло / бустер, за поездку в одну сторону

const TR_NIGHT=1500;

const isoOf=i=>new Date(i*DAY).toISOString().slice(0,10);
const idxOf=s=>Math.floor(Date.parse(s)/DAY);
