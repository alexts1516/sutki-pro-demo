// Глобальные объекты Node, которые ждёт код сервера: Buffer и process.env
import { Buffer } from 'buffer/';
const toString = Buffer.prototype.toString;
Buffer.prototype.toString = function (enc, ...rest) {
  if (enc === 'base64url') return toString.call(this, 'base64', ...rest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return toString.call(this, enc, ...rest);
};
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: { NODE_ENV: 'production' }, exit() {}, on() {}, platform: 'browser', version: 'v20' };
