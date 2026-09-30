import './_env.js';
import request from 'supertest';
import zlib from 'node:zlib';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createEventBus } from '../src/notifications/events.js';
import { createNotificationService } from '../src/notifications/service.js';
import { createStorage } from '../src/storage/index.js';

export { prisma, config, request };
export const PASS = 'demo12345';

/** Приложение для тестов. transport — подменный «бот» (или null — бот выключен). */
export function makeApp({ transport = null, payments = null } = {}) {
  const events = createEventBus({ logger: { error() {} } });
  const notifier = createNotificationService({ prisma, transport, quiet: true, logger: { warn() {}, error() {} } });
  notifier.register(events);
  const storage = createStorage(config.storage);
  const app = createApp({ config, events, storage, payments, logger: { error() {}, warn() {}, log() {} } });
  return { app, events, notifier, storage };
}

export async function login(app, email) {
  const res = await request(app).post('/api/auth/login').send({ login: email, password: PASS });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` }, me: res.body };
}

/** Маленькая настоящая PNG-картинка (w×h, один цвет) */
export function png(w = 8, h = 6, rgb = [200, 80, 40]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3); }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const isoIn = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/** Свободные даты для квартиры (для заявок в тестах) */
export async function freeDates(accountId, apartmentId, len = 2, startIn = 30) {
  for (let s = startIn; s < startIn + 200; s++) {
    const ci = new Date(isoIn(s) + 'T00:00:00Z'), co = new Date(ci.getTime() + len * 86400000);
    const clash = await prisma.booking.findFirst({ where: { accountId, apartmentId, status: { in: ['request', 'confirmed'] }, checkIn: { lt: co }, checkOut: { gt: ci } } });
    if (!clash) return { checkIn: ci.toISOString().slice(0, 10), checkOut: co.toISOString().slice(0, 10) };
  }
  throw new Error('нет свободных дат');
}
