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
  {id:'svetlana', name:'Светлана Ким',      short:'Светлана', role:'cleaner', login:'svetlana', pass:'demo', phone:'+7 747 745 83 36', g:'f', online:false, lastLogin:'Сегодня, 10:20', rating:4.6, monthDone:26},
  {id:'marat',    name:'Марат Жумабаев',    short:'Марат',    role:'master',  spec:'Сантехник', login:'marat', pass:'demo', phone:'+7 701 856 42 19', g:'m', online:true,  lastLogin:'Сегодня, 09:05', rating:4.9, monthDone:18},
  {id:'erlan',    name:'Ерлан Садыков',     short:'Ерлан',    role:'master',  spec:'Электрик',  login:'erlan', pass:'demo', phone:'+7 776 290 13 58', g:'m', online:true,  lastLogin:'Сегодня, 09:22', rating:4.7, monthDone:15}
];
const ROLE_NAME = {owner:'Владелец', admin:'Администратор', cleaner:'Специалист по клинингу', master:'Мастер'};
const isTeamRole = r => r==='cleaner' || r==='master';   // роли мобильного приложения «Сутки·Pro Команда»

const defaultState = () => ({v:1, seq:1000, requests:[], cleanings:{}, problems:[], activity:[], staffAdded:[], access:{}, presence:{}, repairStatus:{}, transferStatus:{}, repairOv:{}, repairsAdded:[], cleanAdded:[], notify:[], linkReports:{}});

const Store = {
  load(){
    try { const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return Object.assign(defaultState(), raw && typeof raw==='object' ? raw : {}); }
    catch(e){ return defaultState(); }
  },
  save(st){
    try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); return true; }
    catch(e){
      // не хватило места (фото) — убираем миниатюры реальных фото, оставляя их количество
      try { const trim = arr => (arr||[]).forEach(p=>{ if(p && p.src){ delete p.src; p.demo=true; p.label=p.label||'Фото'; p.hue=p.hue||200; } });
        Object.values(st.cleanings||{}).forEach(c=>trim(c.photos)); Object.values(st.repairOv||{}).forEach(o=>{ trim(o.before); trim(o.after); trim(o.ownerPhotos); }); (st.repairsAdded||[]).forEach(o=>trim(o.ownerPhotos)); Object.values(st.linkReports||{}).forEach(o=>{ trim(o.photos); trim(o.before); trim(o.after); });
        localStorage.setItem(STORE_KEY, JSON.stringify(st)); return 'trimmed'; } catch(e2){ return false; }
    }
  },
  update(fn){ const st = this.load(); fn(st); const r = this.save(st); return {st, ok:r}; },
  reset(){ localStorage.removeItem(STORE_KEY); localStorage.removeItem(USER_KEY); localStorage.removeItem('sutkipro.team.v1'); try{ sessionStorage.clear(); }catch(e){} }
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

/* ---------- демо-авторизация ----------
   Две независимые сессии в одном браузере: «панель» (владелец/админ) и «команда» (клининг/мастер),
   чтобы в демо можно было держать открытыми панель владельца и приложение сотрудника в соседних вкладках. */
const TEAM_KEY  = 'sutkipro.team.v1';
const Auth = {
  keyFor(role){ return isTeamRole(role) ? TEAM_KEY : USER_KEY; },
  current(scope){
    const rd = k => { try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } };
    if(scope==='team') return rd(TEAM_KEY); if(scope==='panel') return rd(USER_KEY);
    return rd(USER_KEY) || rd(TEAM_KEY);
  },
  login(id){
    const s = staffById(id); if(!s) return {ok:false, msg:'Пользователь не найден'};
    if(!s.access) return {ok:false, msg:'Доступ для «'+s.short+'» отключён владельцем'};
    const t = nowHM();
    Store.update(st=>{ st.presence[s.id] = {online:true, lastLogin:'Сегодня, '+t}; logActivity(st, s.short, s.short+' '+verb(s,'вошёл','вошла')+' в '+t, 'login'); });
    localStorage.setItem(this.keyFor(s.role), JSON.stringify({id:s.id, name:s.name, short:s.short, role:s.role, at:Date.now()}));
    return {ok:true, user:s};
  },
  logout(scope){
    const u = this.current(scope);
    if(u){ const s = staffById(u.id); const t=nowHM();
      Store.update(st=>{ st.presence[u.id] = Object.assign({}, st.presence[u.id]||{lastLogin:s&&s.lastLogin}, {online:false}); logActivity(st, u.short, u.short+' '+verb(s,'вышел','вышла')+' в '+t, 'logout'); });
      localStorage.removeItem(this.keyFor(u.role)); }
  },
  /* проверка: пользователь есть и у него не отключён доступ */
  check(scope){
    const u = this.current(scope); if(!u) return null;
    const s = staffById(u.id); if(!s || !s.access){ localStorage.removeItem(this.keyFor(u.role)); return scope ? null : this.check(u.role && isTeamRole(u.role) ? 'panel' : 'team'); }
    return Object.assign({}, u, {role:s.role, name:s.name, short:s.short});
  }
};

/* ---------- способы оплаты с сайта ---------- */
const PAY_METHODS = {
  card:     {label:tx('Картой онлайн'),          short:'картой онлайн — оплачено (демо)', color:'green'},
  cash:     {label:tx('Наличными при заселении'), short:'наличными при заселении',         color:'amber'},
  telegram: {label:tx('Написать в Telegram'),     short:'договориться в Telegram',         color:'blue'},
  whatsapp: {label:tx('Написать в WhatsApp'),     short:'договориться в WhatsApp',         color:'green'}
};

/* ---------- применение сохранённых изменений к сгенерированным данным ---------- */
function applyCleaningOverrides(st){
  (st.cleanAdded||[]).forEach(x=>{ if(!cleanings.some(c=>c.id===x.id)) cleanings.push(Object.assign({}, x, {checked:(x.checked||CHECKLIST.map(()=>false)).slice()})); });
  (cleanings||[]).forEach(c=>{ const o = st.cleanings[c.id]; if(!o) return;
    ['status','checked','doneAt','photos','comment','startedAt','enrouteAt','by','link','viaLink','reportAt'].forEach(k=>{ if(o[k]!==undefined) c[k]=o[k]; }); });
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
  airport: {name:tx('Аэропорт Астаны (NQZ)'), short:tx('Аэропорт NQZ'), meet:tx('в зоне прилёта у выхода из таможни'), wait:60, code:tx('Номер рейса'), codePh:tx('например, KC 852'), lead:180,
            dirs:{from:tx('Из аэропорта'), to:tx('В аэропорт'), round:tx('Туда и обратно')}},
  station: {name:tx('Ж/д вокзал «Нурлы Жол»'), short:tx('Вокзал Нурлы Жол'), meet:tx('у выхода с платформы в главном зале'), wait:20, code:tx('Номер поезда и вагон'), codePh:tx('например, 002Ц, вагон 7'), lead:60,
            dirs:{from:tx('С вокзала'), to:tx('На вокзал'), round:tx('Туда и обратно')}}
};
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
  const cn = TR_CLASSES[t.cls]?TR_CLASSES[t.cls].name:tx('Стандарт');
  const lines = t.dir==='round' ? [[`${cn} · ${tx('2 поездки')}`, pc.one*2], [tx('Скидка «туда и обратно»'), base-pc.one*2]] : [[`${cn} · ${tx('в одну сторону')}`, base]];
  if(seats) lines.push([`${tx('Детское кресло')} × ${t.seats}${n>1?' × '+tx('2 поездки'):''}`, seats]);
  if(night) lines.push([`${tx('Ночная подача (23:00–06:00)')}${nights>1?' × 2':''}`, night]);
  const total = base+seats+night;
  /* стоимость каждой ноги — для раздела «Трансферы» у владельца */
  const legPrices = legs.map(l=> Math.round(base/n) + (t.seats||0)*TR_SEAT + (trIsNight(l.time)?TR_NIGHT:0));
  return {base, seats, night, total, lines, legs, legPrices, full: pc.one*n};
}
/* кратко одной строкой: «Из аэропорта · Стандарт · 2 пасс., 2 багажа, 1 кресло» */
function trSummary(t){
  const P=TR_PLACES[t.place]||TR_PLACES.airport; const C=TR_CLASSES[t.cls]||TR_CLASSES.standard;
  if(IS_EN) return `${P.dirs[t.dir]}${t.place==='station'&&t.dir==='round'?' (station)':''} · ${C.name} · ${t.pax} pax, ${t.bags} ${t.bags===1?'bag':'bags'}${t.seats?`, ${t.seats} child ${t.seats===1?'seat':'seats'}`:''}`;
  return `${P.dirs[t.dir]}${t.place==='station'&&t.dir==='round'?' (вокзал)':''} · ${C.name} · ${t.pax} пасс., ${t.bags} ${plural(t.bags,'место','места','мест')} багажа${t.seats?`, ${t.seats} ${plural(t.seats,'кресло','кресла','кресел')}`:''}`;
}
const TR_PAY = {
  driver: {label:tx('Водителю при встрече'), sub:tx('Наличными или Kaspi'), short:'водителю при встрече', color:'amber'},
  card:   {label:tx('Картой онлайн'),        sub:tx('Демо-оплата, без списания'), short:'картой онлайн — оплачено (демо)', color:'green'}
};

/* ---------- ремонты: общее состояние для панели владельца, приложения мастера и задач по ссылке ---------- */
const REP_STAGE = ['assigned','enroute','progress','done'];
const REP_STAGE_L = {assigned:'Назначена', enroute:'В пути', progress:'В работе', done:'Готово'};
function syncRepairs(st){
  st = st || Store.load();
  (st.problems||[]).forEach(p=>{ if(repairs.some(r=>r.id===p.id)) return;
    repairs.push({id:p.id, aptId:p.aptId, title:p.title, desc:p.category?('Категория: '+p.category+'. Сообщила команда клининга во время уборки.'):'', assignee:'Не назначен', masterId:null, priority:p.priority||'high', status:'open', date:TODAY, cost:0, source:'Клининг', reporter:p.by, seed:true, photos:p.photos||0}); });
  (st.repairsAdded||[]).forEach(x=>{ if(!repairs.some(r=>r.id===x.id)) repairs.push(Object.assign({seed:true, cost:0}, x)); });
  repairs.forEach(r=>{ if(!r.seed) return;
    const s2 = (st.repairStatus||{})[r.id]; if(s2) r.status = s2;
    const o = (st.repairOv||{})[r.id]; if(o) Object.assign(r, o);
    if(!r.stage || (s2 && !(o && o.stage))) r.stage = r.status==='done' ? 'done' : r.status==='progress' ? 'progress' : 'assigned';
  });
  return repairs;
}
function saveRepair(r, fields){
  Object.assign(r, fields);
  return Store.update(st=>{ st.repairOv = st.repairOv || {}; st.repairOv[r.id] = Object.assign({}, st.repairOv[r.id]||{}, fields); if(fields.status) st.repairStatus[r.id] = fields.status; });
}
const masterLabel = s => s ? `${s.spec||'Мастер'} ${s.short}` : 'Не назначен';

/* ---------- ремонты: тип работ, подрядчики, доступ в квартиру, смета ---------- */
const WORK_TYPES = {
  plumb:{l:'Сантехника', ic:'drop', spec:'Сантехник'}, elec:{l:'Электрика', ic:'bolt', spec:'Электрик'},
  appl:{l:'Бытовая техника', ic:'washer', spec:'Техника'}, furn:{l:'Мебель', ic:'sofa', spec:'Мебель'}, other:{l:'Другое', ic:'wrench', spec:'Разное'}
};
const WT_KEYS = Object.keys(WORK_TYPES);
const SPEC_TYPE = {'Сантехник':'plumb', 'Электрик':'elec'};
function guessWorkType(t){ t = String(t||'').toLowerCase();
  if(/стиральн|холодильн|кондиционер|посудомо|плит[аыу]|духовк|микроволн|бойлер|пылесос|телевизор|чайник|утюг/.test(t)) return 'appl';
  if(/розетк|свет|искрит|автомат|провод|ламп|выключател|электр|домофон|wi.?fi|роутер|замк|замок|батарейк/.test(t)) return 'elec';
  if(/теч[её]т|течь|кран|унитаз|бачок|смесител|сифон|засор|раковин|душ|труб|канализ|вод[аы]/.test(t)) return 'plumb';
  if(/шкаф|кровать|диван|стол|стул|дверц|матрас|карниз|штор|полк|купе/.test(t)) return 'furn';
  return 'other'; }
/* постоянные подрядчики без аккаунта (у мастеров-сотрудников аккаунт есть — они в STAFF_BASE) */
const CONTRACTORS_BASE = [
  {id:'k1', name:'Сервис «ТехноМастер»', type:'appl', phone:'+7 717 255 40 40', rating:4.6, regular:true, note:'стиральные и посудомоечные машины'},
  {id:'k2', name:'Сервис «Климат»',      type:'appl', phone:'+7 717 279 11 22', rating:4.8, regular:true, note:'кондиционеры, вытяжки'},
  {id:'k3', name:'Бригада «ПокрасСтрой»', type:'other', phone:'+7 747 390 55 10', rating:4.5, regular:true, note:'покраска, мелкий ремонт'},
  {id:'k4', name:'Сервис «ОкнаПро»',     type:'other', phone:'+7 708 612 70 70', rating:4.4, regular:true, note:'окна и балконы'},
  {id:'k5', name:'Даурен (мебельщик)',   type:'furn',  phone:'+7 776 118 23 45', rating:4.9, regular:true, note:'сборка и ремонт мебели'}
];
function allContractors(st){ st = st || Store.load(); const ov = st.contractorOv || {};
  return CONTRACTORS_BASE.concat(st.contractors || []).map(c => Object.assign({}, c, ov[c.id] || {})); }
const contractorById = id => allContractors().find(c=>c.id===id);
const ACCESS_L = {code:'Код замка (показать в задаче)', keys:'Ключи у администратора', presence:'Нужно личное присутствие'};
const ACCESS_S = {code:'Код замка', keys:'Ключи у администратора', presence:'Личное присутствие'};
function accessText(r){ const x = r.access || {mode:'code'};
  if(x.mode==='keys') return 'Ключи у администратора' + (x.whoName ? ` (${x.whoName})` : '');
  if(x.mode==='presence') return `Встретит: ${x.whoName||'администратор'}${x.time?' в '+x.time:''}`;
  return 'Код замка — в задаче'; }
/* смета мастера: pending → approved / rejected; итог — при завершении; paid — оплачено */
const quoteTotal = q => q ? (+q.work||0) + (+q.parts||0) : 0;
/* сумма ремонта для «Финансов»: согласованная смета или итог; старые задачи без сметы — как было */
function repCost(r){ if(r.quote){ if(r.status==='done') return +r.cost||quoteTotal(r.quote.status==='approved'?r.quote:null); return r.quote.status==='approved' ? quoteTotal(r.quote) : 0; } return +r.cost||0; }
function repCostState(r){ const q = r.quote;
  if(r.status==='done' && (r.cost||q)) return r.paid ? 'paid' : 'final';
  if(!q) return r.cost ? 'plan' : 'none';
  return q.status; }

/* ---------- уведомления команде (демо: через localStorage; в рабочей версии — Web Push с сервера) ---------- */
function pushNotify(st, to, title, body, url){
  st.notify = st.notify || []; const n = {id:++st.seq, to, title, body, url:url||'cleaning.html', ts:Date.now()};
  st.notify.push(n); if(st.notify.length>40) st.notify = st.notify.slice(-40); return n;
}

/* ---------- задача по ссылке: данные задачи кодируются прямо в ссылке (base64url JSON), сервер не нужен ---------- */
const TaskLink = {
  enc(obj){ const b = btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); return b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); },
  dec(t){ try { t = String(t||'').replace(/-/g,'+').replace(/_/g,'/'); while(t.length%4) t+='='; const o = JSON.parse(decodeURIComponent(escape(atob(t)))); return o && o.v===1 && o.t ? o : null; } catch(e){ return null; } },
  url(obj){ return new URL('task.html?t='+this.enc(obj), location.href).href; },
  aptPart(a){ const d = aptDoor(a); return {a:{n:a.num, c:a.complex, ad:a.address, di:a.district, r:a.rooms}, dr:{e:d.entrance, f:d.floor, i:d.intercom, k:d.keybox}}; },
  owner(){ const o = STAFF_BASE[0]; return {n:o.short, ph:o.phone}; },
  forRepair(r, who){ const a = aptById(r.aptId); const x = r.access || {mode:'code'};
    const o = Object.assign({v:1, k:'r', id:r.id, t:r.title, d:r.desc||'', p:r.priority, dt:fD(r.date), tm:r.window||'', ty:r.type||'', w:who||'', o:this.owner(), ac:{m:x.mode, w:x.whoName||'', tm:x.time||''}}, this.aptPart(a));
    if(x.mode!=='code') delete o.dr.k;   // код сейфа с ключами — только если доступ «по коду»
    return o; },
  forCleaning(c, who){ const a = aptById(c.aptId);
    return Object.assign({v:1, k:'c', id:c.id, t:'Уборка после выезда гостей', d:c.nextCheckin?`Следующий заезд в ${c.nextCheckin} — успеть до заезда.`:'Сегодня заезда нет.', p:c.nextCheckin&&c.nextCheckin<='16:00'?'high':'medium', dt:fD(c.date), tm:`${c.from}–${c.to}`, w:who||'', o:this.owner()}, this.aptPart(a)); },
  key(o){ return (o.k||'r')+o.id; }
};

/* ---------- валюты сайта для гостей: курсы и правила задаёт владелец («Настройки → Валюты и цены») ---------- */
const FX_CUR = {
  KZT: {sym:'₸', name:'Тенге',           en:'Tenge',          pre:false, base:true},
  RUB: {sym:'₽', name:'Российский рубль', en:'Russian rouble', pre:false},
  USD: {sym:'$', name:'Доллар США',       en:'US dollar',      pre:true},
  EUR: {sym:'€', name:'Евро',             en:'Euro',           pre:true}
};
const FX_CODES = Object.keys(FX_CUR);
/* ДЕМО-курсы (не реальные): сколько тенге стоит 1 единица валюты */
const FX_DEFAULT = () => ({rates:{RUB:6.3, USD:510, EUR:575}, show:{KZT:true, RUB:true, USD:true, EUR:true}, round:{mode:'nearest', step:{RUB:10, USD:1, EUR:1}}, over:{}, updated:null});
function fxGet(st){ st = st || Store.load(); const d = FX_DEFAULT(); const f = st.fx || {};
  return {rates:Object.assign(d.rates, f.rates||{}), show:Object.assign(d.show, f.show||{}), round:{mode:(f.round&&f.round.mode)||d.round.mode, step:Object.assign(d.round.step, (f.round&&f.round.step)||{})}, over:f.over||{}, updated:f.updated||null}; }
function fxRound(v, code, fx){ if(code==='KZT') return Math.round(v); const st = fx.round.step[code]||1; const m = fx.round.mode; const q = v/st;
  return (m==='up' ? Math.ceil(q-1e-9) : m==='down' ? Math.floor(q+1e-9) : Math.round(q)) * st; }
function fxConv(kzt, code, fx){ if(!code || code==='KZT') return Math.round(kzt); const r = fx.rates[code]; return r>0 ? fxRound(kzt/r, code, fx) : Math.round(kzt); }
/* цена за ночь в валюте: ручная цена владельца для квартиры, если задана, иначе — по курсу */
function fxNight(apt, code, fx){ const o = (fx.over[apt.id]||{})[code]; return (o>0) ? +o : fxConv(apt.price, code, fx); }
function fxFmt(v, code){ const c = FX_CUR[code]||FX_CUR.KZT; const n = String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, (IS_EN?',':'\u00a0'));
  return c.pre ? c.sym+n : n+'\u00a0'+c.sym; }
