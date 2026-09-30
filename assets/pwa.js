/* Сутки·Pro Команда — установка на телефон (PWA), работа без интернета и уведомления о новых задачах (демо).
   Уведомления в демо локальные: service worker показывает их, пока приложение открыто или свёрнуто в этом браузере.
   Чтобы уведомление пришло в полностью закрытое приложение, в рабочей версии нужен сервер (Web Push + VAPID). */
(function(){
'use strict';
const P = window.PWA = {};
const LS_HIDE = 'sutkipro.pwa.hide';
const ua = navigator.userAgent || '';
let deferred = null, host = {toast:()=>{}, simulate:null, onNew:null, userId:null};
P.isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
P.isAndroid = /Android/i.test(ua);
P.standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch(e){ return false; } };
P.notifState = () => ('Notification' in window) ? Notification.permission : 'unsupported';
P.swReady = false;

/* ---------- service worker: офлайн-оболочка + показ уведомлений ---------- */
if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register('sw.js', {scope:'./'}).then(r=>{ P.swReady = true; P.reg = r; }).catch(()=>{ P.swReady = false; });
  navigator.serviceWorker.addEventListener('message', e=>{ if(e.data && e.data.type==='open-task'){ try { const h = new URL(e.data.url).hash; if(h && h!==location.hash) location.hash = h; } catch(err){} } });
}
window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferred = e; P.refresh(); });
window.addEventListener('appinstalled', ()=>{ deferred = null; host.toast('Приложение установлено — ищите «Сутки·Pro» на экране телефона'); P.refresh(); });

const svgShare = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const svgAdd = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
const svgDots = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

function notifBtn(cls){
  const s = P.notifState();
  if(s==='granted') return `<button class="btn sm ${cls||''} pwa-on" data-pwa-test>${ic('check',14,2.6)} Уведомления включены</button>`;
  if(s==='denied') return `<button class="btn sm ${cls||''}" data-pwa-notif>${ic('bell',14)} Уведомления запрещены</button>`;
  return `<button class="btn sm ${cls||''}" data-pwa-notif>${ic('bell',14)} Включить уведомления</button>`;
}
/* баннер в списке задач */
P.bannerHTML = () => {
  if(P.standalone()){
    if(P.notifState()==='granted') return '';
    return `<div class="pwa-card"><div class="pwa-top"><img class="pwa-ic" src="icons/icon-192.png" alt=""><div class="grow"><b>Уведомления о новых задачах</b><small>Узнавайте о новой уборке или ремонте сразу, как владелец её назначит</small></div></div><div class="pwa-btns">${notifBtn('primary')}</div></div>`;
  }
  if(localStorage.getItem(LS_HIDE)) return `<button class="pwa-mini" data-pwa-open>${ic('phone',14)} Установить на телефон · уведомления</button>`;
  return `<div class="pwa-card" id="pwaCard"><button class="pwa-x" data-pwa-hide aria-label="Скрыть">${ic('x',14,2.4)}</button>
    <div class="pwa-top"><img class="pwa-ic" src="icons/icon-192.png" alt=""><div class="grow"><b>Установить на телефон</b><small>Иконка на экране, открывается как приложение и без интернета. Без App Store и Google Play — прямо по ссылке.</small></div></div>
    <div class="pwa-btns"><button class="btn sm primary" data-pwa-install>${ic('phone',14)} Установить на телефон</button>${notifBtn()}</div></div>`;
};
/* нижняя шторка «Приложение и уведомления» */
function sheetHTML(focus){
  const ns = P.notifState(); const inst = P.standalone();
  const iosSteps = `<ol class="pwa-steps">
      <li><span class="n">1</span><div>Откройте эту страницу в <b>Safari</b></div></li>
      <li><span class="n">2</span><div>Нажмите «Поделиться» <span class="pwa-k">${svgShare}</span> внизу экрана</div></li>
      <li><span class="n">3</span><div>Выберите «На экран Домой» <span class="pwa-k">${svgAdd}</span></div></li>
      <li><span class="n">4</span><div>Нажмите «Добавить» — появится иконка «Сутки·Pro»</div></li></ol>`;
  const andSteps = `<ol class="pwa-steps">
      <li><span class="n">1</span><div>Откройте меню Chrome <span class="pwa-k">${svgDots}</span> справа вверху</div></li>
      <li><span class="n">2</span><div>Выберите «Установить приложение» или «Добавить на главный экран»</div></li>
      <li><span class="n">3</span><div>Иконка «Сутки·Pro» появится на экране телефона</div></li></ol>`;
  const install = inst ? `<div class="pwa-ok">${ic('check',16,2.6)} Приложение уже установлено на этом устройстве</div>`
    : P.isIOS ? `<div class="pwa-lead">iPhone: <b>Нажмите «Поделиться» → «На экран Домой»</b></div>${iosSteps}`
    : deferred ? `<button class="btn primary block" data-pwa-install>${ic('phone',16)} Установить «Сутки·Pro Команда»</button><div class="hint">Android / Chrome: появится системное окно «Установить приложение».</div>`
    : `<div class="pwa-lead">${P.isAndroid?'Android':'Телефон или компьютер'}: установка через меню браузера</div>${andSteps}<div class="hint">Если браузер уже предложил установку, кнопка «Установить» появится здесь сама.</div>`;
  const notif = ns==='unsupported'
      ? `<div class="hint" style="margin-top:0">${P.isIOS?'На iPhone уведомления работают только в установленном приложении (iOS 16.4+): сначала «На экран Домой», затем откройте иконку и включите уведомления.':'Этот браузер не поддерживает уведомления.'}</div>`
      : ns==='denied' ? `<div class="hint" style="margin-top:0">Уведомления запрещены в настройках браузера для этого сайта — разрешите их там и обновите страницу.</div>`
      : ns==='granted' ? `<div class="pwa-ok">${ic('check',16,2.6)} Уведомления включены</div><button class="btn sm" data-pwa-test style="margin-top:8px">${ic('bell',14)} Проверить уведомление</button>`
      : `<button class="btn primary block" data-pwa-notif>${ic('bell',16)} Включить уведомления</button>`;
  return `<div class="grab"></div><h3 style="font-size:18px">Приложение на телефоне</h3><div class="muted" style="font-size:13px;margin-bottom:12px">«Сутки·Pro Команда» ставится прямо по ссылке — магазин приложений не нужен</div>
    <div class="sec ${focus==='install'?'pwa-focus':''}"><h4>${ic('phone',16)} Установить на телефон</h4>${install}</div>
    <div class="sec ${focus==='notif'?'pwa-focus':''}"><h4>${ic('bell',16)} Уведомления о новых задачах</h4>${notif}
      ${host.simulate?`<button class="btn block" data-pwa-sim style="margin-top:10px">${ic('plus',16)} Симулировать новую заявку</button>`:''}
      <div class="pwa-note">${ic('alert',14)}<div><b>Демо.</b> Уведомление показывается, пока приложение открыто или свёрнуто в этом браузере (например, когда владелец назначает задачу в соседней вкладке). Чтобы уведомления приходили в <b>закрытое</b> приложение, в рабочей версии нужен сервер (Web Push).</div></div></div>
    <button class="btn block" data-pwa-close>Готово</button>`;
}
P.openSheet = (focus) => {
  const sh = document.getElementById('sheet'); if(!sh) return;
  sh.innerHTML = sheetHTML(focus); sh.dataset.pwa = focus || 'all';
  sh.classList.add('open'); document.getElementById('sheetBg').classList.add('open');
};
P.closeSheet = () => { const sh=document.getElementById('sheet'); if(!sh) return; sh.classList.remove('open'); delete sh.dataset.pwa; document.getElementById('sheetBg').classList.remove('open'); };
P.refresh = () => {
  const slot = document.getElementById('pwaSlot'); if(slot) slot.innerHTML = P.bannerHTML();
  const sh = document.getElementById('sheet'); if(sh && sh.dataset.pwa && sh.classList.contains('open')) sh.innerHTML = sheetHTML(sh.dataset.pwa);
};
P.install = () => {
  if(deferred){ const d = deferred; deferred = null; d.prompt(); (d.userChoice||Promise.resolve({})).then(ch=>{ if(ch && ch.outcome==='accepted') host.toast('Устанавливаем «Сутки·Pro Команда»…'); P.refresh(); }).catch(()=>{}); return; }
  P.openSheet('install');
};
P.enableNotif = () => {
  const s = P.notifState();
  if(s==='unsupported' || s==='denied'){ P.openSheet('notif'); return; }
  if(s==='granted'){ P.refresh(); P.test(); return; }
  Promise.resolve(Notification.requestPermission()).then(res=>{
    P.refresh();
    if(res==='granted'){ host.toast('Уведомления включены'); P.notify('Уведомления включены', 'Сюда будут приходить новые задачи от владельца (демо).', 'cleaning.html', 'welcome'); }
    else host.toast('Без разрешения уведомления не придут — можно включить позже', true);
  }).catch(()=>{});
};
P.test = () => { P.notify('Сутки·Pro Команда', 'Проверка: уведомления работают (демо).', 'cleaning.html', 'test').then(ok=>host.toast(ok?'Отправили тестовое уведомление':'Не удалось показать уведомление', !ok)); };
/* показ уведомления: через service worker (работает и в установленном приложении), иначе — Notification */
P.notify = (title, body, url, tag) => {
  if(P.notifState()!=='granted') return Promise.resolve(false);
  const opts = {body, icon:'icons/icon-192.png', badge:'icons/badge-96.png', tag:tag||('t'+Date.now()), lang:'ru', data:{url:url||'cleaning.html'}};
  const fallback = () => { try { new Notification(title, opts); return true; } catch(e){ return false; } };
  if(!('serviceWorker' in navigator)) return Promise.resolve(fallback());
  return navigator.serviceWorker.getRegistration().then(r=> r && r.showNotification ? r.showNotification(title, opts).then(()=>true) : fallback()).catch(()=>fallback());
};
/* ---------- новые задачи для текущего сотрудника (записи st.notify) ---------- */
const seenKey = () => 'sutkipro.notif.seen.'+host.userId;
P.checkNew = (silent) => {
  if(!host.userId) return 0;
  const st = Store.load(); const seen = +(localStorage.getItem(seenKey())||0);
  const fresh = (st.notify||[]).filter(n=>n.to===host.userId && n.ts>seen);
  if(!fresh.length) return 0;
  localStorage.setItem(seenKey(), String(Math.max(...fresh.map(n=>n.ts))));
  fresh.forEach(n=>{ if(!silent) P.notify(n.title, n.body, n.url, 'n'+n.id); if(host.onNew) host.onNew(n, silent); });
  return fresh.length;
};
P.init = (opts) => {
  host = Object.assign(host, opts||{});
  if(!localStorage.getItem(seenKey())) localStorage.setItem(seenKey(), String(Date.now()));
  const missed = P.checkNew(true); if(missed) host.toast(`Новых задач, пока вас не было: ${missed}`);
  window.addEventListener('storage', e=>{ if(e.key===STORE_KEY) P.checkNew(false); });
};
document.addEventListener('click', e=>{
  const t = e.target;
  if(t.closest('[data-pwa-install]')){ P.install(); return; }
  if(t.closest('[data-pwa-notif]')){ P.enableNotif(); return; }
  if(t.closest('[data-pwa-test]')){ P.test(); return; }
  if(t.closest('[data-pwa-open]')){ P.openSheet('all'); return; }
  if(t.closest('[data-pwa-close]')){ P.closeSheet(); return; }
  if(t.closest('[data-pwa-hide]')){ localStorage.setItem(LS_HIDE,'1'); P.refresh(); host.toast('Скрыто — установить можно через значок колокольчика вверху'); return; }
  if(t.closest('[data-pwa-sim]')){
    if(!host.simulate) return; P.closeSheet();
    host.toast(P.notifState()==='granted' ? 'Через 3 секунды владелец «назначит» новую задачу — можно свернуть приложение' : 'Через 3 секунды придёт новая задача (включите уведомления, чтобы увидеть системное)');
    setTimeout(()=>{ host.simulate(); P.checkNew(false); }, 3000); return;
  }
});
})();
