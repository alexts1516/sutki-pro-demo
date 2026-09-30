/* Сутки·Pro Команда — приложение мастера (сантехник, электрик), демо.
   Показывает ТОЛЬКО ремонты, назначенные вошедшему мастеру: проблема, адрес и код двери, фото до/после,
   статус, запчасти и стоимость, отчёт владельцу. Без финансов квартиры и контактов гостей. */
(function(){
'use strict';
const USER = Auth.check('team') || Auth.check('panel');
if(!USER || USER.role!=='master') return;           // клининг и отказ в доступе — в cleaning.js
const app = document.getElementById('app');
const ME = staffById(USER.id);
document.title = 'Сутки·Pro Команда — мои ремонты (демо)';
document.body.classList.add('is-master');
syncRepairs(Store.load());
const V = {tab:'active', open:null};
const ST_C = {assigned:'violet', enroute:'blue', progress:'amber', done:'green'};
const ST_L = {assigned:'Назначена', enroute:'В пути', progress:'В работе', done:'Готово'};
const PR = {high:['red','alert','Срочно'], medium:['amber','clock','Средний'], low:['grey','clock','Не срочно']};
const PR_N = {high:0, medium:1, low:2};
const WDL = WD_L[wd(TODAY)];
const mine = () => repairs.filter(r=>r.masterId===ME.id).sort((a,b)=>(a.stage==='done')-(b.stage==='done') || (a.stage==='done' ? (b.date-a.date) : (a.date-b.date)) || PR_N[a.priority]-PR_N[b.priority] || b.id-a.id);
const cur = () => repairs.find(r=>r.id===V.open);
const num = v => { const n = parseInt(String(v==null?'':v).replace(/\D/g,''),10); return isNaN(n) ? null : n; };

function toast(text, err){ const el=document.createElement('div'); el.className='toast'+(err?' err':''); el.innerHTML=`<span class="t-ic">${ic(err?'alert':'check',13,3)}</span><span>${esc(text)}</span>`; document.getElementById('toasts').appendChild(el); setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),260); },3200); }
function demoPhotoSVG(h, after){ return `<svg viewBox="0 0 80 80" preserveAspectRatio="xMidYMid slice"><rect width="80" height="80" fill="hsl(${h} 45% 86%)"/><rect x="0" y="0" width="80" height="44" fill="hsl(${h} 25% 93%)"/><path d="M10 30h34v10H10z" fill="hsl(210 10% 70%)"/><path d="M44 26h8v34h-8z" fill="hsl(210 10% 62%)"/><circle cx="48" cy="62" r="7" fill="hsl(210 10% 55%)"/>${after?'<circle cx="64" cy="18" r="10" fill="#16a34a"/><path d="m59 18 4 4 7-8" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>':'<path d="M30 42c0 4-3 7-3 9a3 3 0 0 0 6 0c0-2-3-5-3-9z" fill="#0ea5e9"/><path d="M60 12l6 10H54z" fill="#f59e0b"/>'}</svg>`; }
function photoHTML(p, kind, idx, removable){ return `<div class="ph">${p.src?`<img src="${p.src}" alt="${esc(p.label||'Фото')}">`:demoPhotoSVG(p.hue||200, kind==='after')}<span>${esc(p.label||'Фото')}${p.demo?' · демо':''}</span>${removable?`<button class="rm" data-rm="${kind}:${idx}" aria-label="Удалить фото">${ic('x',13,2.5)}</button>`:''}</div>`; }
const prioChip = r => r.stage==='done' ? `<span class="urg grey">${ic('check',12,2.6)} Выполнено${r.doneAt?' в '+r.doneAt:''}</span>` : `<span class="urg ${PR[r.priority][0]}">${ic(PR[r.priority][1],12)} ${PR[r.priority][2]}</span>`;
const stepsBar = r => `<div class="steps">${REP_STAGE.map((s,i)=>`<i class="${REP_STAGE.indexOf(r.stage)>=i?'on':''}"></i>`).join('')}</div>`;
const srcLine = r => r.source==='Клининг' ? `От клининга: ${esc(r.reporter||'')}${r.photos?` · ${r.photos} фото`:''}` : r.source==='Голос' ? 'Владелец, голосом' : r.sim ? 'Владелец · новая заявка (демо)' : 'Владелец';

function topbar(){
  return `<header class="top"><span class="avatar" style="background:linear-gradient(135deg,#fb923c,#c2410c)">${initials(ME.name)}</span><div class="who"><b>${esc(ME.short)}</b><small><i></i>${ME.spec&&ME.spec!=='Мастер'?'Мастер-'+esc(ME.spec.toLowerCase()):'Мастер'}</small></div>
    <div class="right"><span class="demo-badge sm"><i></i>Демо-данные</span><button class="icon-btn" data-pwa-open title="Приложение и уведомления" aria-label="Приложение и уведомления">${ic('bell',18)}</button><button class="icon-btn" data-logout title="Выйти" aria-label="Выйти">${ic('logout',18)}</button></div></header>`;
}
function renderList(){
  const all = mine(); const act = all.filter(r=>r.stage!=='done'), done = all.filter(r=>r.stage==='done');
  const list = V.tab==='active' ? act : done; const todayN = act.filter(r=>r.date<=TODAY).length, urgent = act.filter(r=>r.priority==='high').length;
  app.innerHTML = topbar() + `<div class="pad">
    <div class="day master"><h1>${WDL[0].toUpperCase()+WDL.slice(1)}, ${dd(TODAY)} ${MON_G[mm(TODAY)]}</h1>
      <p>${act.length ? `${act.length} ${plural(act.length,'активный ремонт','активных ремонта','активных ремонтов')} · на сегодня ${todayN}${urgent?` · срочных ${urgent}`:''}` : 'Активных ремонтов нет'}</p>
      <div class="bar"><i style="width:${all.length?Math.round(done.length/all.length*100):0}%"></i></div></div>
    <div id="pwaSlot">${window.PWA?PWA.bannerHTML():''}</div>
    <div class="tabs"><button class="${V.tab==='active'?'active':''}" data-tab="active">Активные<span class="n">${act.length}</span></button><button class="${V.tab==='done'?'active':''}" data-tab="done">Выполненные<span class="n">${done.length}</span></button></div>
    ${list.length ? list.map(r=>{ const a=aptById(r.aptId); const ph=(r.before||[]).length+(r.after||[]).length; return `<button class="task ${r.stage==='done'?'done':''} ${r.sim&&r.stage==='assigned'?'fresh-t':''}" data-open="${r.id}">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><span class="chip ${ST_C[r.stage]}">${ST_L[r.stage]}</span>${prioChip(r)}</div>
      <h3>${esc(r.title)}</h3><div class="addr">Кв. ${a.num} · ${esc(a.complex)} · ${esc(a.address)}</div>
      <div class="tmeta"><span>${ic('calendar',14)} ${relDay(r.date)}</span><span>${ic(r.source==='Клининг'?'flag':'user',14)} ${srcLine(r)}</span>${ph?`<span>${ic('camera',14)} ${ph}</span>`:''}${r.stage==='done'&&r.cost?`<span>${ic('wallet',14)} ${money(r.cost)}</span>`:''}</div>
      ${stepsBar(r)}</button>`; }).join('') : `<div class="empty">${ic('wrench',26)}<div style="margin-top:8px;font-weight:600;color:var(--text)">${V.tab==='active'?'Активных ремонтов нет':'Выполненных пока нет'}</div><div style="font-size:13px;margin-top:4px">Новые задачи появятся, когда владелец назначит ремонт</div></div>`}
    <button class="btn block" data-pwa-sim style="margin-top:4px">${ic('plus',16)} Симулировать новую заявку</button>
    <div class="demo-foot" style="padding:12px 0 0">Демо-данные · видны только ремонты, назначенные вам · сегодня в демо — 30 сентября 2026</div>
  </div>`;
}
/* доступ в квартиру: код сейфа виден только пока задача активна и только при доступе «по коду» */
function accessBlock(r, door, done){ const x = r.access || {mode:'code'};
  const base = `<div><small>Подъезд / этаж</small><b>${door.entrance} / ${door.floor}</b></div><div><small>Домофон</small><b>${door.intercom}</b></div>`;
  if(x.mode==='keys') return `<div class="door">${base}</div><div class="acc-m">${ic('user',16)}<div><b>Ключи у администратора</b><div>${esc(x.whoName||'Алина')} · ${esc((staffById(x.who||'admin')||{}).phone||'')} — заберите ключи перед выездом и верните после.</div></div></div>`;
  if(x.mode==='presence') return `<div class="door">${base}</div><div class="acc-m pr">${ic('users',16)}<div><b>Вас встретит: ${esc(x.whoName||'администратор')}${x.time?' в '+x.time:''}</b><div>Сложная задача — в квартире будет наш человек. Предупредите, если задерживаетесь.</div></div></div>`;
  return `<div class="door">${base}<div><small>Сейф для ключей</small><b>${done?'<span class="muted" style="font-weight:500;font-size:12.5px">скрыт — задача закрыта</span>':door.keybox}</b></div><div><small>Wi‑Fi</small><b>${door.wifi}</b></div></div>`;
}
/* смета: мастер отправляет стоимость работ и запчастей, владелец согласует */
function quoteBlock(r, done){ const q = r.quote; if(done) return '';
  if(q && q.status==='pending') return `<div class="q-st pend">${ic('clock',16)}<div><b>Смета ${money(quoteTotal(q))} отправлена${q.at?' · '+esc(q.at):''}</b><div>Ждёт согласования владельца. Можно начинать диагностику.</div></div></div>`;
  if(q && q.status==='approved') return `<div class="q-st ok">${ic('check',16,2.6)}<div><b>Смета согласована: ${money(quoteTotal(q))}</b><div>Работа ${money(q.work||0)} + запчасти ${money(q.parts||0)}. Итог по факту — в отчёте ниже.</div></div></div>`;
  return `${q && q.status==='rejected'?`<div class="q-st no">${ic('alert',16)}<div><b>Смета отклонена${q.note?': '+esc(q.note):''}</b><div>Пришлите новую смету.</div></div></div>`:'<div class="hint" style="margin:0 0 10px">Оцените работу до начала — владелец согласует сумму в панели.</div>'}
    <div class="cost-grid"><div class="field"><label for="qWork">Стоимость работ, ₸</label><input class="input" id="qWork" inputmode="numeric" placeholder="0"></div><div class="field"><label for="qParts">Запчасти, ₸</label><input class="input" id="qParts" inputmode="numeric" placeholder="0"></div></div>
    <div class="field"><label for="qList">Что понадобится</label><input class="input" id="qList" placeholder="Например: арматура для бачка, прокладки"></div>
    <button class="btn primary block" data-quote>${ic('send',16)} Отправить смету на согласование</button>`;
}
function sendQuote(){ const r = cur(); const a = aptById(r.aptId); const g = id => document.getElementById(id);
  const work = num(g('qWork').value), parts = num(g('qParts').value);
  if(work==null && parts==null){ toast('Укажите стоимость работ и/или запчастей', true); g('qWork').focus(); return; }
  const q = {work:work||0, parts:parts||0, list:g('qList').value.trim(), by:ME.short, at:'Сегодня, '+nowHM(), status:'pending'};
  saveRepair(r, {quote:q}); Store.update(st=>logActivity(st, ME.short, `${ME.short} ${verb(ME,'отправил','отправила')} смету: кв. ${a.num} — ${r.title}, ${money(quoteTotal(q))}`, 'info'));
  toast('Смета отправлена владельцу на согласование'); renderTask(); }
function renderTask(){
  const r = cur(); if(!r || r.masterId!==ME.id){ V.open=null; renderList(); return; }
  const a = aptById(r.aptId), door = aptDoor(a), si = REP_STAGE.indexOf(r.stage), done = r.stage==='done';
  const before = r.before || [], after = r.after || [];
  const canAfter = r.stage==='progress';
  const aq = r.quote && r.quote.status==='approved' ? r.quote : null; const pc = r.partsCost!=null ? r.partsCost : (aq ? aq.parts : ''), wc = r.workCost!=null ? r.workCost : (aq ? aq.work : '');
  let cta;
  if(r.stage==='assigned') cta = `<button class="btn primary" data-next>${ic('nav',18)} Я в пути</button>`;
  else if(r.stage==='enroute') cta = `<button class="btn primary" data-next>${ic('play',18)} Начать работу</button>`;
  else if(r.stage==='progress') cta = `<button class="btn success" data-report>${ic('send',18)} Отправить отчёт</button>`;
  else cta = `<button class="btn" disabled style="color:var(--green)">${ic('check',18,2.6)} Отчёт отправлен${r.doneAt?' в '+r.doneAt:''}</button>`;
  const camBlock = (kind, enabled, hint) => done ? '' : enabled ? `<div class="cam"><label class="btn ${kind==='before'?'primary':'success'}" for="cam-${kind}">${ic('camera',16)} Сфотографировать<input type="file" id="cam-${kind}" data-cam="${kind}" accept="image/*" capture="environment" multiple></label><button class="btn" data-demo-photos="${kind}">${ic('image',16)} +2 демо-фото</button></div><div class="hint">${hint}</div>` : `<div class="hint">${hint}</div>`;
  app.innerHTML = topbar() + `<div class="dhead"><button class="icon-btn" data-back aria-label="Назад">${ic('chevL',18)}</button><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">Кв. ${a.num} · ${esc(r.title)}</b><div class="muted" style="font-size:12px">${relDay(r.date)} · ${esc(a.complex)}</div></div><span class="chip ${ST_C[r.stage]}">${ST_L[r.stage]}</span></div>
  <div class="pad">
    <div class="sec"><div class="flow">${REP_STAGE.map((s,i)=>`<div class="${si>=i?'on':''} ${si===i?'cur':''}"><i>${si>i?ic('check',13,3):i+1}</i>${ST_L[s]}</div>`).join('')}</div></div>
    <div class="sec"><h4>${ic('wrench',16)} Что случилось</h4>
      <div style="font-weight:700;font-size:16px">${esc(r.title)}</div>
      ${r.desc?`<p style="margin:6px 0 0;font-size:14px;color:var(--text2)">${esc(r.desc)}</p>`:''}
      <div class="info" style="margin-top:12px"><div><small>Срочность</small><b style="color:${r.priority==='high'?'#b91c1c':'inherit'}">${PR[r.priority][2]}</b></div><div><small>Когда</small><b>${relDay(r.date)}${r.window?', '+r.window:''}</b></div>
        <div style="grid-column:span 2"><small>Кто сообщил</small><b style="font-size:13.5px">${srcLine(r)}</b></div></div>
      ${(r.ownerPhotos||[]).length?`<div style="font-size:12.5px;font-weight:700;color:var(--text2);margin:12px 0 6px">Фото от владельца · ${r.ownerPhotos.length}</div><div class="ph-grid">${r.ownerPhotos.map((p,i)=>photoHTML(p,'before',i,false)).join('')}</div>`:''}</div>
    <div class="sec"><h4>${ic('pin',16)} Адрес и доступ</h4>
      <div style="font-weight:600">${esc(a.address)}</div><div class="muted" style="font-size:13px;margin-bottom:10px">${esc(a.complex)} · ${a.district} р-н · ${a.rooms}</div>
      ${accessBlock(r, door, done)}
      <button class="btn sm" style="margin-top:10px" data-maps>${ic('nav',14)} Маршрут (демо)</button></div>
    <div class="sec"><h4>${ic('camera',16)} Фото до <span class="muted" style="margin-left:auto;font-weight:600">${before.length}</span></h4>
      ${camBlock('before', true, 'Снимите проблему до начала работы — владелец увидит, что было.')}
      ${before.length?`<div class="ph-grid">${before.map((p,i)=>photoHTML(p,'before',i,!done)).join('')}</div>`:(done?'<div class="hint">Фото не приложены</div>':'')}</div>
    <div class="sec"><h4>${ic('camera',16)} Фото после <span class="muted" style="margin-left:auto;font-weight:600">${after.length}</span></h4>
      ${camBlock('after', canAfter, canAfter?'Снимите результат: всё работает, место убрано.':'Станет доступно после «Начать работу».')}
      ${after.length?`<div class="ph-grid">${after.map((p,i)=>photoHTML(p,'after',i,!done)).join('')}</div>`:(done?'<div class="hint">Фото не приложены</div>':'')}</div>
    ${done?'':`<div class="sec"><h4>${ic('wallet',16)} Смета</h4>${quoteBlock(r, done)}</div>`}
    <div class="sec"><h4>${ic('wallet',16)} ${done?'Запчасти и стоимость':'Итог по факту'}</h4>
      ${done?`<div style="font-size:14px">${r.parts?esc(r.parts):'<span class="muted">Без запчастей</span>'}</div><div class="cost-sum"><span>Запчасти</span><b>${money(r.partsCost||0)}</b></div><div class="cost-sum"><span>Работа</span><b>${money(r.workCost||0)}</b></div><div class="cost-sum tot"><span>Итого</span><b>${money(r.cost||0)}</b></div>`:`
      <div class="field"><label for="parts">Что купили / заменили</label><input class="input" id="parts" value="${esc(r.parts||'')}" placeholder="Например: арматура для бачка, 2 прокладки"></div>
      <div class="cost-grid"><div class="field"><label for="partsCost">Запчасти, ₸</label><input class="input" id="partsCost" inputmode="numeric" value="${pc}" placeholder="0"></div><div class="field"><label for="workCost">Работа, ₸</label><input class="input" id="workCost" inputmode="numeric" value="${wc}" placeholder="0"></div></div>
      <div class="cost-sum tot"><span>Итого к оплате</span><b id="costTotal">${money((num(pc)||0)+(num(wc)||0))}</b></div><div class="hint">Чеки на запчасти сфотографируйте в «Фото после».</div>`}</div>
    <div class="sec"><h4>${ic('msg',16)} Комментарий</h4>
      ${done?`<div style="font-size:14px">${r.comment?esc(r.comment):'<span class="muted">Без комментария</span>'}</div>`:`<textarea class="input" id="comment" placeholder="Например: заменил арматуру, проверил 5 сливов — не течёт">${esc(r.comment||'')}</textarea>`}</div>
    <div class="errbox" id="errbox"></div>
  </div>
  <div class="cta">${cta}</div>`;
}
function render(){ if(V.open) renderTask(); else renderList(); }
function readDraft(r){
  const g = id => document.getElementById(id); if(!g('comment') && !g('parts')) return {};
  const f = {}; if(g('parts')) f.parts = g('parts').value.trim(); if(g('partsCost')) f.partsCost = num(g('partsCost').value); if(g('workCost')) f.workCost = num(g('workCost').value); if(g('comment')) f.comment = g('comment').value.trim();
  return f;
}
function saveDraft(){ const r = cur(); if(!r || r.stage==='done') return; const f = readDraft(r); if(Object.keys(f).length) saveRepair(r, f); }

function fileToThumb(file){
  return new Promise(res=>{ const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => { const M=360; const k=Math.min(1, M/Math.max(img.width,img.height)); const cv=document.createElement('canvas'); cv.width=Math.round(img.width*k); cv.height=Math.round(img.height*k); cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); try{ res(cv.toDataURL('image/jpeg',.6)); }catch(e){ res(null); } }; img.onerror=()=>res(null); img.src=fr.result; };
    fr.onerror = () => res(null); fr.readAsDataURL(file); });
}
async function addFiles(kind, files){
  const r = cur(); if(!r) return; saveDraft(); const arr = (r[kind]||[]).slice(); let added = 0;
  for(const f of Array.from(files||[])){ if(!/^image\//.test(f.type)) continue; const src = await fileToThumb(f); if(src){ arr.push({src, label:(kind==='before'?'До':'После')+' '+(arr.length+1)}); added++; } }
  const res = saveRepair(r, {[kind]:arr}); if(res.ok==='trimmed') toast('Места в браузере мало — сохранили только количество фото', true);
  renderTask(); toast(added ? `Добавлено фото: ${added}` : 'Не удалось прочитать изображение', !added);
}
function nextStage(){
  const r = cur(); const a = aptById(r.aptId); saveDraft(); const t = nowHM();
  if(r.stage==='assigned'){ saveRepair(r, {stage:'enroute', status:'progress', enrouteAt:t}); Store.update(st=>logActivity(st, ME.short, `${ME.short} ${verb(ME,'выехал','выехала')} на ремонт кв. ${a.num}: ${r.title}`, 'enroute')); toast('Статус: в пути. Код двери — в карточке'); }
  else if(r.stage==='enroute'){ saveRepair(r, {stage:'progress', status:'progress', startedAt:t}); Store.update(st=>logActivity(st, ME.short, `${ME.short} ${verb(ME,'начал','начала')} ремонт кв. ${a.num}: ${r.title}`, 'start')); toast('Работа начата — не забудьте фото «после»'); }
  renderTask(); window.scrollTo(0,0);
}
function sendReport(){
  const r = cur(); const a = aptById(r.aptId); saveDraft();
  const nb = (r.before||[]).length, na = (r.after||[]).length; const miss = [];
  if(!nb) miss.push('добавьте фото «до»'); if(!na) miss.push('добавьте фото «после»');
  if(r.partsCost==null && r.workCost==null) miss.push('укажите стоимость (запчасти и/или работа, можно 0)');
  const eb = document.getElementById('errbox');
  if(miss.length){ eb.innerHTML = `<b>Чтобы отправить отчёт:</b> ${miss.join('; ')}.`; eb.classList.add('show'); eb.scrollIntoView({behavior:'smooth',block:'center'}); return; }
  const total = (r.partsCost||0) + (r.workCost||0);
  const res = saveRepair(r, {stage:'done', status:'done', cost:total, doneAt:nowHM(), reportAt:Date.now(), by:ME.short, paid:false});
  Store.update(st=>logActivity(st, ME.short, `${ME.short} ${verb(ME,'выполнил','выполнила')} ремонт кв. ${a.num}: ${r.title} — ${money(total)}, фото ${nb}+${na}`, 'done'));
  const ov = document.getElementById('doneOv');
  ov.innerHTML = `<div><div class="okc">${ic('check',42,3)}</div><h2 style="font-size:22px">Отчёт отправлен!</h2><p class="muted" style="margin:8px 0 18px">Кв. ${a.num}: ${esc(r.title)} · ${money(total)} · фото до/после: ${nb}/${na}.<br>Владелец уже видит отчёт в «Ремонтах» и в журнале «Сотрудники».</p>
    ${res.ok==='trimmed'?'<p class="muted" style="font-size:12px">Фото сохранены без миниатюр — в браузере мало места (демо).</p>':''}<button class="btn primary lg" data-ov-close>К моим ремонтам</button></div>`;
  ov.classList.add('open');
}
/* новая заявка «от владельца» для демонстрации уведомлений */
const SIM = {'Сантехник':[['Капает кран на кухне','Гости пишут: кран на кухне капает даже закрытый. Скорее всего, картридж.'],['Засор в душевой кабине','Вода в душевом поддоне не уходит. Прочистить слив.'],['Не набирает воду стиральная машина','Машина показывает ошибку подачи воды. Проверить кран и шланг.']],
  'Электрик':[['Не работает свет в ванной','Лампа не включается, замена лампочки не помогла. Проверить выключатель.'],['Выбивает автомат при включении чайника','Автомат на кухне отключается. Проверить розетку и линию.'],['Не работает домофон в квартире','Трубка не звонит, гости не могут попасть в подъезд.']]};
function simulate(){
  const pool = SIM[ME.spec] || SIM['Сантехник']; let made;
  Store.update(st=>{ const n = ++st.seq; const [title, desc] = pool[n % pool.length]; const a = apartments[(n*7) % apartments.length];
    made = {id:20000+n, aptId:a.id, title, desc, assignee:masterLabel(ME), masterId:ME.id, priority:'high', status:'open', stage:'assigned', date:TODAY, cost:0, source:'Вручную', sim:true};
    st.repairsAdded.push(made);
    pushNotify(st, ME.id, `Новый ремонт · кв. ${a.num}`, `${title} — ${a.complex}, сегодня`, 'cleaning.html#task=r'+made.id);
    logActivity(st, 'Азамат', `Азамат назначил ремонт кв. ${a.num} мастеру ${ME.short}: ${title} (демо)`, 'assign'); });
  return made;
}
function openFromHash(){ const m = /task=r(\d+)/.exec(location.hash); if(m){ const id=+m[1]; if(repairs.some(r=>r.id===id && r.masterId===ME.id)){ V.open=id; renderTask(); window.scrollTo(0,0); } } }

document.addEventListener('click', e=>{
  const t = e.target;
  if(t.closest('[data-logout]')){ saveDraft(); Auth.logout('team'); location.href='login.html?role=master'; return; }
  const tb = t.closest('[data-tab]'); if(tb){ V.tab = tb.dataset.tab; renderList(); return; }
  const op = t.closest('[data-open]'); if(op){ V.open = +op.dataset.open; renderTask(); window.scrollTo(0,0); return; }
  if(t.closest('[data-back]')){ saveDraft(); V.open = null; if(location.hash) history.replaceState(null,'',location.pathname+location.search); renderList(); window.scrollTo(0,0); return; }
  const dp = t.closest('[data-demo-photos]'); if(dp){ const r = cur(); const k = dp.dataset.demoPhotos; saveDraft(); const arr=(r[k]||[]).slice(); for(let i=0;i<2;i++) arr.push({demo:true, label:(k==='before'?'До':'После')+' '+(arr.length+1), hue:k==='before'?(20+arr.length*25):(140+arr.length*20)}); saveRepair(r,{[k]:arr}); renderTask(); toast('Добавлено 2 демо-фото'); return; }
  const rm = t.closest('[data-rm]'); if(rm){ const r = cur(); const [k,i] = rm.dataset.rm.split(':'); saveDraft(); const arr=(r[k]||[]).slice(); arr.splice(+i,1); saveRepair(r,{[k]:arr}); renderTask(); return; }
  if(t.closest('[data-maps]')){ toast('Демо: здесь откроется 2ГИС / Яндекс Карты с маршрутом'); return; }
  if(t.closest('[data-next]')){ nextStage(); return; }
  if(t.closest('[data-report]')){ sendReport(); return; }
  if(t.closest('[data-quote]')){ sendQuote(); return; }
  if(t.id==='sheetBg'){ PWA.closeSheet(); return; }
  if(t.closest('[data-ov-close]')){ document.getElementById('doneOv').classList.remove('open'); V.open=null; V.tab='active'; renderList(); window.scrollTo(0,0); return; }
});
document.addEventListener('change', e=>{ const k = e.target.dataset && e.target.dataset.cam; if(k){ addFiles(k, e.target.files); e.target.value=''; } else if(['parts','partsCost','workCost','comment'].includes(e.target.id)) saveDraft(); });
document.addEventListener('input', e=>{ if(e.target.id==='partsCost'||e.target.id==='workCost'){ const el=document.getElementById('costTotal'); if(el) el.textContent = money((num(document.getElementById('partsCost').value)||0)+(num(document.getElementById('workCost').value)||0)); } });
window.addEventListener('hashchange', openFromHash);
window.addEventListener('storage', e=>{
  if(e.key===TEAM_KEY){ const u=Auth.current('team'); if(!u||u.id!==USER.id) location.reload(); return; }
  if(e.key===STORE_KEY){ const st=Store.load(); if(st.access && st.access[USER.id]===false){ location.reload(); return; } syncRepairs(st);
    const ae = document.activeElement; if(!(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName))) render(); }
});
render(); openFromHash();
if(window.PWA) PWA.init({userId:ME.id, toast, simulate:()=>{ simulate(); syncRepairs(Store.load()); if(!V.open){ V.tab='active'; renderList(); } },
  onNew:(n, silent)=>{ syncRepairs(Store.load()); if(!V.open) renderList(); if(!silent) toast(n.title+': '+n.body); }});
window.__master = {V, mine, simulate};
})();
