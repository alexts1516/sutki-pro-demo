import { issueOperationKey } from '../../src/services/publicCheckout.js';
// «Сервер в браузере» для статического демо (/v2/): настоящий код сервера (src/app.js, маршруты, сервисы, уведомления, сид)
// работает на Prisma в памяти, а запросы страниц к /api/... перехватываются (fetch) и отдаются ему.
// Данные хранятся только в этом браузере (IndexedDB); «Сбросить демо» — заново заполнить демо-данными.
import '../shims/inject.js';
import { prisma } from '../../src/db.js';
import { config } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { createEventBus } from '../../src/notifications/events.js';
import { createNotificationService } from '../../src/notifications/service.js';
import { startScheduler } from '../../src/notifications/scheduler.js';
import { createStorage } from '../../src/storage/index.js';
import { handleTransferAccept } from '../../src/telegram/transferButtons.js';
import { handlePayoutButton } from '../../src/telegram/payoutButtons.js';
import { randomToken } from '../../src/lib/tokens.js';
import { runSeed } from '../../prisma/seed.js';
import { createTestPayments } from '../../src/payments/test.js';

const DATA_VERSION = globalThis.__DEMO_DATA_VERSION__ || 'dev';
const IDB_NAME = 'sutki-pro-demo-v2', IDB_STORE = 'state', IDB_KEY = 'main';
const LS = { rev: 'sp2demo:rev', cookie: 'sp2demo:cookie', seen: 'sp2demo:feedSeen' };
const quiet = { log() {}, warn() {}, error: (...a) => console.warn('[демо]', ...a) };

// ---------- хранение в браузере ----------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function idbGet() {
  const d = await idb();
  return new Promise((resolve, reject) => { const t = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY); t.onsuccess = () => resolve(t.result || null); t.onerror = () => reject(t.error); });
}
async function idbPut(v) {
  const d = await idb();
  return new Promise((resolve, reject) => { const tx = d.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(v, IDB_KEY); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
async function idbClear() {
  const d = await idb();
  return new Promise((resolve) => { const tx = d.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete(IDB_KEY); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } };

let feed = [];             // сообщения «Telegram (демо)»
let seededAt = null;
let myRev = null, dirty = false, saveTimer = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* */ } });

async function save() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!dirty) return;
  dirty = false;
  myRev = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try { await idbPut({ v: DATA_VERSION, db: prisma.$dump(), feed, seededAt, rev: myRev }); lsSet(LS.rev, myRev); }
  catch (e) { console.warn('[демо] не удалось сохранить данные:', e); }
}
globalThis.__demoChanged = () => { dirty = true; if (!saveTimer) saveTimer = setTimeout(save, 400); };

/** Другая вкладка демо что-то изменила — перечитать данные */
async function syncFromOtherTabs() {
  const rev = lsGet(LS.rev);
  if (!rev || rev === myRev) return;
  const s = await idbGet();
  if (s && s.v === DATA_VERSION) { prisma.$load(s.db); feed = s.feed || []; seededAt = s.seededAt; myRev = s.rev; notify(); }
}

// ---------- демо-«Telegram»: сообщения вместо отправки ----------
const transport = {
  name: 'telegram-demo',
  async send(chatId, text, opts = {}) {
    feed.push({ id: randomToken(8), chatId: String(chatId), text, buttons: opts.buttons || null, at: Date.now() });
    if (feed.length > 400) feed = feed.slice(-400);
    globalThis.__demoChanged(); queueMicrotask(notify);
  },
};

// Telegram в демо «привязан» у всех сотрудников и гостей демо-аккаунта — так видно, кому что пришло бы
async function linkDemoTelegram() {
  const acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  if (!acc) return;
  const ms = await prisma.membership.findMany({ where: { accountId: acc.id }, orderBy: { createdAt: 'asc' } });
  let n = 0;
  for (const m of ms) await prisma.user.update({ where: { id: m.userId }, data: { telegramId: String(7000001 + n++) } });
  const contractorUsers = await prisma.contractor.findMany({ where: { accountId: acc.id, userId: { not: null } } });
  for (const c of contractorUsers) { const u = await prisma.user.findUnique({ where: { id: c.userId } }); if (!u.telegramId) await prisma.user.update({ where: { id: u.id }, data: { telegramId: String(7000001 + n++) } }); }
  const guests = await prisma.guest.findMany({ where: { accountId: acc.id }, select: { id: true } });
  let g = 0;
  for (const x of guests) await prisma.guest.update({ where: { id: x.id }, data: { telegramChatId: String(8000001 + g++) } });
}

async function seedFresh() {
  prisma.$load(null);
  feed = [];
  await runSeed();
  await linkDemoTelegram();
  seededAt = Date.now();
  dirty = true; await save();
}

// ---------- приложение сервера ----------
const events = createEventBus({ logger: quiet });
createNotificationService({ prisma, transport, quiet: true, logger: quiet }).register(events);
const storage = createStorage(config.storage);
const app = createApp({ config, events, storage, payments: createTestPayments(), flights: null, logger: quiet });   // демо-оплата: сразу успешна → бронь подтверждается
const dispatch = app.locals.dispatch;

const ready = (async () => {
  let s = null;
  try { s = await idbGet(); } catch (e) { console.warn('[демо] IndexedDB недоступна — данные не сохранятся после перезагрузки', e); }
  if (s && s.v === DATA_VERSION) { prisma.$load(s.db); feed = s.feed || []; seededAt = s.seededAt; myRev = s.rev; }
  else { await seedFresh(); lsSet(LS.cookie, null); }
  startScheduler({ prisma, events, dispatch, payouts: app.locals.payouts, logger: quiet });
})();

// ---------- «cookie» входа (как httpOnly-cookie сервера, общая для всех страниц демо) ----------
const cookies = {
  get() { try { return JSON.parse(lsGet(LS.cookie) || '{}'); } catch { return {}; } },
  set(name, value) { const c = cookies.get(); c[name] = value; lsSet(LS.cookie, JSON.stringify(c)); },
  del(name) { const c = cookies.get(); delete c[name]; lsSet(LS.cookie, JSON.stringify(c)); },
};

function makeRes() {
  let done; const finished = new Promise(r => { done = r; });
  const on = {};
  const res = {
    statusCode: 200, headers: {}, body: '', locals: {}, headersSent: false, finished,
    status(c) { this.statusCode = c; return this; },
    set(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) this.headers[a.toLowerCase()] = String(b); else this.headers[k.toLowerCase()] = String(v); return this; },
    header(k, v) { return this.set(k, v); }, setHeader(k, v) { return this.set(k, v); },
    get(k) { return this.headers[k.toLowerCase()]; }, getHeader(k) { return this.get(k); },
    type(t) { return this.set('content-type', t); },
    json(o) { if (!this.headers['content-type']) this.set('content-type', 'application/json; charset=utf-8'); return this.end(JSON.stringify(o)); },
    send(b) { if (b !== null && typeof b === 'object') return this.json(b); if (!this.headers['content-type']) this.set('content-type', 'text/html; charset=utf-8'); return this.end(b == null ? '' : String(b)); },
    sendStatus(c) { this.statusCode = c; return this.send(String(c)); },
    redirect(a, b) { const url = b || a; this.statusCode = b ? a : 302; this.set('location', url); return this.end(''); },
    sendFile() { this.statusCode = 404; return this.end(''); },
    cookie(name, value) { cookies.set(name, value); return this; },
    clearCookie(name) { cookies.del(name); return this; },
    on(ev, fn) { (on[ev] ||= []).push(fn); return this; }, once(ev, fn) { return this.on(ev, fn); },
    end(b) { if (this.headersSent) return this; this.headersSent = true; this.body = b ?? ''; done(); setTimeout(() => (on.finish || []).forEach(f => f())); return this; },
  };
  return res;
}

function parseQuery(search) {
  const q = {};
  for (const [k, v] of new URLSearchParams(search)) { if (k in q) q[k] = [].concat(q[k], v); else q[k] = v; }
  return q;
}

/** Картинки с телефона бывают по 5–10 МБ — уменьшаем до 1600 px, чтобы поместились в хранилище браузера */
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024 || typeof document === 'undefined') return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
async function readForm(fd) {
  const fields = {}, files = [];
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') { if (k in fields) fields[k] = [].concat(fields[k], v); else fields[k] = v; continue; }
    const f = await shrinkImage(v);
    const buffer = globalThis.Buffer.from(new Uint8Array(await f.arrayBuffer()));
    files.push({ fieldname: k, originalname: f.name || 'photo', mimetype: f.type || 'application/octet-stream', size: buffer.length, buffer });
  }
  return { fields, files };
}

const linkFix = (s) => (config.publicUrl ? String(s).split(`${config.publicUrl}/link/`).join(`${config.publicUrl}/link/#`) : s);

/** Обработать запрос к /api/... настоящим кодом сервера */
export async function handleApi(method, url, { headers = {}, body } = {}) {
  await ready;
  await syncFromOtherTabs();
  const h = {}; for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  // Demo server/client share one process; existing fixture actions request a fresh server-issued operation proof.
  if(method.toUpperCase()==='POST' && url.pathname.startsWith('/api/public/') && !h['idempotency-key']) h['idempotency-key']=issueOperationKey(config,url.pathname.split('/')[3]);
  const req = {
    get path(){return this.url.split('?')[0];},
    method: method.toUpperCase(), url: url.pathname + url.search, originalUrl: url.pathname + url.search, baseUrl: '',
    headers: h, query: parseQuery(url.search), cookies: cookies.get(), ip: 'demo', ips: [], protocol: 'https', secure: true, hostname: location.hostname, params: {},
    get(k) { return h[k.toLowerCase()]; }, header(k) { return h[k.toLowerCase()]; },
  };
  if (body instanceof FormData) req._form = await readForm(body);
  else if (typeof body === 'string' && body && /json/.test(h['content-type'] || '')) {
    try { req.body = JSON.parse(body); } catch { const res = makeRes(); res.status(400).json({ error: 'Неверный JSON' }); return res; }
  }
  const res = makeRes();
  res.req = req; req.res = res;
  app.handle(req, res, (err) => {
    if (res.headersSent) return;
    if (err) { console.warn('[демо] ошибка', err); res.status(500).json({ error: 'Ошибка сервера' }); }
    else res.status(404).json({ error: 'Нет такого адреса' });
  });
  await res.finished;
  await events.idle();
  if (dirty && req.method !== 'GET') await save();
  res.body = linkFix(res.body);
  return res;
}

// ---------- перехват fetch ----------
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, location.href);
  const i = url.pathname.indexOf('/api/');
  if (url.origin !== location.origin || i === -1) return realFetch(input, init);
  const apiUrl = new URL(url.pathname.slice(i) + url.search, location.origin);
  let headers = init.headers || (typeof input === 'object' && input.headers) || {};
  if (headers instanceof Headers) headers = Object.fromEntries(headers.entries());
  const method = init.method || (typeof input === 'object' && input.method) || 'GET';
  const res = await handleApi(method, apiUrl, { headers, body: init.body });
  const nobody = [204, 205, 304].includes(res.statusCode);
  return new Response(nobody ? null : res.body, { status: res.statusCode, headers: res.headers });
};

// ---------- для панели демо ----------
export const demo = {
  ready, prisma, config, dispatch, events,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get feed() { return feed; },
  get seededAt() { return seededAt; },
  async session() { const r = await handleApi('GET', new URL('/api/auth/session', location.origin)); try { return JSON.parse(r.body); } catch { return { authenticated: false }; } },
  async login(email) {
    const r = await handleApi('POST', new URL('/api/auth/login', location.origin), { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: email, password: 'demo12345' }) });
    if (r.statusCode !== 200) throw new Error(JSON.parse(r.body).error || 'Не удалось войти');
    return JSON.parse(r.body);
  },
  logout() { cookies.del('sp_token'); },
  async reset() { await ready; await idbClear(); lsSet(LS.cookie, null); lsSet(LS.seen, null); await seedFresh(); notify(); },
  /** Нажать кнопку под сообщением «Telegram (демо)» — за того, кому пришло сообщение (как кнопка «Беру» в настоящем боте) */
  async press(msgId, data) {
    await ready; await syncFromOtherTabs();
    const msg = feed.find(m => m.id === msgId); if (!msg) throw new Error('Сообщение не найдено');
    const m = /^tj:acc:([A-Za-z0-9_-]{8,40})$/.exec(data), po = /^po:(cash|transfer):([A-Za-z0-9_-]{8,40})$/.exec(data);
    if (!m && !po) throw new Error('Эта кнопка в демо не работает');
    // «Оплатить» под «… — к оплате 5 000 ₸» — как в настоящем боте (только владелец)
    const r = po ? await handlePayoutButton({ prisma, payouts: app.locals.payouts, telegramUserId: msg.chatId, method: po[1], payoutId: po[2] })
      : await handleTransferAccept({ prisma, dispatch, telegramUserId: msg.chatId, jobId: m[1], publicUrl: config.publicUrl });
    if (po && r.done) r.taken = true;
    await events.idle();
    if (r.ok || r.taken) msg.buttons = null;
    if (r.details) feed.push({ id: randomToken(8), chatId: msg.chatId, text: r.details, buttons: null, at: Date.now(), reply: true });
    globalThis.__demoChanged(); await save(); notify();
    return r;
  },
  /** Кому принадлежит chat id: сотрудник или гость */
  async whoIs(chatIds) {
    const ids = [...new Set(chatIds)];
    const users = await prisma.user.findMany({ where: { telegramId: { in: ids } }, include: { memberships: true, contractorOf: true } });
    const guests = await prisma.guest.findMany({ where: { telegramChatId: { in: ids } } });
    const out = {};
    const ROLE = { owner: 'владелец', admin: 'администратор', driver: 'водитель', master: 'мастер', cleaning: 'подготовка' };
    for (const u of users) out[u.telegramId] = { name: u.name, role: u.contractorOf.length ? 'подрядчик' : ROLE[u.memberships[0]?.role] || '', userId: u.id };
    for (const g of guests) out[g.telegramChatId] = { name: g.name, role: 'гость' };
    return out;
  },
  /** Ссылка для внешнего водителя / мастера (без входа) */
  async linkFor(kind) {
    await ready;
    const acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
    if (kind === 'driver') {
      const j = await prisma.transferJob.findFirst({ where: { accountId: acc.id, linkToken: { not: null }, driverContractorId: { not: null }, status: { notIn: ['DONE', 'CANCELLED'] } }, orderBy: { pickupAt: 'asc' } });
      return j ? j.linkToken : null;
    }
    const t = await prisma.repairTask.findFirst({ where: { accountId: acc.id, linkToken: { not: null }, contractor: { is: { userId: null } }, status: { notIn: ['DONE', 'CANCELLED'] } }, orderBy: { date: 'asc' } });
    return t ? t.linkToken : null;
  },
};
globalThis.SutkiDemo = demo;
