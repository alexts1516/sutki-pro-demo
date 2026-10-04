// Сборка статического демо серверной версии для GitHub Pages: ../v2/ (https://alexts1516.github.io/sutki-pro-demo/v2/).
//   node scripts/build-static-demo.js   (или npm run demo:build)
// Что делает:
//   1) схема prisma/schema.prisma → demo/generated/models.json (для Prisma в памяти);
//   2) демо-данные прототипа (../assets/data.js, store.js) → demo/generated/prototype-data.json (для сида в браузере);
//   3) собирает настоящий код сервера (src/app.js, маршруты, сервисы, уведомления, prisma/seed.js) в один файл v2/demo/demo.js —
//      вместо базы Prisma в памяти, вместо сети — перехват fetch к /api/... (demo/browser/backend.js);
//   4) копирует страницы public/admin, public/app, public/link и public/shared как есть, меняя только абсолютные пути на относительные
//      и подключая demo.js перед скриптом страницы;
//   5) главная страница демо — demo/landing/index.html.
// Ничего из существующих файлов сайта (index.html, app.html, assets/ …) не меняет.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { parseSchema } from '../demo/schema-parse.js';
import { loadPrototypeData } from '../prisma/demo-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const out = path.resolve(process.env.DEMO_OUT || path.join(repo, 'v2'));
const gen = path.join(root, 'demo', 'generated');
const rel = (...p) => path.join(root, ...p);
fs.mkdirSync(gen, { recursive: true });

// 1) схема
const schemaText = fs.readFileSync(rel('prisma', 'schema.prisma'), 'utf8');
fs.writeFileSync(path.join(gen, 'models.json'), JSON.stringify(parseSchema(schemaText)));

// 2) данные прототипа (функции aptDoor/aptPets/FX_DEFAULT — заранее посчитанные значения)
const d = loadPrototypeData();
const proto = {
  TODAY: d.TODAY, apartments: d.apartments, bookings: d.bookings, cleanings: d.cleanings, repairs: d.repairs, transfers: d.transfers, requests: d.requests,
  CHECKLIST: d.CHECKLIST, STAFF_BASE: d.STAFF_BASE, CONTRACTORS_BASE: d.CONTRACTORS_BASE, CLEANERS: d.CLEANERS,
  fx: d.FX_DEFAULT(), doors: Object.fromEntries(d.apartments.map(a => [a.id, d.aptDoor(a)])), pets: Object.fromEntries(d.apartments.map(a => [a.id, d.aptPets(a)])),
};
const protoJson = JSON.stringify(proto);
fs.writeFileSync(path.join(gen, 'prototype-data.json'), protoJson);

// версия данных: меняется схема или сид — у посетителей демо заполнится заново
const seedSrc = fs.readFileSync(rel('prisma', 'seed.js'), 'utf8');
const version = crypto.createHash('sha1').update(schemaText).update(seedSrc).update(protoJson).digest('hex').slice(0, 12);

// 3) сборка «сервера в браузере»
const shim = (f) => rel('demo', 'shims', f);
const ALIAS = {
  '@prisma/client': rel('demo', 'browser', 'prisma-client.js'),
  express: shim('express.js'), jsonwebtoken: shim('jsonwebtoken.js'), 'cookie-parser': shim('cookie-parser.js'), multer: shim('multer.js'),
  'dotenv/config': shim('empty.js'), dotenv: shim('empty.js'),
  'node:crypto': shim('node-crypto.js'), crypto: shim('node-crypto.js'),
  'node:path': shim('node-path.js'), path: shim('node-path.js'), 'node:url': shim('node-url.js'),
  'node:fs': shim('node-fs.js'), fs: shim('node-fs.js'), 'node:fs/promises': shim('node-fs.js'), 'node:vm': shim('empty.js'),
};
const FILES = {   // файлы сервера, которые в браузере подменяются
  [rel('src', 'config.js')]: shim('config.js'),
  [rel('src', 'storage', 'local.js')]: shim('storage-browser.js'),
  [rel('src', 'storage', 's3.js')]: shim('storage-browser.js'),
  [rel('prisma', 'demo-data.js')]: shim('demo-data.js'),
};
const demoPlugin = {
  name: 'static-demo',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (ALIAS[args.path]) return { path: ALIAS[args.path] };
      if (args.path.startsWith('.') && args.resolveDir) {
        let p = path.resolve(args.resolveDir, args.path);
        if (!p.endsWith('.js') && !p.endsWith('.json')) p += '.js';
        if (FILES[p]) return { path: FILES[p] };
      }
      return null;
    });
    // сид: тот же prisma/seed.js, только без автозапуска — демо вызывает runSeed() само
    build.onLoad({ filter: /prisma[\\/]seed\.js$/ }, () => {
      const tail = /\nmain\(\)\.then\([^\n]*\n?$/;
      if (!tail.test(seedSrc)) throw new Error('seed.js: не нашёл строку запуска main() в конце файла');
      return { contents: seedSrc.replace(tail, '\nexport { main as runSeed };\n'), loader: 'js', resolveDir: rel('prisma') };
    });
  },
};
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'demo', 'assets'), { recursive: true });
const result = await esbuild.build({
  entryPoints: [rel('demo', 'browser', 'entry.js')], bundle: true, format: 'esm', platform: 'browser', target: ['es2020', 'safari15'],
  outfile: path.join(out, 'demo', 'demo.js'), minify: true, legalComments: 'none', charset: 'utf8', metafile: true,
  plugins: [demoPlugin], define: { 'process.env.NODE_ENV': '"production"', 'globalThis.__DEMO_DATA_VERSION__': JSON.stringify(version) },
  logLevel: 'warning',
});
const bytes = fs.statSync(path.join(out, 'demo', 'demo.js')).size;
const bad = Object.keys(result.metafile.inputs).filter(f => /node_modules[\\/](grammy|@prisma[\\/]client|express[\\/]|multer[\\/]|jsonwebtoken)/.test(f));
if (bad.length) throw new Error('В демо попали серверные модули: ' + bad.join(', '));

// 4) страницы сервера как есть — только пути
function copy(from, to, edits = []) {
  let s = fs.readFileSync(rel('public', from), 'utf8');
  for (const [a, b] of edits) {
    if (!s.includes(a)) throw new Error(`${from}: не нашёл «${a}» — страница сервера изменилась, поправьте scripts/build-static-demo.js`);
    s = s.split(a).join(b);
  }
  const dst = path.join(out, to); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, s);
}
const DEMO_TAG = '<script type="module" src="../demo/demo.js"></script>\n';
copy('admin/index.html', 'admin/index.html', [
  ['<script src="admin.js" type="module"></script>', DEMO_TAG + '<script src="admin.js" type="module"></script>'],
  ['<a href="/app/">приложение команды</a>', '<a href="../app/">приложение команды</a>'],
  ['<a class="nav-app" href="/app/"', '<a class="nav-app" href="../app/"'],
  ['<title>Сутки·Pro — админка владельца</title>', '<title>Сутки·Pro — админка владельца (демо)</title>'],
]);
copy('admin/admin.js', 'admin/admin.js', [['<a href="/app/" target="_blank" rel="noopener">${location.origin}/app/</a>', '<a href="../app/" target="_blank" rel="noopener">${new URL(\'../app/\', location.href).href}</a>']]);
copy('admin/admin.css', 'admin/admin.css');
copy('app/index.html', 'app/index.html', [
  ['<link rel="stylesheet" href="/shared/ui.css">', '<link rel="stylesheet" href="../shared/ui.css">'],
  ['href="/admin/"', 'href="../admin/"'],
  ['<script type="module" src="app.js"></script>', DEMO_TAG + '<script type="module" src="app.js"></script>'],
  ['<title>Сутки·Pro — приложение команды</title>', '<title>Сутки·Pro — приложение команды (демо)</title>'],
]);
copy('app/app.js', 'app/app.js', [["from '/shared/views.js'", "from '../shared/views.js'"]]);
copy('link/index.html', 'link/index.html', [
  ['<link rel="stylesheet" href="/shared/ui.css">', '<link rel="stylesheet" href="../shared/ui.css">'],
  ['<script type="module" src="/link-assets/link.js"></script>', DEMO_TAG + '<script type="module" src="./link.js"></script>'],
  ['<title>Сутки·Pro — задача</title>', '<title>Сутки·Pro — задача (демо)</title>\n<link rel="icon" href="data:,">'],   // без значка браузер просит /favicon.ico → 404
]);
// на GitHub Pages нет адресов вида /link/<токен> — токен передаётся после #: /v2/link/#<токен>
copy('link/link.js', 'link/link.js', [
  ["from '/shared/views.js'", "from '../shared/views.js'"],
  ["const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');",
    "const token = decodeURIComponent(location.hash.slice(1) || '');\nwindow.addEventListener('hashchange', () => location.reload());"],
]);
copy('link/special.js', 'link/special.js', [["from '/shared/views.js'", "from '../shared/views.js'"]]);   // вид гостя по личной ссылке (проход 4, шаг 7)
copy('shared/ui.css', 'shared/ui.css');
copy('shared/views.js', 'shared/views.js');

// картинки сида (фото дома, логотип клиента)
fs.copyFileSync(path.join(repo, 'assets', 'photos', 'highvill-g1-1200.jpg'), path.join(out, 'demo', 'assets', 'highvill-g1-1200.jpg'));
fs.copyFileSync(path.join(repo, 'assets', 'brand', 'pin-silver-128.png'), path.join(out, 'demo', 'assets', 'pin-silver-128.png'));

// 5) главная страница демо
fs.copyFileSync(rel('demo', 'landing', 'index.html'), path.join(out, 'index.html'));
fs.writeFileSync(path.join(out, 'demo', 'VERSION'), `${version}\n`);
console.log(`Демо собрано: ${path.relative(repo, out)}/ (demo.js ${(bytes / 1024).toFixed(0)} КБ, версия данных ${version})`);
