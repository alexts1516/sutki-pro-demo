import { publicRef } from '../src/lib/publicDtos.js';
// Квартиры и много фото с подписями, порядком и обложкой.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, login, prisma, request, png, config } from './helpers.js';

const { app } = makeApp();
let owner, admin, ownerB, aptId, photos;
before(async () => {
  owner = await login(app, 'azamat@astanastay.example');
  admin = await login(app, 'alina@astanastay.example');
  ownerB = await login(app, 'owner@demo-b.example');
});
after(() => prisma.$disconnect());

test('создание квартиры с проверкой данных', async () => {
  const bad = await request(app).post('/api/admin/apartments').set(admin.auth).send({ title: 'x' });
  assert.equal(bad.status, 400); assert.ok(bad.body.details.length);
  const r = await request(app).post('/api/admin/apartments').set(admin.auth).send({
    title: 'ЖК Хайвил, кв. 200', address: 'пр. Кошкарбаева, 10/1, блок G-2, кв. 200', district: 'Есиль', rooms: '2-комн.', maxGuests: 4, basePriceKzt: 36000,
    petsAllowed: true, petFeeKzt: 5000, lockCode: '4321', wifiName: 'Stay_200', wifiPassword: 'secret200',
  });
  assert.equal(r.status, 201); aptId = r.body.id;
  assert.equal(r.body.photos.length, 0);
});

test('загрузка 6 фото за раз с подписями; первое — обложка', async () => {
  const caps = ['Вид', 'Гостиная', 'Кухня', 'Ванная', 'Спальня', 'Балкон'];
  let req = request(app).post(`/api/admin/apartments/${aptId}/photos`).set(admin.auth);
  caps.forEach((c, i) => { req = req.attach('photos', png(10 + i, 8, [40 * i, 90, 160]), `p${i}.png`).field('captions', c); });
  req = req.field('captionsEn', 'View');
  const r = await req;
  assert.equal(r.status, 201, JSON.stringify(r.body));
  photos = r.body;
  assert.equal(photos.length, 6);
  assert.deepEqual(photos.map(p => p.caption), caps);
  assert.equal(photos[0].captionEn, 'View');
  assert.equal(photos.filter(p => p.isCover).length, 1); assert.ok(photos[0].isCover);
  const file = path.join(config.storage.uploadDir, photos[1].url.replace('/uploads/', ''));
  assert.ok(fs.existsSync(file), 'файл сохранён на диск');
  const img = await request(app).get(photos[1].url);
  assert.equal(img.status, 200); assert.match(img.headers['content-type'], /image\/png/);
  // ещё 3 — «без ограничения количества»
  const more = await request(app).post(`/api/admin/apartments/${aptId}/photos`).set(owner.auth).attach('photos', png(), 'a.png').attach('photos', png(), 'b.png').attach('photos', png(), 'c.png');
  assert.equal(more.status, 201); assert.equal(more.body.length, 3);
  assert.ok(more.body.every(p => !p.isCover)); assert.deepEqual(more.body.map(p => p.sortOrder), [6, 7, 8]);
});

test('не картинки отклоняются', async () => {
  const svg = await request(app).post(`/api/admin/apartments/${aptId}/photos`).set(owner.auth).attach('photos', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
  assert.equal(svg.status, 400);
  const fake = await request(app).post(`/api/admin/apartments/${aptId}/photos`).set(owner.auth).attach('photos', Buffer.from('MZ not really a png file at all'), { filename: 'x.png', contentType: 'image/png' });
  assert.equal(fake.status, 400);
  assert.equal((await request(app).post(`/api/admin/apartments/${aptId}/photos`).set(owner.auth)).status, 400);
});

test('подпись, порядок, обложка, удаление', async () => {
  const cap = await request(app).patch(`/api/admin/photos/${photos[2].id}`).set(admin.auth).send({ caption: 'Кухня-столовая', captionEn: 'Kitchen' });
  assert.equal(cap.status, 200); assert.equal(cap.body.caption, 'Кухня-столовая');
  const ids = [photos[3].id, photos[0].id, photos[2].id];
  const ord = await request(app).put(`/api/admin/apartments/${aptId}/photos/order`).set(admin.auth).send({ ids });
  assert.equal(ord.status, 200);
  const nonCover = ord.body.filter(p => !p.isCover).map(p => p.id);
  assert.deepEqual(ord.body.map(p => p.id).slice(0, 1), [photos[0].id], 'обложка первой в выдаче');
  assert.deepEqual(nonCover.slice(0, 2), [photos[3].id, photos[2].id]);
  const cov = await request(app).post(`/api/admin/photos/${photos[4].id}/cover`).set(admin.auth);
  assert.equal(cov.body[0].id, photos[4].id); assert.equal(cov.body.filter(p => p.isCover).length, 1);
  assert.equal((await request(app).put(`/api/admin/apartments/${aptId}/photos/order`).set(ownerB.auth).send({ ids })).status, 404);
  const del = await request(app).delete(`/api/admin/photos/${photos[4].id}`).set(admin.auth);
  assert.equal(del.status, 200);
  const a = await request(app).get(`/api/admin/apartments/${aptId}`).set(admin.auth);
  assert.equal(a.body.photos.length, 8); assert.equal(a.body.photos.filter(p => p.isCover).length, 1, 'новая обложка выбрана автоматически');
});

test('сайт гостей получает фото с подписями, но не коды доступа', async () => {
  const list = await request(app).get('/api/public/astana-stay/apartments');
  const apt = await prisma.apartment.findUnique({where:{id:aptId}});
  const ref = publicRef(config,apt.accountId,aptId);
  const a = list.body.find(x => x.ref === ref);
  assert.ok(a); assert.equal(a.photos.length, 8); assert.equal(a.cover.url, a.photos[0].url);
  assert.ok(a.photos.some(p => p.caption === 'Кухня-столовая'));
  assert.doesNotMatch(JSON.stringify(list.body), /lockCode|wifiPassword|secret200|keyboxCode/);
  const en = await request(app).get(`/api/public/astana-stay/apartments/${ref}?lang=en`);
  assert.ok(en.body.photos.some(p => p.caption === 'Kitchen')); assert.ok(Array.isArray(en.body.busy));
});

test('удалять квартиру может только владелец', async () => {
  assert.equal((await request(app).delete(`/api/admin/apartments/${aptId}`).set(admin.auth)).status, 403);
  assert.equal((await request(app).delete(`/api/admin/apartments/${aptId}`).set(owner.auth)).status, 200);
  assert.equal(await prisma.apartmentPhoto.count({ where: { apartmentId: aptId } }), 0);
});
