/* Сутки·Pro — общее демо-состояние в localStorage (заявки с сайта, отчёты клининга,
   проблемы, журнал действий, сотрудники) и демо-авторизация. Никакого сервера нет. */
'use strict';
const STORE_KEY = 'sutkipro.demo.v1';
const USER_KEY  = 'sutkipro.user.v1';

/* Базовый состав сотрудников (вымышленные). short — имя, которое используется в уборках. */
const STAFF_BASE = [
  {id:'owner',    name:'Азамат Нургалиев',  short:'Азамат',   role:'owner',   login:'azamat',   pass:'demo', phone:'+7 701 100 20 30', g:'m', online:true,  lastLogin:'Сегодня, 08:15'},
  {id:'admin',    name:'Алина Бекова',      short:'Алина',    role:'admin',   login:'alina',    pass:'demo', phone:'+7 702 311 45 67', g:'f', online:true,  lastLogin:'Сегодня, 08:47'},
  {id:'gulnara',  name:'Гульнара Ахметова', short:'Гульнара', role:'cleaner', login:'gulnara',  pass:'demo', phone:'+7 705 412 18 90', g:'f', online:true,  lastLogin:'Сегодня, 09:12', rating:4.9, monthDone:41},
  {id:'aigerim',  name:'Айгерим Касенова',  short:'Айгерим',  role:'cleaner', login:'aigerim',  pass:'demo', phone:'+7 707 523 64 12', g:'f', online:true,  lastLogin:'Сегодня, 09:30', rating:4.8, monthDone:37},
  {id:'dinara',   name:'Динара Омарова',    short:'Динара',   role:'cleaner', login:'dinara',   pass:'demo', phone:'+7 708 634 77 25', g:'f', online:true,  lastLogin:'Сегодня, 10:05', rating:4.7, monthDone:33},
  {id:'svetlana', name:'Светлана Ким',      short:'Светлана', role:'cleaner', login:'svetlana', pass:'demo', phone:'+7 747 745 83 36', g:'f', online:false, lastLogin:'Сегодня, 10:20', rating:4.6, monthDone:26}
];
const ROLE_NAME = {owner:'Владелец', admin:'Администратор', cleaner:'Специалист по клинингу'};

const defaultState = () => ({v:1, seq:1000, requests:[], cleanings:{}, problems:[], activity:[], staffAdded:[], access:{}, presence:{}, repairStatus:{}, transferStatus:{}});

const Store = {
  load(){
    try { const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return Object.assign(defaultState(), raw && typeof raw==='object' ? raw : {}); }
    catch(e){ return defaultState(); }
  },
  save(st){
    try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); return true; }
    catch(e){
      // не хватило места (фото) — убираем миниатюры реальных фото, оставляя их количество
      try { Object.values(st.cleanings||{}).forEach(c=>{ (c.photos||[]).forEach(p=>{ if(p.src){ delete p.src; p.demo=true; p.label=p.label||'Фото'; p.hue=p.hue||200; } }); });
        localStorage.setItem(STORE_KEY, JSON.stringify(st)); return 'trimmed'; } catch(e2){ return false; }
    }
  },
  update(fn){ const st = this.load(); fn(st); const r = this.save(st); return {st, ok:r}; },
  reset(){ localStorage.removeItem(STORE_KEY); localStorage.removeItem(USER_KEY); try{ sessionStorage.clear(); }catch(e){} }
};

/* ---------- сотрудники ---------- */
function allStaff(st){
  st = st || Store.load();
  return STAFF_BASE.concat(st.staffAdded || []).map(s=>{
    const pr = (st.presence||{})[s.id] || {};
    return Object.assign({}, s, {
      access: (st.access||{})[s.id] !== false,
      online: pr.online !== undefined ? pr.online : s.online,
      lastLogin: pr.lastLogin || s.lastLogin || 'ещё не входил(а)'
    });
  });
}
const staffById = (id, st) => allStaff(st).find(s=>s.id===id);
const staffByShort = (short, st) => allStaff(st).find(s=>s.short===short);
const verb = (s, m, f) => (s && s.g==='m') ? m : f;
function logActivity(st, who, text, type){ st.activity.push({t:nowHM(), who, text, type:type||'info', ts:Date.now()}); if(st.activity.length>200) st.activity = st.activity.slice(-200); }

/* ---------- демо-авторизация ---------- */
const Auth = {
  current(){ try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch(e){ return null; } },
  login(id){
    const s = staffById(id); if(!s) return {ok:false, msg:'Пользователь не найден'};
    if(!s.access) return {ok:false, msg:'Доступ для «'+s.short+'» отключён владельцем'};
    const t = nowHM();
    Store.update(st=>{ st.presence[s.id] = {online:true, lastLogin:'Сегодня, '+t}; logActivity(st, s.short, s.short+' '+verb(s,'вошёл','вошла')+' в '+t, 'login'); });
    localStorage.setItem(USER_KEY, JSON.stringify({id:s.id, name:s.name, short:s.short, role:s.role, at:Date.now()}));
    return {ok:true, user:s};
  },
  logout(){
    const u = this.current();
    if(u){ const s = staffById(u.id); const t=nowHM();
      Store.update(st=>{ st.presence[u.id] = Object.assign({}, st.presence[u.id]||{lastLogin:s&&s.lastLogin}, {online:false}); logActivity(st, u.short, u.short+' '+verb(s,'вышел','вышла')+' в '+t, 'logout'); }); }
    localStorage.removeItem(USER_KEY);
  },
  /* проверка: пользователь есть и у него не отключён доступ */
  check(){
    const u = this.current(); if(!u) return null;
    const s = staffById(u.id); if(!s || !s.access){ localStorage.removeItem(USER_KEY); return null; }
    return Object.assign({}, u, {role:s.role, name:s.name, short:s.short});
  }
};

/* ---------- способы оплаты с сайта ---------- */
const PAY_METHODS = {
  card:     {label:'Картой онлайн',          short:'картой онлайн — оплачено (демо)', color:'green'},
  cash:     {label:'Наличными при заселении', short:'наличными при заселении',         color:'amber'},
  telegram: {label:'Написать в Telegram',     short:'договориться в Telegram',         color:'blue'},
  whatsapp: {label:'Написать в WhatsApp',     short:'договориться в WhatsApp',         color:'green'}
};

/* ---------- применение сохранённых изменений к сгенерированным данным ---------- */
function applyCleaningOverrides(st){
  (cleanings||[]).forEach(c=>{ const o = st.cleanings[c.id]; if(!o) return;
    ['status','checked','doneAt','photos','comment','startedAt','enrouteAt','by'].forEach(k=>{ if(o[k]!==undefined) c[k]=o[k]; }); });
}
function saveCleaning(c, extra){
  return Store.update(st=>{ st.cleanings[c.id] = Object.assign({}, st.cleanings[c.id]||{}, {status:c.status, checked:c.checked, doneAt:c.doneAt, photos:c.photos, comment:c.comment, startedAt:c.startedAt, enrouteAt:c.enrouteAt}, extra||{}); });
}
/* свободна ли квартира с учётом заявок с сайта (для гостевого сайта) */
function siteRequestsBlocking(st, aptId, ci, co){
  return (st.requests||[]).some(r=>r.aptId===aptId && r.status!=='cancelled' && r.ci<co && ci<r.co);
}

/* ---------- трансфер: общие правила для сайта гостей и панели владельца ---------- */
const TR_PLACES = {
  airport: {name:'Аэропорт Астаны (NQZ)', short:'Аэропорт NQZ', meet:'в зоне прилёта у выхода из таможни', wait:60, code:'Номер рейса', codePh:'например, KC 852', lead:180,
            dirs:{from:'Из аэропорта', to:'В аэропорт', round:'Туда и обратно'}},
  station: {name:'Ж/д вокзал «Нурлы Жол»', short:'Вокзал Нурлы Жол', meet:'у выхода с платформы в главном зале', wait:20, code:'Номер поезда и вагон', codePh:'например, 002Ц, вагон 7', lead:60,
            dirs:{from:'С вокзала', to:'На вокзал', round:'Туда и обратно'}}
};
const TR_CLASSES = {
  standard: {name:'Стандарт', car:'Toyota Camry или аналог', pax:4, bags:3},
  minivan:  {name:'Минивэн',  car:'Hyundai Staria или аналог', pax:7, bags:7}
};
/* цены за машину (не за человека); «туда и обратно» — со скидкой */
const TR_PRICES = {
  airport: {standard:{one:8000, round:14000}, minivan:{one:12000, round:21000}},
  station: {standard:{one:6000, round:10000}, minivan:{one:9000,  round:16000}}
};
const TR_SEAT = 2000;   // детское кресло / бустер, за поездку в одну сторону
const TR_NIGHT = 1500;  // ночная надбавка 23:00–06:00, за поездку
const trIsNight = hm => { if(!hm) return false; const h=+String(hm).slice(0,2); return h>=23 || h<6; };
const hmAdd = (hm, min) => { const p=String(hm).split(':').map(Number); let t=((p[0]*60+p[1]+min)%1440+1440)%1440; return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0'); };
/* ноги поездки: {dir:'in'|'out', date, time (подача/встреча), code} */
function trLegs(t){
  const L=[]; const P=TR_PLACES[t.place]||TR_PLACES.airport;
  if(t.dir==='from'||t.dir==='round') L.push({dir:'in', date:t.arrDate, time:t.arrTime, code:t.arrCode||''});
  if(t.dir==='to'||t.dir==='round'){ const pick=hmAdd(t.depTime||'12:00', -P.lead); const shift = t.depTime && pick>t.depTime ? -1 : 0;
    L.push({dir:'out', date:t.depDate!=null?t.depDate+shift:null, time:pick, depTime:t.depTime, code:t.depCode||''}); }
  return L;
}
function trPrice(t){
  const P=TR_PRICES[t.place]||TR_PRICES.airport; const pc=P[t.cls]||P.standard; const legs=trLegs(t); const n=legs.length;
  const base = t.dir==='round' ? pc.round : pc.one;
  const seats = (t.seats||0)*TR_SEAT*n;
  const nights = legs.filter(l=>trIsNight(l.time)).length;
  const night = nights*TR_NIGHT;
  const cn = TR_CLASSES[t.cls]?TR_CLASSES[t.cls].name:'Стандарт';
  const lines = t.dir==='round' ? [[`${cn} · 2 поездки`, pc.one*2], ['Скидка «туда и обратно»', base-pc.one*2]] : [[`${cn} · в одну сторону`, base]];
  if(seats) lines.push([`Детское кресло × ${t.seats}${n>1?' × 2 поездки':''}`, seats]);
  if(night) lines.push([`Ночная подача (23:00–06:00)${nights>1?' × 2':''}`, night]);
  const total = base+seats+night;
  /* стоимость каждой ноги — для раздела «Трансферы» у владельца */
  const legPrices = legs.map(l=> Math.round(base/n) + (t.seats||0)*TR_SEAT + (trIsNight(l.time)?TR_NIGHT:0));
  return {base, seats, night, total, lines, legs, legPrices, full: pc.one*n};
}
/* кратко одной строкой: «Из аэропорта · Стандарт · 2 пасс., 2 багажа, 1 кресло» */
function trSummary(t){
  const P=TR_PLACES[t.place]||TR_PLACES.airport; const C=TR_CLASSES[t.cls]||TR_CLASSES.standard;
  return `${P.dirs[t.dir]}${t.place==='station'&&t.dir==='round'?' (вокзал)':''} · ${C.name} · ${t.pax} пасс., ${t.bags} ${plural(t.bags,'место','места','мест')} багажа${t.seats?`, ${t.seats} ${plural(t.seats,'кресло','кресла','кресел')}`:''}`;
}
const TR_PAY = {
  driver: {label:'Водителю при встрече', sub:'Наличными или Kaspi', short:'водителю при встрече', color:'amber'},
  card:   {label:'Картой онлайн',        sub:'Демо-оплата, без списания', short:'картой онлайн — оплачено (демо)', color:'green'}
};
