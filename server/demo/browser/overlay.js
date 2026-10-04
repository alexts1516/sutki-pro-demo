// Панель статического демо поверх страниц сервера: «Сменить роль» (вход в одно касание), «Telegram (демо)» —
// сообщения, которые бот отправил бы людям (с кнопкой «Беру»), и «Сбросить демо». Стили изолированы (Shadow DOM).
import { demo } from './backend.js';

export const ROLES = [
  { id: 'owner', icon: '👑', title: 'Владелец Азамат', sub: 'админка: брони, трансферы, мастера, финансы, настройки', email: 'azamat@astanastay.example', to: 'admin' },
  { id: 'admin', icon: '🗂️', title: 'Администратор Алина', sub: 'админка без финансов и настроек комиссии', email: 'alina@astanastay.example', to: 'admin' },
  { id: 'driver', icon: '🚗', title: 'Водитель Руслан', sub: 'приложение: заказы, «Беру», шаги поездки', email: 'ruslan@astanastay.example', to: 'app' },
  { id: 'master', icon: '🔧', title: 'Мастер Master Electric', sub: 'подрядчик с входом: смета, «В работе», «Завершить», выплаты', email: 'electric@astanastay.example', to: 'app' },
  { id: 'cleaner', icon: '✨', title: 'Подготовка — Гульнара', sub: 'специалист по подготовке: чек-лист, фото, выплаты', email: 'gulnara@astanastay.example', to: 'app' },
  { id: 'extMaster', icon: '🔗', title: 'Внешний мастер по ссылке', sub: 'сервис без входа — одна заявка', link: 'master' },
];

const base = () => demo.config.publicUrl || new URL('..', location.href).href.replace(/\/$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Текст сообщения Telegram (HTML бота) — оставляем только безопасные теги */
export function tgHtml(text) {
  let s = esc(text);
  s = s.replace(/&lt;(\/?)(b|i|u|s|code|pre)&gt;/g, '<$1$2>');
  s = s.replace(/&lt;a href=&quot;(https?:\/\/[^&"]+?|[^&"]*?)&quot;&gt;/g, (_m, h) => `<a href="${h.replace(`${base()}/link/`, `${base()}/link/#`)}" target="_blank" rel="noopener">`).replace(/&lt;\/a&gt;/g, '</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_m, p, u) => `${p}<a href="${u.replace(`${base()}/link/`, `${base()}/link/#`)}" target="_blank" rel="noopener">${u}</a>`);
  return s.replace(/\n/g, '<br>');
}

/** Войти за роль и открыть нужную страницу */
export async function goRole(id, hash = '') {
  const r = ROLES.find(x => x.id === id);
  await demo.ready;
  let url;
  if (r.link) {
    const token = await demo.linkFor(r.link);
    if (!token) throw new Error(r.link === 'driver' ? 'Сейчас нет открытой поездки у внешнего водителя. Назначьте «Такси «Жол»» в карточке трансфера (админка → Трансферы).' : 'Нет открытой заявки у внешнего мастера. Создайте заявку подрядчику без входа (админка → Мастера).');
    url = `${base()}/link/#${token}`;
  } else {
    await demo.login(r.email);
    url = `${base()}/${r.to}/${hash ? '#' + hash : ''}`;
  }
  const target = new URL(url, location.href);
  if (target.pathname === location.pathname) { location.href = target.href; setTimeout(() => location.reload(), 50); }
  else location.href = target.href;
}

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Arial,sans-serif}
.fab{position:fixed;right:12px;bottom:calc(var(--fab-bottom,16px) + env(safe-area-inset-bottom));z-index:2147483000;display:flex;gap:8px;flex-direction:column;align-items:flex-end}
.fab button{border:0;border-radius:999px;padding:10px 14px;font-size:14px;font-weight:600;color:#fff;background:#111827;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent}
.fab button.tg{background:#229ED9}
.badge[hidden]{display:none}
.badge{background:#ef4444;color:#fff;border-radius:999px;font-size:11px;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px}
.back{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483001;display:none}
.back.on{display:block}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;background:#f8fafc;border-radius:18px 18px 0 0;z-index:2147483002;display:none;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.25)}
.sheet.on{display:flex}
@media(min-width:720px){.sheet{left:auto;right:16px;bottom:16px;width:420px;border-radius:18px;max-height:80vh}}
.hd{display:flex;align-items:center;gap:8px;padding:12px 14px 8px;border-bottom:1px solid #e5e7eb}
.hd b{flex:1;font-size:16px;color:#0f172a}
.x{border:0;background:#e5e7eb;border-radius:999px;width:32px;height:32px;font-size:18px;cursor:pointer}
.tabs{display:flex;gap:6px;padding:8px 14px}
.tabs button{flex:1;border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:8px 6px;font-size:13px;font-weight:600;color:#334155;cursor:pointer}
.tabs button.on{background:#4f46e5;border-color:#4f46e5;color:#fff}
.body{overflow:auto;padding:4px 14px 18px;-webkit-overflow-scrolling:touch}
.note{font-size:12.5px;color:#475569;background:#eef2ff;border-radius:10px;padding:8px 10px;margin:6px 0 10px;line-height:1.4}
.role{display:flex;gap:10px;align-items:center;width:100%;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:12px;padding:10px 12px;margin:6px 0;cursor:pointer;color:#0f172a}
.role.cur{border-color:#4f46e5;box-shadow:0 0 0 2px #c7d2fe}
.role .ic{font-size:22px;width:30px;text-align:center}
.role b{display:block;font-size:14.5px}
.role small{display:block;color:#64748b;font-size:12px;margin-top:2px}
.row{display:flex;gap:8px;margin-top:12px}
.btn{flex:1;border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:10px;font-size:13.5px;font-weight:600;color:#0f172a;cursor:pointer;text-align:center;text-decoration:none}
.btn.red{color:#b91c1c;border-color:#fecaca;background:#fff5f5}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.chips button{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:5px 10px;font-size:12.5px;cursor:pointer;color:#334155}
.chips button.on{background:#229ED9;border-color:#229ED9;color:#fff}
.msg{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:10px 12px;margin:8px 0;font-size:13.5px;line-height:1.45;color:#0f172a;word-wrap:break-word}
.msg.new{border-color:#7dd3fc;box-shadow:0 0 0 2px #e0f2fe}
.msg .to{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#0369a1;font-weight:600;margin-bottom:4px}
.msg .to span{color:#94a3b8;font-weight:400}
.msg a{color:#0369a1}
.kb{display:flex;gap:6px;margin-top:8px}
.kb button{flex:1;border:0;border-radius:10px;background:#e0f2fe;color:#0369a1;font-weight:700;padding:9px;font-size:14px;cursor:pointer}
.kb small{display:block;font-weight:400;font-size:11px;color:#0284c7}
.empty{color:#64748b;text-align:center;padding:24px 8px;font-size:13.5px}
.toast{position:fixed;left:50%;transform:translateX(-50%);top:14px;z-index:2147483003;background:#0f172a;color:#fff;border-radius:12px;padding:10px 14px;font-size:14px;max-width:92vw;box-shadow:0 8px 24px rgba(0,0,0,.3);display:none}
.toast.on{display:block}
.toast.err{background:#b91c1c}
`;

export function mountOverlay({ fabBottom = null } = {}) {
  if (document.getElementById('sutki-demo-overlay')) return;
  const host = document.createElement('div'); host.id = 'sutki-demo-overlay';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const onApp = /\/app\/?$/.test(location.pathname) || /\/app\/index\.html$/.test(location.pathname);
  root.innerHTML = `<style>${CSS}</style>
  <div class="fab" style="--fab-bottom:${fabBottom ?? (onApp ? 78 : 16)}px">
    <button class="tg" data-open="feed" aria-label="Сообщения Telegram (демо)">💬 Telegram <span class="badge" id="bd" hidden>0</span></button>
    <button data-open="roles" aria-label="Сменить роль">👥 Сменить роль</button>
  </div>
  <div class="back" id="back"></div>
  <div class="sheet" id="sheet" role="dialog" aria-label="Панель демо">
    <div class="hd"><b>Демо Сутки·Pro</b><button class="x" id="close" aria-label="Закрыть">×</button></div>
    <div class="tabs"><button data-tab="roles">Роли</button><button data-tab="feed">Telegram (демо)</button><button data-tab="about">О демо</button></div>
    <div class="body" id="body"></div>
  </div>
  <div class="toast" id="toast"></div>`;
  const $ = (s) => root.querySelector(s);
  let tab = 'roles', open = false, filter = 'all', session = null, me = null;

  const toast = (t, err) => { const el = $('#toast'); el.textContent = t; el.className = 'toast on' + (err ? ' err' : ''); clearTimeout(el._t); el._t = setTimeout(() => { el.className = 'toast'; }, err ? 5000 : 2600); };
  const seen = () => Number(localStorage.getItem('sp2demo:feedSeen') || 0);
  const badge = () => {
    const mine = demo.feed.filter(m => m.at > seen() && (!me || filter === 'all' || m.chatId === me));
    const bd = $('#bd'); bd.hidden = !mine.length; bd.textContent = mine.length > 99 ? '99+' : mine.length;
  };

  async function loadMe() {
    session = await demo.session().catch(() => null);
    me = null;
    if (session?.authenticated) { const u = await demo.prisma.user.findUnique({ where: { id: session.user.id } }); me = u?.telegramId || null; }
  }

  async function draw() {
    $('#sheet').classList.toggle('on', open); $('#back').classList.toggle('on', open);
    root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    badge();
    if (!open) return;
    const body = $('#body');
    if (tab === 'roles') {
      const cur = session?.authenticated ? session.user.email : null;
      body.innerHTML = `<div class="note">Нажмите на роль — демо войдёт за этого человека (пароль не нужен) и откроет его экран.${cur ? `<br>Сейчас: <b>${esc(session.user.name)}</b>` : ''}</div>` +
        ROLES.map(r => `<button class="role ${cur && r.email === cur ? 'cur' : ''}" data-role="${r.id}"><span class="ic">${r.icon}</span><span><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></span></button>`).join('') +
        `<div class="row"><a class="btn" href="${base()}/">🏠 Главная демо</a><button class="btn red" id="reset">↺ Сбросить демо</button></div>`;
    } else if (tab === 'feed') {
      const list = demo.feed.filter(m => filter === 'all' || m.chatId === me).slice().reverse().slice(0, 120);
      const who = await demo.whoIs(list.map(m => m.chatId));
      const s = seen();
      body.innerHTML = `<div class="note">Здесь сообщения, которые <b>отправил бы Telegram-бот</b>. В демо ничего никуда не уходит. Кнопку «✋ Беру» можно нажать за водителя — как в настоящем Telegram.</div>
        <div class="chips"><button data-f="all" class="${filter === 'all' ? 'on' : ''}">Все получатели</button>${me ? `<button data-f="me" class="${filter === 'me' ? 'on' : ''}">Только мне</button>` : ''}</div>` +
        (list.length ? list.map(m => {
          const w = who[m.chatId] || { name: 'chat ' + m.chatId, role: '' };
          const t = new Date(m.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          const kb = m.buttons ? `<div class="kb">${m.buttons.flat().map(b => `<button data-msg="${m.id}" data-btn="${esc(b.data)}">${esc(b.text)}<small>нажать за: ${esc(w.name.split(' ')[0])}</small></button>`).join('')}</div>` : '';
          return `<div class="msg ${m.at > s ? 'new' : ''}"><div class="to">→ ${esc(w.name)}${w.role ? ` · ${esc(w.role)}` : ''}<span>${t}</span></div>${tgHtml(m.text)}${kb}</div>`;
        }).join('') : `<div class="empty">Пока сообщений нет. Сделайте что-нибудь в админке — например, подтвердите бронь с трансфером.</div>`);
      localStorage.setItem('sp2demo:feedSeen', String(Date.now())); badge();
    } else {
      body.innerHTML = `<div class="note">Это <b>демо</b> серверной версии Сутки·Pro. Работает целиком в вашем браузере: тот же код сервера, что в папке <code>server/</code>, только «база» хранится в браузере.</div>
        <p style="font-size:13.5px;color:#334155;line-height:1.5">Данные видите только вы — они хранятся <b>только в этом браузере</b>. Настоящих оплат, Telegram-бота, SMS и хостинга нет: сообщения бота показываются во вкладке «Telegram (демо)».</p>
        <p style="font-size:13.5px;color:#334155;line-height:1.5">Демо-данные заполнены ${demo.seededAt ? new Date(demo.seededAt).toLocaleString('ru-RU') : '—'}. Чтобы начать сначала — «Сбросить демо».</p>
        <div class="row"><a class="btn" href="${base()}/">🏠 Главная демо</a><button class="btn red" id="reset">↺ Сбросить демо</button></div>`;
    }
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a'); if (!t) return;
    try {
      if (t.dataset.open) { tab = t.dataset.open; open = true; await loadMe(); await draw(); }
      else if (t.id === 'close') { open = false; draw(); }
      else if (t.dataset.tab) { tab = t.dataset.tab; await draw(); }
      else if (t.dataset.f) { filter = t.dataset.f; await draw(); }
      else if (t.dataset.role) { t.disabled = true; toast('Входим…'); await goRole(t.dataset.role); }
      else if (t.id === 'reset') {
        if (!confirm('Сбросить демо? Все ваши изменения пропадут, данные заполнятся заново.')) return;
        t.disabled = true; toast('Заполняем демо-данные…');
        await demo.reset(); location.href = `${base()}/`;
      } else if (t.dataset.msg) {
        t.disabled = true;
        const r = await demo.press(t.dataset.msg, t.dataset.btn);
        toast(r.text, !r.ok);
        await draw();
        if (r.ok) setTimeout(() => { if (/\/(app|admin)\//.test(location.pathname)) location.reload(); }, 1400);
      }
    } catch (err) { toast(err.message || String(err), true); t.disabled = false; }
  });
  $('#back').addEventListener('click', () => { open = false; draw(); });
  demo.onChange(() => { if (open && tab === 'feed') draw(); else badge(); });
  demo.ready.then(async () => { await loadMe(); badge(); });
  return { open: (t) => { tab = t; open = true; loadMe().then(draw); } };
}
