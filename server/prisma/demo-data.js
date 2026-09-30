// Загружает демо-данные статического прототипа (../assets/data.js и store.js) прямо в Node,
// чтобы в базе были те же квартиры, брони, уборки и ремонты, что и на демо-сайте.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export function loadPrototypeData() {
  const mem = {};
  const window = { tx: (s) => s };
  const ctx = {
    window, console, Math, Date, JSON, Object, Array, String, Number, Set, Map, Intl, encodeURIComponent,
    localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    document: { querySelector: () => null, querySelectorAll: () => [], documentElement: { style: { setProperty() {} } }, addEventListener() {} },
    addEventListener() {}, location: { search: '', href: '' }, navigator: {},
  };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.tx = window.tx; window.localStorage = ctx.localStorage;
  const src = ['data.js', 'store.js'].map(f => fs.readFileSync(path.join(ASSETS, f), 'utf8')).join('\n;\n')
    + `\n;globalThis.__demo = { TODAY, di, apartments, bookings, cleanings, repairs, transfers, requests, CHECKLIST, STAFF_BASE, CONTRACTORS_BASE, FX_DEFAULT, aptDoor, aptPets, CLEANERS };`;
  vm.runInNewContext(src, ctx, { filename: 'prototype-data.js' });
  return ctx.__demo;
}
