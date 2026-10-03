// jsonwebtoken для статического демо: токен — просто данные в base64 (никакой секретности, всё и так в браузере).
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s) => decodeURIComponent(escape(atob(s)));
const ttl = (v) => { const m = String(v || '').match(/^(\d+)([smhd])$/); return m ? Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : Number(v) || 0; };
export function sign(payload, _secret, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  return 'demo.' + b64(JSON.stringify({ ...payload, iat: now, ...(opts.expiresIn ? { exp: now + ttl(opts.expiresIn) } : {}) }));
}
export function verify(token) {
  if (!String(token).startsWith('demo.')) throw new Error('invalid token');
  const p = JSON.parse(unb64(String(token).slice(5)));
  if (p.exp && p.exp * 1000 < Date.now()) throw new Error('jwt expired');
  return p;
}
export default { sign, verify };
