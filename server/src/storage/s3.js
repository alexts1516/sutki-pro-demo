// S3-совместимое хранилище фото: Amazon S3, Cloudflare R2, Yandex Object Storage, DigitalOcean Spaces, MinIO.
// Включается флагом STORAGE_DRIVER=s3 (по умолчанию — локальная папка uploads/). Без внешних библиотек:
// запросы подписываются AWS Signature V4 (см. signV4 — проверено на официальном примере AWS в тестах).
//
// .env: STORAGE_DRIVER=s3, S3_BUCKET, S3_REGION (для R2 — auto, для Yandex — ru-central1), S3_ENDPOINT
//       (https://<account>.r2.cloudflarestorage.com, https://storage.yandexcloud.net; пусто — Amazon),
//       S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL (публичный адрес бакета или CDN), S3_FORCE_PATH_STYLE=true|false
import crypto from 'node:crypto';

const sha256hex = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Подпись запроса AWS SigV4. Возвращает заголовки (включая authorization), которые нужно отправить. */
export function signV4({ method, url, headers = {}, body = '', accessKeyId, secretAccessKey, region, service = 's3', now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim();
  h.host = u.host;
  h['x-amz-date'] = amzDate;
  h['x-amz-content-sha256'] = h['x-amz-content-sha256'] || (body && body.length ? sha256hex(body) : EMPTY_SHA256);
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map(k => `${k}:${h[k]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = [method, u.pathname, query, canonicalHeaders, signedHeaders, h['x-amz-content-sha256']].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, dateStamp), region), service), 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return h;
}

export function createS3Storage(opts, { fetchImpl = globalThis.fetch } = {}) {
  const missing = ['bucket', 'accessKeyId', 'secretAccessKey'].filter(k => !opts[k]);
  if (missing.length) throw new Error(`STORAGE_DRIVER=s3: не заданы ${missing.map(k => ({ bucket: 'S3_BUCKET', accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY' })[k]).join(', ')}`);
  const region = opts.region || 'us-east-1';
  const pathStyle = opts.endpoint ? opts.forcePathStyle !== false : false;
  const base = opts.endpoint || `https://s3.${region}.amazonaws.com`;
  const keyPath = (key) => key.split('/').map(enc).join('/');
  const objectUrl = (key) => pathStyle ? `${base}/${opts.bucket}/${keyPath(key)}` : `https://${opts.bucket}.s3.${region}.amazonaws.com/${keyPath(key)}`;
  const urlFor = (key) => opts.publicUrl ? `${opts.publicUrl}/${keyPath(key)}` : objectUrl(key);
  async function send(method, key, body, extra = {}) {
    const url = objectUrl(key);
    const headers = signV4({ method, url, headers: extra, body, accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, region });
    delete headers.host;   // fetch сам ставит Host по адресу
    const res = await fetchImpl(url, { method, headers, body: body && body.length ? body : undefined });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      const text = await res.text().catch(() => '');
      throw new Error(`S3 ${method} ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }
  return {
    driver: 's3',
    async read(key){return Buffer.from(await (await send('GET',key,'')).arrayBuffer());},
    async save(key, buffer, mime = 'application/octet-stream') {
      await send('PUT', key, buffer, { 'content-type': mime, 'cache-control': 'public, max-age=604800' });
      return { key, url: urlFor(key) };
    },
    async remove(key) { if (key) await send('DELETE', key); },
    urlFor,
  };
}
