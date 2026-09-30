/* Сутки·Pro Команда — мобильное приложение команды (демо). Этот файл — роль «Клининг»:
   показывает ТОЛЬКО задачи вошедшего специалиста; без цен, финансов и контактов гостей.
   Роль «Мастер» (ремонты) — в assets/master.js, установка и уведомления — в assets/pwa.js. */
(function(){
'use strict';
const app = document.getElementById('app');
const MIN_PHOTOS = 3;
const USER = Auth.check('team') || Auth.check('panel');

/* ---------- доступ ---------- */
function deny(title, text, buttons){
  document.body.innerHTML = `<div class="deny"><div class="deny-card"><div class="deny-ic">${ic('lock',30)}</div><h1 style="font-size:20px">${title}</h1>
    <p class="muted" style="margin:10px 0 18px;font-size:14px">${text}</p><div class="row" style="justify-content:center;flex-wrap:wrap">${buttons}</div>
    <div style="margin-top:18px"><span class="demo-badge"><i></i>Демо-данные</span></div></div></div>`;
  const lo = document.getElementById('denyLogout'); if(lo) lo.onclick = ()=>{ Auth.logout('panel'); location.href='login.html?role=cleaning'; };
}
if(USER && USER.role==='master') return;   // приложение мастера — assets/master.js
if(!USER){ deny('Сутки·Pro Команда','Приложение команды: специалисты по клинингу видят свои уборки, мастера — свои ремонты. Войдите под своим демо-аккаунтом.', `<a class="btn primary" href="login.html?role=cleaning">${ic('in',16)} Войти</a><a class="btn" href="team.html">Вход для команды</a>`); return; }
if(USER.role!=='cleaner'){ deny('Раздел для команды', `Вы вошли как <b>${esc(USER.short)}</b> (${ROLE_NAME[USER.role].toLowerCase()}). «Сутки·Pro Команда» открывается под аккаунтом специалиста по клинингу или мастера.`, `<a class="btn primary" href="app.html">В панель управления</a><button class="btn" id="denyLogout">${ic('logout',16)} Войти в приложение команды</button>`); return; }

const ME = staffById(USER.id);
applyCleaningOverrides(Store.load());
const V = {tab:'today', open:null, probCat:'Сломано / не работает', probUrgent:true};
const myTasks = () => cleanings.filter(c=>c.cleaner===ME.short && (c.date===TODAY || c.date===TODAY+1)).sort((a,b)=>(a.status==='done')-(b.status==='done') || a.from.localeCompare(b.from));
const FLOW = ['assigned','enroute','progress','done'];
const FLOW_L = {assigned:'Назначена', enroute:'В пути', progress:'Убираю', done:'Готово'};
const FLOW_C = {assigned:'violet', enroute:'blue', progress:'amber', done:'green'};
const PH_LABELS = ['Спальня','Кухня','Ванная','Гостиная','Прихожая','Балкон','Санузел','Постель'];
const PH_HUES = [235,38,190,140,20,95,200,300];
const firstName = s => String(s||'').split(' ')[0];
const WDL = WD_L[wd(TODAY)];

function toast(text, err){ const el=document.createElement('div'); el.className='toast'+(err?' err':''); el.innerHTML=`<span class="t-ic">${ic(err?'alert':'check',13,3)}</span><span>${esc(text)}</span>`; document.getElementById('toasts').appendChild(el); setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),260); },2800); }
function demoPhotoSVG(label,h){ return `<svg viewBox="0 0 80 80" preserveAspectRatio="xMidYMid slice"><rect width="80" height="80" fill="hsl(${h} 60% 86%)"/><rect x="8" y="10" width="26" height="22" rx="2" fill="hsl(${h} 70% 95%)"/><path d="M21 10v22M8 21h26" stroke="hsl(${h} 30% 75%)" stroke-width="1.5"/><rect x="0" y="56" width="80" height="24" fill="hsl(${h} 35% 70%)"/><rect x="38" y="38" width="36" height="22" rx="5" fill="hsl(${(h+180)%360} 40% 55%)"/><circle cx="18" cy="52" r="6" fill="hsl(120 30% 45%)"/></svg>`; }
function photoHTML(p, idx, removable){ return `<div class="ph">${p.src?`<img src="${p.src}" alt="${esc(p.label||'Фото')}">`:demoPhotoSVG(p.label,p.hue||200)}<span>${esc(p.label||'Фото')}${p.demo?' · демо':''}</span>${removable?`<button class="rm" data-rm="${idx}" aria-label="Удалить фото">${ic('x',13,2.5)}</button>`:''}</div>`; }
function urgency(c){
  if(c.status==='done') return `<span class="urg green" style="background:var(--green-50);color:#15803d">${ic('check',12,3)} Готово${c.doneAt?' в '+c.doneAt:''}</span>`;
  if(!c.nextCheckin) return `<span class="urg grey">${ic('clock',12)} Заезда в этот день нет</span>`;
  const urgent = c.nextCheckin <= '16:00';
  return `<span class="urg ${urgent?'red':'amber'}">${ic(urgent?'alert':'clock',12)} ${urgent?'Срочно · ':''}заезд в ${c.nextCheckin}</span>`;
}
const stepsBar = c => `<div class="steps">${FLOW.map((s,i)=>`<i class="${FLOW.indexOf(c.status)>=i?'on':''}"></i>`).join('')}</div>`;

/* ---------- экран списка ---------- */
function renderList(){
  const all = myTasks(); const today = all.filter(c=>c.date===TODAY), tom = all.filter(c=>c.date===TODAY+1);
  const list = V.tab==='today' ? today : tom;
  const doneT = today.filter(c=>c.status==='done').length; const urgentN = today.filter(c=>c.status!=='done' && c.nextCheckin && c.nextCheckin<='16:00').length;
  app.innerHTML = topbar() + `<div class="pad">
    <div class="day"><h1>${WDL[0].toUpperCase()+WDL.slice(1)}, ${dd(TODAY)} ${MON_G[mm(TODAY)]}</h1>
      <p>${today.length ? `${today.length} ${plural(today.length,'уборка','уборки','уборок')} сегодня · готово ${doneT}${urgentN?` · срочных ${urgentN}`:''}` : 'Сегодня уборок нет'}</p>
      <div class="bar"><i style="width:${today.length?Math.round(doneT/today.length*100):0}%"></i></div></div>
    <div id="pwaSlot">${window.PWA?PWA.bannerHTML():''}</div>
    <div class="tabs"><button class="${V.tab==='today'?'active':''}" data-tab="today">Сегодня<span class="n">${today.length}</span></button><button class="${V.tab==='tomorrow'?'active':''}" data-tab="tomorrow">Завтра<span class="n">${tom.length}</span></button></div>
    ${list.length ? list.map(c=>{ const a=aptById(c.aptId); return `<button class="task ${c.status==='done'?'done':''} ${c.sim&&c.status==='assigned'?'fresh-t':''}" data-open="${c.id}">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><span class="chip ${FLOW_C[c.status]}">${FLOW_L[c.status]}</span>${urgency(c)}</div>
      <h3>Кв. ${a.num} · ${esc(a.complex)}</h3><div class="addr">${esc(a.address)}</div>
      <div class="tmeta"><span>${ic('clock',14)} ${c.from}–${c.to}</span><span>${ic('home',14)} ${a.rooms}</span><span>${ic('list',14)} ${c.checked.filter(Boolean).length}/${CHECKLIST.length}</span>${c.photos&&c.photos.length?`<span>${ic('camera',14)} ${c.photos.length}</span>`:''}</div>
      ${stepsBar(c)}</button>`; }).join('') : `<div class="empty">${ic('sparkle',26)}<div style="margin-top:8px;font-weight:600;color:var(--text)">${V.tab==='today'?'На сегодня задач нет':'На завтра задач пока нет'}</div><div style="font-size:13px;margin-top:4px">Новые уборки появятся автоматически после выезда гостей</div></div>`}
    <button class="btn block" data-pwa-sim style="margin-top:4px">${ic('plus',16)} Симулировать новую заявку</button>
    <div class="demo-foot" style="padding:12px 0 0">Демо-данные · видны только ваши задачи · сегодня в демо — 30 сентября 2026</div>
  </div>`;
}
function topbar(){
  return `<header class="top"><span class="avatar">${initials(ME.name)}</span><div class="who"><b>${esc(ME.short)}</b><small><i></i>Команда · Клининг</small></div>
    <div class="right"><span class="demo-badge sm"><i></i>Демо-данные</span><button class="icon-btn" data-pwa-open title="Приложение и уведомления" aria-label="Приложение и уведомления">${ic('bell',18)}</button><button class="icon-btn" data-logout title="Выйти" aria-label="Выйти">${ic('logout',18)}</button></div></header>`;
}

/* ---------- экран задачи ---------- */
function renderTask(){
  const c = cleanings.find(x=>x.id===V.open); if(!c || c.cleaner!==ME.short){ V.open=null; renderList(); return; }
  const a = aptById(c.aptId), b = bById(c.bookingId), door = aptDoor(a); const si = FLOW.indexOf(c.status);
  const isTomorrow = c.date>TODAY; const done = c.status==='done'; const photos = c.photos || (done ? ROOMS_PH.map(([l,h])=>({demo:true,label:l,hue:h})) : []);
  const probs = (Store.load().problems||[]).filter(p=>p.cleaningId===c.id);
  const canCheck = c.status==='progress';
  let cta='';
  if(isTomorrow && !done) cta = `<button class="btn" disabled>${ic('calendar',18)} Задача на завтра — начать можно ${fD(c.date)}</button>`;
  else if(c.status==='assigned') cta = `<button class="btn primary" data-next>${ic('nav',18)} Я в пути</button>`;
  else if(c.status==='enroute') cta = `<button class="btn primary" data-next>${ic('play',18)} Начать уборку</button>`;
  else if(c.status==='progress') cta = `<button class="btn success" data-report>${ic('send',18)} Отправить отчёт</button>`;
  else cta = `<button class="btn" disabled style="color:var(--green)">${ic('check',18,2.6)} Отчёт отправлен${c.doneAt?' в '+c.doneAt:''}</button>`;
  app.innerHTML = topbar() + `<div class="dhead"><button class="icon-btn" data-back aria-label="Назад">${ic('chevL',18)}</button><div class="grow"><b>Кв. ${a.num} · ${esc(a.complex)}</b><div class="muted" style="font-size:12px">${relDay(c.date)} · ${c.from}–${c.to}</div></div><span class="chip ${FLOW_C[c.status]}">${FLOW_L[c.status]}</span></div>
  <div class="pad">
    <div class="sec"><div class="flow">${FLOW.map((s,i)=>`<div class="${si>=i?'on':''} ${si===i?'cur':''}"><i>${si>i?ic('check',13,3):i+1}</i>${FLOW_L[s]}</div>`).join('')}</div></div>
    <div class="sec"><h4>${ic('pin',16)} Адрес и доступ</h4>
      <div style="font-weight:600">${esc(a.address)}</div><div class="muted" style="font-size:13px;margin-bottom:10px">${a.district} р-н · ${a.rooms}</div>
      <div class="door"><div><small>Подъезд / этаж</small><b>${door.entrance} / ${door.floor}</b></div><div><small>Домофон</small><b>${door.intercom}</b></div><div><small>Сейф для ключей</small><b>${door.keybox}</b></div><div><small>Wi‑Fi</small><b>${door.wifi}</b></div></div>
      <button class="btn sm" style="margin-top:10px" data-maps>${ic('nav',14)} Маршрут (демо)</button></div>
    <div class="sec"><h4>${ic('clock',16)} Время</h4><div class="info">
      <div><small>Окно уборки</small><b>${c.from}–${c.to}</b></div>
      <div><small>Выезд гостя</small><b>${b?b.checkoutTime:c.from}</b><div class="muted" style="font-size:12px">${b?esc(firstName(b.guest)):''}</div></div>
      <div style="grid-column:span 2;${c.nextCheckin&&c.nextCheckin<='16:00'&&!done?'background:#fee2e2':''}"><small>Следующий заезд</small><b>${c.nextCheckin?`${relDay(c.date)} в ${c.nextCheckin}`:'Сегодня заезда нет'}</b>${c.nextGuest?`<div class="muted" style="font-size:12px">Гость: ${esc(firstName(c.nextGuest))}${c.nextCheckin<='16:00'&&!done?' · успеть до заезда!':''}</div>`:''}</div></div></div>
    <div class="sec"><h4>${ic('list',16)} Чек-лист <span class="muted" style="margin-left:auto;font-weight:600">${c.checked.filter(Boolean).length}/${CHECKLIST.length}</span></h4>
      ${canCheck||done?'':`<div class="hint" style="margin:-4px 0 6px">Отмечать пункты можно после «Начать уборку»</div>`}
      <ul class="cl ${canCheck?'':'ro'}">${CHECKLIST.map((t,k)=>`<li class="${c.checked[k]?'on':''}" ${canCheck?`data-check="${k}"`:''}><span class="cb">${ic('check',14,3)}</span>${t}</li>`).join('')}</ul>
      ${canCheck?`<button class="btn sm" style="margin-top:8px" data-checkall>${ic('check',14)} Отметить всё</button>`:''}</div>
    <div class="sec"><h4>${ic('camera',16)} Фотоотчёт <span class="muted" style="margin-left:auto;font-weight:600">${photos.length} фото</span></h4>
      ${done?'':`<div class="cam"><label class="btn primary" for="camInput">${ic('camera',16)} Сделать фото<input type="file" id="camInput" accept="image/*" capture="environment" multiple></label><button class="btn" data-demo-photos>${ic('image',16)} +3 демо-фото</button></div>
      <div class="hint">На телефоне откроется камера. Минимум ${MIN_PHOTOS} фото: спальня, кухня, санузел.</div>`}
      ${photos.length?`<div class="ph-grid">${photos.map((p,i)=>photoHTML(p,i,!done)).join('')}</div>`:(done?'<div class="hint">Фото не приложены</div>':'')}</div>
    <div class="sec"><h4>${ic('msg',16)} Комментарий</h4>
      ${done?`<div style="font-size:14px">${c.comment?esc(c.comment):'<span class="muted">Без комментария</span>'}</div>`:`<textarea class="input" id="comment" placeholder="Например: гости оставили вещи, передала администратору">${esc(c.comment||'')}</textarea>`}
      <button class="btn danger block" style="margin-top:10px" data-problem>${ic('alert',16)} Сообщить о проблеме</button>
      ${probs.map(p=>`<div class="prob">${ic('flag',15)}<div><b>${esc(p.title)}</b><div style="font-size:12px">Отправлено владельцу в ${p.time} · появится в «Ремонтах»</div></div></div>`).join('')}</div>
    <div class="errbox" id="errbox"></div>
  </div>
  <div class="cta">${cta}</div>`;
}

function render(){ if(V.open) renderTask(); else renderList(); }
function curTask(){ return cleanings.find(x=>x.id===V.open); }
function saveComment(c){ const el=document.getElementById('comment'); if(el) c.comment = el.value.trim(); }

/* ---------- фото: сжимаем до миниатюры, чтобы поместилось в localStorage ---------- */
function fileToThumb(file){
  return new Promise((res)=>{
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => { const M=360; const k=Math.min(1, M/Math.max(img.width,img.height)); const cv=document.createElement('canvas'); cv.width=Math.round(img.width*k); cv.height=Math.round(img.height*k); cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); try{ res(cv.toDataURL('image/jpeg',.6)); }catch(e){ res(null); } }; img.onerror=()=>res(null); img.src=fr.result; };
    fr.onerror = () => res(null); fr.readAsDataURL(file);
  });
}
async function addFiles(files){
  const c=curTask(); if(!c) return; saveComment(c); c.photos = c.photos||[]; let added=0;
  for(const f of Array.from(files||[])){ if(!/^image\//.test(f.type)) continue; const src = await fileToThumb(f); if(src){ c.photos.push({src, label:PH_LABELS[c.photos.length%PH_LABELS.length]}); added++; } }
  const r = saveCleaning(c); if(r.ok==='trimmed') toast('Места в браузере мало — сохранили только количество фото', true);
  renderTask(); if(added) toast(`Добавлено фото: ${added}`); else toast('Не удалось прочитать изображение', true);
}

/* ---------- проблема ---------- */
const PROB_CATS = ['Сломано / не работает','Нет расходников','Протечка','Повреждение от гостей','Грязно / сильный беспорядок','Другое'];
function openProblem(){
  const c=curTask(); const a=aptById(c.aptId);
  document.getElementById('sheet').innerHTML = `<div class="grab"></div><h3 style="font-size:18px">Сообщить о проблеме</h3><div class="muted" style="font-size:13px">Кв. ${a.num} · владелец увидит это в разделе «Ремонты»</div>
    <div class="opts">${PROB_CATS.map(k=>`<button class="opt ${V.probCat===k?'on':''}" data-cat="${k}">${k}</button>`).join('')}</div>
    <div class="field"><label for="probText">Что случилось?</label><input class="input" id="probText" placeholder="Например: не работает фен, сломана ножка стула"></div>
    <label class="tgl"><input type="checkbox" id="probUrg" ${V.probUrgent?'checked':''}> Срочно — мешает заселению</label>
    <div class="errbox" id="probErr"></div>
    <div class="row"><button class="btn grow" data-sheet-close>Отмена</button><button class="btn primary grow" data-prob-send>${ic('send',16)} Отправить</button></div>`;
  document.getElementById('sheet').classList.add('open'); document.getElementById('sheetBg').classList.add('open');
  setTimeout(()=>{ const i=document.getElementById('probText'); if(i) i.focus(); }, 250);
}
function closeSheet(){ const sh=document.getElementById('sheet'); sh.classList.remove('open'); delete sh.dataset.pwa; document.getElementById('sheetBg').classList.remove('open'); }
function sendProblem(){
  const c=curTask(); const a=aptById(c.aptId); const txt=document.getElementById('probText').value.trim(); const urg=document.getElementById('probUrg').checked;
  if(txt.length<3 && V.probCat==='Другое'){ const e=document.getElementById('probErr'); e.textContent='Опишите проблему в паре слов'; e.classList.add('show'); return; }
  const title = txt ? (txt.charAt(0).toUpperCase()+txt.slice(1)) : V.probCat;
  saveComment(c);
  Store.update(st=>{ const id=5000 + (++st.seq); st.problems.push({id, cleaningId:c.id, aptId:a.id, title, category:V.probCat, priority: urg?'high':'medium', by:ME.short, time:nowHM(), photos:(c.photos||[]).length});
    logActivity(st, ME.short, `${ME.short} ${verb(ME,'сообщил','сообщила')} о проблеме: кв. ${a.num} — ${title}`, 'problem'); });
  closeSheet(); renderTask(); toast('Отправлено владельцу — появится в «Ремонтах»');
}

/* ---------- смена статуса и отчёт ---------- */
function nextStatus(){
  const c=curTask(); const a=aptById(c.aptId); saveComment(c); const t=nowHM();
  if(c.status==='assigned'){ c.status='enroute'; c.enrouteAt=t; saveCleaning(c); Store.update(st=>logActivity(st, ME.short, `${ME.short} в пути на кв. ${a.num}`, 'enroute')); toast('Статус: в пути. Код двери — в карточке'); }
  else if(c.status==='enroute'){ c.status='progress'; c.startedAt=t; saveCleaning(c); Store.update(st=>logActivity(st, ME.short, `${ME.short} ${verb(ME,'начал','начала')} уборку кв. ${a.num}`, 'start')); toast('Уборка начата — отмечайте чек-лист'); }
  renderTask(); window.scrollTo(0,0);
}
function sendReport(){
  const c=curTask(); const a=aptById(c.aptId); saveComment(c);
  const miss=[]; const left=c.checked.filter(x=>!x).length; const ph=(c.photos||[]).length;
  if(left) miss.push(`отметьте ещё ${left} ${plural(left,'пункт','пункта','пунктов')} чек-листа`);
  if(ph<MIN_PHOTOS) miss.push(`добавьте ещё ${MIN_PHOTOS-ph} фото (сейчас ${ph})`);
  const eb=document.getElementById('errbox');
  if(miss.length){ eb.innerHTML = `<b>Чтобы отправить отчёт:</b> ${miss.join('; ')}.`; eb.classList.add('show'); eb.scrollIntoView({behavior:'smooth',block:'center'}); return; }
  c.status='done'; c.doneAt=nowHM();
  const r = saveCleaning(c, {by:ME.short, reportAt:Date.now()});
  Store.update(st=>logActivity(st, ME.short, `${ME.short} ${verb(ME,'завершил','завершила')} уборку кв. ${a.num} — ${ph} фото`, 'done'));
  const ov=document.getElementById('doneOv');
  ov.innerHTML = `<div><div class="okc">${ic('check',42,3)}</div><h2 style="font-size:22px">Отчёт отправлен!</h2><p class="muted" style="margin:8px 0 18px">Кв. ${a.num}: ${CHECKLIST.length}/${CHECKLIST.length} пунктов, ${ph} фото${c.comment?', с комментарием':''}.<br>Владелец уже видит его в разделе «Уборки».</p>
    ${r.ok==='trimmed'?'<p class="muted" style="font-size:12px">Фото сохранены без миниатюр — в браузере мало места (демо).</p>':''}<button class="btn primary lg" data-ov-close>К моим задачам</button></div>`;
  ov.classList.add('open');
}

/* ---------- события ---------- */
document.addEventListener('click', e=>{
  const t=e.target;
  if(t.closest('[data-logout]')){ Auth.logout('team'); location.href='login.html?role=cleaning'; return; }
  const tb=t.closest('[data-tab]'); if(tb){ V.tab=tb.dataset.tab; renderList(); return; }
  const op=t.closest('[data-open]'); if(op){ V.open=+op.dataset.open; renderTask(); window.scrollTo(0,0); return; }
  if(t.closest('[data-back]')){ const c=curTask(); if(c && c.status!=='done'){ saveComment(c); saveCleaning(c); } V.open=null; if(location.hash) history.replaceState(null,'',location.pathname+location.search); renderList(); window.scrollTo(0,0); return; }
  const ck=t.closest('[data-check]'); if(ck){ const c=curTask(); const k=+ck.dataset.check; saveComment(c); c.checked[k]=!c.checked[k]; saveCleaning(c); renderTask(); return; }
  if(t.closest('[data-checkall]')){ const c=curTask(); saveComment(c); c.checked=c.checked.map(()=>true); saveCleaning(c); renderTask(); return; }
  if(t.closest('[data-demo-photos]')){ const c=curTask(); saveComment(c); c.photos=c.photos||[]; for(let i=0;i<3;i++){ const n=c.photos.length; c.photos.push({demo:true, label:PH_LABELS[n%PH_LABELS.length], hue:PH_HUES[n%PH_HUES.length]}); } saveCleaning(c); renderTask(); toast('Добавлено 3 демо-фото'); return; }
  const rm=t.closest('[data-rm]'); if(rm){ const c=curTask(); saveComment(c); c.photos.splice(+rm.dataset.rm,1); saveCleaning(c); renderTask(); return; }
  if(t.closest('[data-maps]')){ toast('Демо: здесь откроется 2ГИС / Яндекс Карты с маршрутом'); return; }
  if(t.closest('[data-next]')){ nextStatus(); return; }
  if(t.closest('[data-report]')){ sendReport(); return; }
  if(t.closest('[data-problem]')){ openProblem(); return; }
  const cat=t.closest('[data-cat]'); if(cat){ V.probCat=cat.dataset.cat; document.querySelectorAll('[data-cat]').forEach(b=>b.classList.toggle('on', b.dataset.cat===V.probCat)); return; }
  if(t.closest('[data-prob-send]')){ sendProblem(); return; }
  if(t.closest('[data-sheet-close]') || t.id==='sheetBg'){ closeSheet(); return; }
  if(t.closest('[data-ov-close]')){ document.getElementById('doneOv').classList.remove('open'); V.open=null; renderList(); window.scrollTo(0,0); return; }
});
document.addEventListener('change', e=>{ if(e.target.id==='camInput'){ addFiles(e.target.files); e.target.value=''; } if(e.target.id==='probUrg') V.probUrgent=e.target.checked; });
window.addEventListener('storage', e=>{
  if(e.key===TEAM_KEY){ const u=Auth.current('team'); if(!u||u.id!==USER.id) location.reload(); return; }
  if(e.key===STORE_KEY){ const st=Store.load(); if(st.access && st.access[USER.id]===false){ location.reload(); return; } applyCleaningOverrides(st); if(!document.getElementById('comment') || document.activeElement!==document.getElementById('comment')) render(); }
});
/* новая уборка «от владельца» — для демонстрации уведомлений */
function simulate(){
  let made; const busy = new Set(myTasks().filter(c=>c.date===TODAY).map(c=>c.aptId));
  Store.update(st=>{ const n = ++st.seq; let k = (n*5) % apartments.length; while(busy.has(apartments[k].id)) k = (k+1) % apartments.length; const a = apartments[k];
    made = {id:30000+n, bookingId:null, aptId:a.id, date:TODAY, cleaner:ME.short, from:'15:30', to:'18:30', nextGuest:null, nextCheckin:'19:00', status:'assigned', checked:CHECKLIST.map(()=>false), sim:true};
    st.cleanAdded.push(made);
    pushNotify(st, ME.id, `Новая уборка · кв. ${a.num}`, `${a.complex}, сегодня 15:30–18:30 · заезд в 19:00`, 'cleaning.html#task=c'+made.id);
    logActivity(st, 'Азамат', `Азамат назначил уборку кв. ${a.num} — ${ME.short} (демо)`, 'assign'); });
  return made;
}
function openFromHash(){ const m = /task=c(\d+)/.exec(location.hash); if(m){ const id=+m[1]; if(myTasks().some(c=>c.id===id)){ V.open=id; V.tab='today'; renderTask(); window.scrollTo(0,0); } } }
window.addEventListener('hashchange', openFromHash);
render(); openFromHash();
if(window.PWA) PWA.init({userId:ME.id, toast, simulate:()=>{ simulate(); applyCleaningOverrides(Store.load()); if(!V.open){ V.tab='today'; renderList(); } },
  onNew:(n, silent)=>{ applyCleaningOverrides(Store.load()); if(!V.open) renderList(); if(!silent) toast(n.title+': '+n.body); }});
window.__cleaner = {V, myTasks, simulate};
})();
