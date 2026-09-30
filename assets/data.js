/* Сутки·Pro — общие утилиты, иконки и генерация демо-данных (детерминированно).
   Подключается на всех страницах, чтобы квартиры/брони/уборки совпадали. */
'use strict';
/* =================== Утилиты =================== */
const DAY = 86400000;
const di = (y,m,d) => Math.round(Date.UTC(y,m-1,d)/DAY);
const dt = i => new Date(i*DAY);
const TODAY = di(2026,9,30);
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
const relDay = i => i===TODAY?'Сегодня':i===TODAY+1?'Завтра':i===TODAY-1?'Вчера':fD(i);
const money = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0') + '\u00a0₸';
const moneyShort = n => n>=1e6 ? (n/1e6).toFixed(1).replace('.',',')+'\u00a0млн\u00a0₸' : n>=1e4 ? Math.round(n/1e3)+'\u00a0тыс\u00a0₸' : money(n);
const plural = (n,a,b,c) => { const m10=n%10,m100=n%100; return m10===1&&m100!==11?a:(m10>=2&&m10<=4&&(m100<10||m100>=20))?b:c; };
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
  flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>'
};

const ic = (n,s=18,sw=2) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;

/* =================== Каналы =================== */
const CH = {
  airbnb:  {name:'Airbnb',   color:'#FF5A5F', letter:'A', comm:.15},
  booking: {name:'Booking',  color:'#1E5BD8', letter:'B', comm:.15},
  telegram:{name:'Telegram', color:'#229ED9', icon:'send', comm:0},
  whatsapp:{name:'WhatsApp', color:'#22B35E', icon:'msg', comm:0},
  site:    {name:'Сайт',     color:'#8B5CF6', icon:'globe', comm:0}
};
const CH_KEYS = Object.keys(CH);
const chb = (k,s=22) => { const c=CH[k]; const inner = c.icon ? ic(c.icon, Math.round(s*.55), 2.4) : `<span style="font-size:${Math.round(s*.5)}px">${c.letter}</span>`; return `<span class="chb" style="background:${c.color};width:${s}px;height:${s}px">${inner}</span>`; };
const chChip = k => `<span class="chip" style="background:${CH[k].color}1a;color:${CH[k].color}">${chb(k,16)} ${CH[k].name}</span>`;
/* =================== Генерация демо-данных =================== */
const COMPLEXES = [
  ['ЖК Хайвил','Есиль','пр. Кабанбай батыра, 60'],
  ['ЖК Северное сияние','Есиль','ул. Достык, 5'],
  ['ЖК Изумрудный квартал','Есиль','пр. Туран, 37'],
  ['ЖК Нурсая','Есиль','пр. Мангилик Ел, 20'],
  ['ЖК Грин Парк','Алматинский','ул. Жубанова, 14'],
  ['ЖК Көктем','Алматинский','пр. Рыскулова, 8'],
  ['ЖК Сарыарка Сити','Сарыарка','ул. Сейфуллина, 31'],
  ['ЖК Байтерек Плаза','Байконур','ул. Кенесары, 40'],
  ['ЖК Нура Резиденс','Нура','пр. Кабанбай батыра, 11']
];
const APT_NUMS = [12,45,7,88,103,21,56,9,134,77,15,62,31,148,4,93,27,110,38,66,19,121,53,84];
const ROOMS = [['Студия',2,[16,20]],['1-комн.',3,[20,26]],['2-комн.',4,[28,36]],['3-комн.',6,[40,48]]];
const CLEANERS = ['Айгерим','Динара','Гульнара','Светлана']; // совпадают с аккаунтами уборщиков (assets/store.js)
const GUESTS = ['Айдар Сериков','Мария Иванова','Ержан Касымов','Анна Ли','Тимур Абенов','Дана Нурланова','Ли Вэй','Алия Жумабаева','Сергей Петров','Олжас Бекенов','Эмма Мюллер','Асель Токаева','Дмитрий Ким','Нурлан Ахметов','Камила Садыкова','Арман Джаксыбеков','Екатерина Смирнова','Бахыт Оспанов','Жанна Ермекова','Руслан Галиев','Мадина Исаева','Кирилл Орлов','Айжан Мухтарова','Виктор Пак','Салтанат Ибраева','Джон Смит','Гульмира Абдрахманова','Павел Соколов','Динмухамед Омаров','Ольга Каримова','Азамат Султанов','Юлия Ковалёва'];
const NOTES = ['Поздний заезд около 23:00, оставить ключи в сейфе.','Гости с ребёнком — нужна детская кроватка.','Просили ранний заезд, если квартира будет готова.','Командировка, нужны закрывающие документы.','Постоянный гость, скидка 5%.','Аллергия на перьевые подушки — положить синтетику.','','',''];

const apartments = APT_NUMS.map((num,i) => {
  const c = COMPLEXES[i%COMPLEXES.length];
  const r = i===0 ? ROOMS[2] : wpick([[ROOMS[0],3],[ROOMS[1],5],[ROOMS[2],4],[ROOMS[3],1.5]]);
  const price = ri(r[2][0]*2,r[2][1]*2)*500;
  return {id:i+1,num,name:`${c[0]}, кв. ${num}`,complex:c[0],district:c[1],address:`${c[2]}, кв. ${num}`,rooms:r[0],maxGuests:r[1],price};
});
const aptById = id => apartments.find(a=>a.id===id);

const blocks = [], repairs = [];
let repId = 1;
[[3,TODAY+2,3,'Замена смесителя и сифона','Сантехник Марат',38000],
 [9,TODAY+7,2,'Покраска стен в спальне','Мастер Ерлан',65000],
 [16,TODAY-1,3,'Ремонт стиральной машины','Сервис «ТехноМастер»',24000],
 [21,TODAY+13,2,'Замена матраса и штор','Мастер Ерлан',120000]].forEach(([idx,from,len,title,who,cost])=>{
  const a = apartments[idx];
  const r = {id:repId++, aptId:a.id, title, assignee:who, priority:'medium', status: from<=TODAY?'progress':'open', date:from, cost, source:'Вручную', blockDays:len};
  repairs.push(r);
  blocks.push({id:'blk'+r.id, aptId:a.id, from, to:from+len, title, repairId:r.id});
});
[['Не работает Wi‑Fi роутер','Мастер Ерлан','high','open',TODAY,0],
 ['Заменить батарейки в электронном замке','Мастер Ерлан','high','progress',TODAY,3500],
 ['Скрипит дверь шкафа-купе','Мастер Ерлан','low','open',TODAY+2,0],
 ['Засор в раковине на кухне','Сантехник Марат','medium','done',TODAY-2,7000],
 ['Проверить кондиционер перед сезоном','Сервис «Климат»','low','done',TODAY-6,12000],
 ['Купить сушилку для белья и 2 комплекта полотенец','Администратор','medium','open',TODAY+1,18000],
 ['Не закрывается окно на балконе','Мастер Ерлан','medium','done',TODAY-9,9000]].forEach(([title,who,prio,st,date,cost])=>{
  repairs.push({id:repId++, aptId:pick(apartments).id, title, assignee:who, priority:prio, status:st, date, cost, source:'Вручную'});
});

let bookingSeq = 1040;
const bookings = [];
const overlapsBlock = (aptId, ci, co) => blocks.some(b=>b.aptId===aptId && b.from<co && ci<b.to);
apartments.forEach(a => {
  let cur = di(2026,8,24) + ri(0,5);
  const end = di(2026,11,12);
  while(cur < end){
    const gap = wpick([[0,40],[1,25],[2,15],[3,10],[5,6]]);
    const ci = cur + gap;
    const n = wpick([[1,12],[2,26],[3,26],[4,15],[5,9],[6,6],[7,6]]);
    const co = ci + n;
    const blk = blocks.find(b=>b.aptId===a.id && b.from<co && ci<b.to);
    if(blk){ cur = blk.to; continue; }
    const src = wpick([['airbnb',25],['booking',30],['telegram',14],['whatsapp',20],['site',11]]);
    const nightly = Math.round(a.price*(0.9+rnd()*0.25)/500)*500;
    let pay;
    if(co<=TODAY) pay='paid';
    else if(ci<=TODAY) pay = rnd()<.75?'paid':'prepaid';
    else pay = wpick([['paid',50],['prepaid',32],['unpaid',18]]);
    if((src==='airbnb' || src==='booking') && pay==='unpaid' && rnd()<.6) pay='paid';
    bookings.push({id:bookingSeq++, aptId:a.id, guest:pick(GUESTS), phone:'+7 70'+ri(0,8)+' '+ri(100,999)+' '+ri(10,99)+' '+ri(10,99),
      source:src, ci, co, guests:ri(1,a.maxGuests), nightly, total:nightly*n, payment:pay, transfer: rnd()<.24,
      cleaner:pick(CLEANERS), note:pick(NOTES), checkinTime: pick(['14:00','14:00','15:00','16:00','20:00','23:30']), checkoutTime: pick(['12:00','12:00','11:00','10:00'])});
    cur = co;
  }
});
const bById = id => bookings.find(b=>b.id===id);
const isFree = (aptId, ci, co) => !bookings.some(b=>b.aptId===aptId && b.ci<co && ci<b.co) && !overlapsBlock(aptId,ci,co);

/* --- уборки --- */
const CHECKLIST = ['Сменить постельное бельё','Заменить полотенца','Помыть посуду и кухню','Убрать санузел','Пропылесосить и помыть полы','Вынести мусор','Пополнить чай, кофе, мыло','Проверить технику и пульты'];
const ROOMS_PH = [['Спальня',235],['Кухня',38],['Ванная',190],['Гостиная',140]];
let cleanId = 1;
const cleanings = [];
bookings.filter(b=>b.co>=TODAY-1 && b.co<=TODAY+1).sort((x,y)=>x.co-y.co||x.aptId-y.aptId).forEach((b,i)=>{
  const next = bookings.find(n=>n.aptId===b.aptId && n.ci===b.co);
  let status = 'assigned';
  if(b.co<TODAY) status='done';
  else if(b.co===TODAY) status = i%3===0?'done':(i%3===1?'progress':'assigned');
  const k0 = ri(2,5);
  const checked = CHECKLIST.map((_,k)=> status==='done' ? true : status==='progress' ? k<k0 : false);
  cleanings.push({id:cleanId++, bookingId:b.id, aptId:b.aptId, date:b.co, cleaner:b.cleaner, from:b.checkoutTime, to: next?'14:00':'18:00', nextGuest: next?next.guest:null, nextCheckin: next?next.checkinTime:null,
    status, checked, doneAt: status==='done'?pick(['12:48','13:15','13:32','13:50']):null});
});

/* равномерно распределяем уборки между уборщиками (детерминированно, без вызовов rnd) */
(function(){
  const plan = {}; plan[TODAY] = ['Гульнара','Айгерим','Светлана','Динара','Гульнара'];
  const rr = ['Гульнара','Айгерим','Динара','Светлана'];
  const byDay = {};
  cleanings.forEach(c=>{ (byDay[c.date]=byDay[c.date]||[]).push(c); });
  Object.keys(byDay).forEach(d=>{ byDay[d].forEach((c,i)=>{ const p=plan[d]; c.cleaner = p&&p[i] ? p[i] : rr[i%rr.length]; const b=bookings.find(x=>x.id===c.bookingId); if(b) b.cleaner=c.cleaner; }); });
})();

/* --- заявки --- */
const REQ_TEXTS = [
  g=>`Здравствуйте! Свободна ли квартира на эти даты? Нас будет ${g} ${plural(g,'человек','человека','человек')}.`,
  ()=>'Добрый день, хотим забронировать. Можно ранний заезд часов в 10 утра?',
  ()=>'Салем! Нужна квартира рядом с Байтереком на выходные, желательно с парковкой.',
  ()=>'Подскажите, есть ли в квартире стиральная машина и утюг?',
  ()=>'Можно с ребёнком 2 лет? Нужна детская кроватка.',
  ()=>'Прилетаем ночным рейсом в 23:40, нужен трансфер из аэропорта.',
  ()=>'Хочу продлить проживание ещё на 2 ночи, это возможно?',
  ()=>'Возможен ли поздний выезд до 15:00? Готов доплатить.',
  ()=>'Скиньте, пожалуйста, фото ванной и точный адрес.',
  ()=>'Командировка, нужны документы для бухгалтерии. Оплата по счёту.',
  ()=>'Добрый вечер! Сколько будет стоить неделя в двушке?',
  ()=>'Бронирую для родителей, они приедут поездом утром.'
];
const REQ_TIMES = ['Сегодня, 21:48','Сегодня, 20:15','Сегодня, 18:37','Сегодня, 16:02','Сегодня, 14:21','Сегодня, 11:09','Сегодня, 09:44','Вчера, 22:30','Вчера, 19:12','Вчера, 15:05','Вчера, 10:17','28 сен, 18:40'];
const REQ_ST = ['new','new','new','new','new','progress','progress','progress','progress','confirmed','confirmed','confirmed'];
const REQ_CH = ['telegram','whatsapp','airbnb','site','whatsapp','booking','telegram','whatsapp','airbnb','site','telegram','booking'];
const requests = REQ_TEXTS.map((f,i)=>{
  const g = ri(1,4); const n = ri(1,5); let ci = TODAY + ri(1,24); let aptId=null;
  const order = apartments.slice().sort(()=>rnd()-.5);
  for(let tries=0; tries<8 && !aptId; tries++){ const cand = order.find(a=>isFree(a.id,ci,ci+n) && a.maxGuests>=g); if(cand) aptId=cand.id; else ci++; }
  if(!aptId) aptId = order[0].id;
  const a = aptById(aptId);
  return {id:i+1, channel:REQ_CH[i], name:GUESTS[(i*7+3)%GUESTS.length], text:f(g), aptId, ci, co:ci+n, guests:g, sum:a.price*n, time:REQ_TIMES[i], status:REQ_ST[i], bookingId:null};
});

/* --- трансферы --- */
const DRIVERS = ['Бауыржан · Toyota Camry','Руслан · Hyundai Sonata','Канат · Kia K5'];
const FLIGHTS = ['KC 852','DV 713','FS 7021','SU 1920','KC 102','TK 356','DV 780','FS 7173','KC 917'];
let trId = 1;
const transfers = [];
function makeTransfer(b, dir){
  const day = dir==='in'?b.ci:b.co;
  const status = day<TODAY?'done':day===TODAY?pick(['driver','driver','planned']):day<=TODAY+3?pick(['driver','driver','planned']):pick(['planned','driver','driver']);
  return {id:trId++, bookingId:b.id, dir, date:day, time: dir==='in'?pick(['06:40','09:15','13:30','17:50','22:10','23:55']):pick(['05:30','08:00','10:40','15:20']),
    flight:pick(FLIGHTS), pax:b.guests, driver: status==='planned'?null:pick(DRIVERS), price: dir==='in'?pick([7000,8000,8000]):7000, status};
}
bookings.filter(b=>b.transfer && b.ci>=TODAY-4 && b.ci<=TODAY+21).forEach(b=>{
  transfers.push(makeTransfer(b,'in'));
  if(rnd()<.45 && b.co<=TODAY+24) transfers.push(makeTransfer(b,'out'));
});

/* =================== Общие помощники для всех страниц =================== */
const isoOf = i => dt(i).toISOString().slice(0,10);               // индекс дня -> 'YYYY-MM-DD'
const idxOf = iso => { const p=String(iso).split('-').map(Number); return p.length===3&&p.every(x=>x>0) ? di(p[0],p[1],p[2]) : NaN; };
const nowHM = () => { const n=new Date(); return String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0'); };
/* вымышленная информация о входе в квартиру (детерминированно от id) */
const aptDoor = a => ({ entrance: (a.id%4)+1, floor: (a.num%15)+2, intercom: a.num+'К'+(((a.id*7919)%9000)+1000), keybox: String(((a.id*2741)%9000)+1000), wifi: 'Stay_'+a.num });
/* рейтинг и отзывы для сайта гостей */
const aptRating = a => (4.5 + ((a.id*37)%50)/100).toFixed(2).replace('.',',');
const aptReviews = a => 12 + (a.id*53)%140;
const DISTRICTS = ['Есиль','Алматинский','Сарыарка','Байконур','Нура'];
