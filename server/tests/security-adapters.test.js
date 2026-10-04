// Ограничение попыток входа и запросов к ссылкам; S3-хранилище (подпись AWS SigV4); слежение за рейсами (AeroDataBox, без сети);
// страницы приложения команды и одной задачи по ссылке.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, prisma, request, config, PASS, png, freeDates } from './helpers.js';
import { extDriver } from './helpers.js';
import { signV4, createS3Storage } from '../src/storage/s3.js';
import { createFlightTracker } from '../src/flights/index.js';
import { createAeroDataBox, parseArrival } from '../src/flights/aerodatabox.js';

after(() => prisma.$disconnect());
const limited = (rl) => makeApp({ config: { ...config, rateLimit: { loginMax: 3, loginWindowMin: 15, ipMax: 5, linkMax: 1000, linkBadMax: 4, linkWindowMin: 15, ...rl } } }).app;

test('вход: после 3 неверных паролей — 429 с Retry-After, даже с верным паролем; другие логины — до лимита на IP', async () => {
  const app = limited();
  const bad = (login) => request(app).post('/api/auth/login').send({ login, password: 'wrong-password' });
  for (let i = 0; i < 3; i++) assert.equal((await bad('azamat@astanastay.example')).status, 401);
  const blocked = await request(app).post('/api/auth/login').send({ login: 'azamat@astanastay.example', password: PASS });
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers['retry-after']) > 0); assert.match(blocked.body.error, /Слишком много попыток/);
  // другой логин с того же IP пускает (неудачных с IP пока 3 из 5)
  assert.equal((await request(app).post('/api/auth/login').send({ login: 'alina@astanastay.example', password: PASS })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await bad('alina@astanastay.example')).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ login: 'gulnara@astanastay.example', password: PASS })).status, 429, 'лимит на IP');
  // слишком длинный пароль не доходит до bcrypt
  assert.equal((await request(limited()).post('/api/auth/login').send({ login: 'azamat@astanastay.example', password: 'x'.repeat(5000) })).status, 400);
});

test('удачный вход сбрасывает счётчик логина', async () => {
  const app = limited();
  for (let i = 0; i < 2; i++) await request(app).post('/api/auth/login').send({ login: 'azamat@astanastay.example', password: 'nope-nope' });
  assert.equal((await request(app).post('/api/auth/login').send({ login: 'azamat@astanastay.example', password: PASS })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await request(app).post('/api/auth/login').send({ login: 'azamat@astanastay.example', password: 'nope-nope' })).status, 401);
});

test('ссылки без входа: перебор токенов блокируется (429), общий лимит запросов с IP', async () => {
  const app = limited();
  for (let i = 0; i < 4; i++) assert.equal((await request(app).get(`/api/task-link/${'x'.repeat(20)}${i}`)).status, 404);
  const r = await request(app).get('/api/transfer-link/' + 'y'.repeat(24));
  assert.equal(r.status, 429); assert.ok(r.headers['retry-after']);
  const app2 = limited({ linkMax: 3 });
  for (let i = 0; i < 3; i++) assert.notEqual((await request(app2).get(`/api/link/${'z'.repeat(20)}`)).status, 429);
  assert.equal((await request(app2).get(`/api/link/${'z'.repeat(20)}`)).status, 429);
});

test('страницы: приложение команды /app/ и одна задача по ссылке /link/:token (вид ссылки — /api/link/:token)', async () => {
  const { app } = makeApp();
  const a = await request(app).get('/app/');
  assert.equal(a.status, 200); assert.match(a.text, /Сутки·Pro/); assert.match(a.headers['content-type'], /html/);
  const task = await prisma.repairTask.findFirst({ where: { linkToken: { not: null }, status: { notIn: ['DONE', 'CANCELLED'] } } });
  const l = await request(app).get(`/link/${task.linkToken}`);
  assert.equal(l.status, 200); assert.match(l.text, /link\.js/);
  assert.deepEqual((await request(app).get(`/api/link/${task.linkToken}`)).body, { kind: 'task' });
  // ссылка внешнего водителя (в демо-данных их нет — внешние водители выключены): ставим ссылку заказу напрямую
  const job = await prisma.transferJob.update({ where: { id: (await prisma.transferJob.findFirst()).id }, data: { linkToken: 'tl_' + Date.now().toString(36) + 'abcdefgh', driverContractorId: (await extDriver((await prisma.transferJob.findFirst()).accountId)).id } });
  assert.deepEqual((await request(app).get(`/api/link/${job.linkToken}`)).body, { kind: 'transfer' });
  assert.equal((await request(app).get('/api/link/short')).status, 404);
});

test('S3: подпись SigV4 совпадает с официальным примером AWS (GET Object)', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — Example: GET Object
  const h = signV4({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('S3: сохранение и удаление через S3-совместимый адрес (запросы подменены), без ключей — понятная ошибка', async () => {
  const reqs = [];
  const fetchImpl = async (url, init) => { reqs.push({ url, ...init }); return { ok: true, status: 200, text: async () => '' }; };
  const s3 = createS3Storage({ bucket: 'photos', region: 'ru-central1', endpoint: 'https://storage.yandexcloud.net', publicUrl: 'https://cdn.example.kz', accessKeyId: 'AK', secretAccessKey: 'SK' }, { fetchImpl });
  const img = png();
  const saved = await s3.save('acc1/apartments/a1/x.png', img, 'image/png');
  assert.equal(saved.url, 'https://cdn.example.kz/acc1/apartments/a1/x.png');
  assert.equal(reqs[0].method, 'PUT'); assert.equal(reqs[0].url, 'https://storage.yandexcloud.net/photos/acc1/apartments/a1/x.png');
  assert.match(reqs[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/ru-central1\/s3\/aws4_request/);
  assert.equal(reqs[0].headers['content-type'], 'image/png'); assert.equal(reqs[0].headers.host, undefined);
  await s3.remove('acc1/apartments/a1/x.png');
  assert.equal(reqs[1].method, 'DELETE');
  assert.throws(() => createS3Storage({ bucket: '', accessKeyId: '', secretAccessKey: '' }), /S3_BUCKET/);
  const failing = createS3Storage({ bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, { fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'AccessDenied' }) });
  await assert.rejects(failing.save('k.png', img, 'image/png'), /403/);
});

test('рейсы: без ключа слежения нет; AeroDataBox разбирается без сети; задержка сдвигает подачу и пишет водителю и менеджерам', async () => {
  assert.equal(createFlightTracker({}), null);
  assert.equal(createFlightTracker({ aerodataboxKey: 'k' }).name, 'aerodatabox');
  const parsed = parseArrival([{ status: 'Delayed', arrival: { airport: { iata: 'NQZ' }, scheduledTime: { utc: '2026-11-02 04:10Z' }, revisedTime: { utc: '2026-11-02 05:05Z' } } }]);
  assert.equal(parsed.status, 'задерживается'); assert.equal(parsed.expectedAt.toISOString(), '2026-11-02T05:05:00.000Z');
  let asked = null;
  const adb = createAeroDataBox({ key: 'KEY', fetchImpl: async (url, init) => { asked = { url, init }; return { ok: true, status: 200, json: async () => [] }; } });
  assert.equal(await adb.arrival({ flight: 'KC 852', date: '2026-11-02' }), null);
  assert.match(asked.url, /\/flights\/number\/KC852\/2026-11-02\?dateLocalRole=Arrival/); assert.equal(asked.init.headers['X-RapidAPI-Key'], 'KEY');
  assert.equal(await adb.arrival({ flight: 'not a flight!', date: '2026-11-02' }), null, 'мусор не отправляем');

  // поддельный трекер: рейс задерживается на 55 минут
  const tracker = { name: 'fake', calls: 0, async arrival({ flight }) { this.calls++; return { status: 'задерживается', expectedAt: new Date(job.pickupAt.getTime() + 55 * 60000), landed: false, cancelled: false, flight }; } };
  const { app, events } = makeApp({ flights: tracker });
  const owner = await login(app, 'azamat@astanastay.example');
  const acc = await prisma.account.findUnique({ where: { slug: 'astana-stay' } });
  const apt = await prisma.apartment.findFirst({ where: { accountId: acc.id, petsAllowed: false } });
  const dates = await freeDates(acc.id, apt.id, 2, 700);
  const b = await request(app).post('/api/public/astana-stay/bookings').send({ apartmentId: apt.id, ...dates, guests: 1, name: 'Тест Рейс', phone: '+7 700 000 00 01', paymentMethod: 'card' });
  const t = await request(app).post('/api/public/astana-stay/transfers').send({ bookingToken: b.body.token, direction: 'in', place: 'airport', date: dates.checkIn, time: '10:00', flight: 'KC 852' });
  await request(app).post(`/api/admin/bookings/${(await prisma.booking.findUnique({ where: { token: b.body.token } })).id}/confirm`).set(owner.auth);
  let job = await prisma.transferJob.findUnique({ where: { transferId: t.body.id } });
  const ruslan = await prisma.user.findFirst({ where: { email: 'ruslan@astanastay.example' } });
  await app.locals.dispatch.assign({ job: await prisma.transferJob.findUnique({ where: { id: job.id }, include: { transfer: true } }), actor: { type: 'owner', name: 'Тест' }, driverUserId: ruslan.id });
  job = await prisma.transferJob.findUnique({ where: { id: job.id } });
  const now = new Date(job.pickupAt.getTime() - 3 * 3600000);
  // владелец выключил слежение — запросов нет
  await prisma.accountSettings.upsert({ where: { accountId: acc.id }, update: { flightTracking: false }, create: { accountId: acc.id, flightTracking: false } });
  await app.locals.dispatch.checkFlights({ now }); assert.equal(tracker.calls, 0);
  await prisma.accountSettings.update({ where: { accountId: acc.id }, data: { flightTracking: true } });
  const r = await app.locals.dispatch.checkFlights({ now });
  assert.equal(r.moved, 1); await events.idle();
  const u = await prisma.transferJob.findUnique({ where: { id: job.id }, include: { transfer: true } });
  assert.equal(u.transfer.time, '10:55'); assert.equal(u.flightStatus, 'задерживается'); assert.ok(u.flightCheckedAt);
  const logs = await prisma.notificationLog.findMany({ where: { event: 'transfer.updated', text: { contains: '10:55' }, createdAt: { gte: new Date(Date.now() - 60000) } } });
  assert.ok(logs.some(l => l.recipientType === 'driver')); assert.ok(logs.some(l => l.recipientType === 'owner'));
  // повторная проверка в течение 20 минут не делает запрос
  await app.locals.dispatch.checkFlights({ now: new Date(now.getTime() + 5 * 60000) }); assert.equal(tracker.calls, 1);
  await prisma.accountSettings.deleteMany({ where: { accountId: acc.id } });
});
