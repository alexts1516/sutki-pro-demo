// node:crypto для демо: только то, что нужно серверу в браузере (случайные токены, сравнение строк)
import { Buffer } from 'buffer/';
export function randomBytes(n) { const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return Buffer.from(a); }
export function timingSafeEqual(a, b) { if (a.length !== b.length) throw new Error('lengths'); let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }
export function randomUUID() { return globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16) | 0).toString(16)); }
export function createHmac() { throw new Error('В демо онлайн-оплата не подключена'); }
export function createHash() { throw new Error('createHash недоступен в демо'); }
export function randomInt(a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.floor(Math.random() * (b - a)); }
export default { randomBytes, timingSafeEqual, randomUUID, createHmac, createHash, randomInt };
