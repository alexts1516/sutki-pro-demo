// Тексты сайта и бренд — правка в админке, выдача в публичном API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, png } from './helpers.js';

const { app } = makeApp();
let owner, admin;
before(async () => { owner = await login(app, 'azamat@astanastay.example'); admin = await login(app, 'alina@astanastay.example'); });
after(() => prisma.$disconnect());

test('тексты: стандартные значения по двум языкам', async () => {
  const r = await request(app).get('/api/admin/site-texts').set(admin.auth);
  assert.equal(r.status, 200);
  assert.equal(r.body.texts.ru['btn.book'], 'Забронировать'); assert.equal(r.body.texts.en['btn.book'], 'Book');
  assert.ok(r.body.keys.length >= 20); assert.deepEqual(r.body.custom.ru, {});
});

test('тексты: изменить, увидеть на сайте, сбросить', async () => {
  const put = await request(app).put('/api/admin/site-texts').set(admin.auth).send({ lang: 'ru', values: { 'hero.title': 'Уютные квартиры у Байтерека', 'btn.book': 'Хочу забронировать' } });
  assert.equal(put.status, 200); assert.equal(put.body.custom.ru['btn.book'], 'Хочу забронировать');
  await request(app).put('/api/admin/site-texts').set(admin.auth).send({ lang: 'en', values: { 'btn.book': 'Reserve' } });
  const site = await request(app).get('/api/public/astana-stay/site');
  assert.equal(site.body.texts.ru['hero.title'], 'Уютные квартиры у Байтерека');
  assert.equal(site.body.texts.en['btn.book'], 'Reserve'); assert.equal(site.body.texts.ru['nav.map'], 'Карта');
  await request(app).put('/api/admin/site-texts').set(admin.auth).send({ lang: 'ru', values: { 'btn.book': '' } });
  const site2 = await request(app).get('/api/public/astana-stay/site');
  assert.equal(site2.body.texts.ru['btn.book'], 'Забронировать');
  const siteB = await request(app).get('/api/public/demo-b/site');
  assert.equal(siteB.body.texts.ru['hero.title'], 'Апартаменты в самой высокой башне ЖК Хайвил', 'у аккаунта Б свои тексты');
  assert.equal((await request(app).put('/api/admin/site-texts').set(admin.auth).send({ lang: 'ru', values: { 'hack.key': 'x' } })).status, 400);
  assert.equal((await request(app).put('/api/admin/site-texts').set(admin.auth).send({ lang: 'de', values: {} })).status, 400);
});

test('бренд: цвета, название, логотип вместо заглушки', async () => {
  const p = await request(app).patch('/api/admin/brand').set(owner.auth).send({ name: 'The Address Plus', colors: { brand: '#123456' } });
  assert.equal(p.status, 200); assert.equal(p.body.colors.brand, '#123456'); assert.equal(p.body.colors.accent, '#c9824f');
  assert.equal((await request(app).patch('/api/admin/brand').set(owner.auth).send({ colors: { brand: 'red' } })).status, 400);
  const logo = await request(app).post('/api/admin/brand/logo').set(owner.auth).attach('logo', png(64, 64, [11, 59, 74]), 'logo.png');
  assert.equal(logo.status, 201); assert.match(logo.body.logoUrl, /^\/uploads\/.+\.png$/);
  const site = await request(app).get('/api/public/astana-stay/site');
  assert.equal(site.body.brand.name, 'The Address Plus'); assert.equal(site.body.brand.logoUrl, logo.body.logoUrl);
  assert.equal((await request(app).get(logo.body.logoUrl)).status, 200);
  const del = await request(app).delete('/api/admin/brand/logo').set(owner.auth);
  assert.equal(del.body.logoUrl, null);
  assert.equal((await request(app).get(logo.body.logoUrl)).status, 404, 'старый файл удалён');
  await request(app).patch('/api/admin/brand').set(owner.auth).send({ name: 'The Address', colors: { brand: '#17191d' } });
});
