/* Сутки·Pro Команда — service worker (демо).
   1) Кэширует «оболочку» приложения команды, чтобы оно открывалось без интернета.
   2) Показывает локальные уведомления о новых задачах (registration.showNotification).
   Настоящие push-уведомления в закрытое приложение требуют сервера (Web Push + VAPID) — в рабочей версии. */
'use strict';
const CACHE = 'sutkipro-team-v1';
const SHELL = [
  './cleaning.html', './login.html', './task.html', './manifest.webmanifest',
  './assets/ui.css', './assets/data.js', './assets/store.js', './assets/pwa.js', './assets/cleaning.js', './assets/master.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/badge-96.png', './icons/favicon-32.png'
];
const SHELL_URLS = SHELL.map(p => new URL(p, self.registration.scope).href);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sutkipro-team-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* сначала сеть (чтобы демо всегда было свежим), без сети — из кэша. Остальные страницы сайта не трогаем. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url); url.search = ''; url.hash = '';
  if (!SHELL_URLS.includes(url.href)) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.href, copy)); }
      return res;
    }).catch(() => caches.match(url.href))
  );
});
/* нажатие на уведомление — открываем (или фокусируем) приложение на нужной задаче */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './cleaning.html', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) { if (c.url.split('#')[0].split('?')[0] === target.split('#')[0].split('?')[0] && 'focus' in c) { c.postMessage({type: 'open-task', url: target}); return c.focus(); } }
    return self.clients.openWindow ? self.clients.openWindow(target) : null;
  }));
});
/* заготовка под настоящий Web Push (в демо сервер не отправляет push) */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Сутки·Pro Команда', {body: d.body || 'Новая задача', icon: './icons/icon-192.png', badge: './icons/badge-96.png', data: {url: d.url || './cleaning.html'}}));
});
