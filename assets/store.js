/* Сутки·Pro — общее демо-состояние в localStorage (заявки с сайта, отчёты уборщиков,
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
const ROLE_NAME = {owner:'Владелец', admin:'Администратор', cleaner:'Уборщик'};

const defaultState = () => ({v:1, seq:1000, requests:[], cleanings:{}, problems:[], activity:[], staffAdded:[], access:{}, presence:{}, repairStatus:{}});

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
