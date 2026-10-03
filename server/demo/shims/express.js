// Маленький Express для браузера (статическое демо): Router, use/get/post/put/patch/delete, :параметры,
// цепочки middleware, async-ошибки как в Express 5, обработчики ошибок (err, req, res, next).
// Маршруты сервера (src/routes) работают с ним без изменений.
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

function compile(path, end) {
  const keys = [];
  const segs = String(path || '/').split('/').filter(Boolean).map(s => {
    if (s.startsWith(':')) { keys.push(s.slice(1)); return '([^/]+)'; }
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const re = new RegExp('^' + (segs.length ? '/' + segs.join('/') : '') + (end ? '/?$' : '(?=/|$)'), 'i');
  return (p) => {
    const m = re.exec(p); if (!m) return null;
    const params = {}; keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
    return { params, matched: m[0] };
  };
}

export function Router(opts = {}) {
  const layers = [];
  function router(req, res, next) { return router.handle(req, res, next); }
  router.handle = (req, res, out) => {
    let i = 0;
    const parentParams = req.params || {};
    const next = (err) => {
      if (err === 'route') err = undefined;
      if (err === 'router') return out();
      while (i < layers.length) {
        const L = layers[i++];
        const path = (req.url.split('?')[0]) || '/';
        const m = L.match(path); if (!m) continue;
        if (L.method && L.method !== 'all' && L.method !== req.method.toLowerCase() && !(L.method === 'get' && req.method === 'HEAD')) continue;
        if (L.use) {
          const saved = { url: req.url, baseUrl: req.baseUrl, params: req.params };
          const rest = req.url.slice(m.matched.length);
          req.baseUrl = (req.baseUrl || '') + m.matched;
          req.url = rest.startsWith('/') ? rest : '/' + rest;
          req.params = { ...parentParams, ...m.params };
          const back = (e) => { req.url = saved.url; req.baseUrl = saved.baseUrl; req.params = saved.params; next(e); };
          return call(L.fn, err, req, res, back);
        }
        req.params = { ...parentParams, ...m.params };
        return call(L.fn, err, req, res, next);
      }
      req.params = parentParams;
      out(err);
    };
    next();
  };
  function call(fn, err, req, res, next) {
    let r;
    try {
      if (err) { if (fn.length === 4) r = fn(err, req, res, next); else return next(err); }
      else { if (fn.length === 4) return next(); r = fn(req, res, next); }
    } catch (e) { return next(e); }
    if (r && typeof r.then === 'function') r.then(null, (e) => next(e || new Error('Rejected')));
  }
  const add = (method, use) => (...args) => {
    let path = '/';
    if (typeof args[0] === 'string') path = args.shift();
    for (const fn of args.flat(Infinity)) {
      const h = typeof fn.handle === 'function' && fn.handle !== router.handle ? fn : fn;
      layers.push({ method, use, match: compile(path, !use), fn: h });
    }
    return router;
  };
  router.use = add(null, true);
  for (const m of METHODS) router[m] = add(m, false);
  router.route = (path) => { const o = {}; for (const m of METHODS) o[m] = (...h) => { router[m](path, ...h); return o; }; return o; };
  router.mergeParams = !!opts.mergeParams;
  return router;
}

function express() {
  const app = Router();
  app.locals = {}; app.settings = {};
  app.disable = (k) => { app.settings[k] = false; };
  app.enable = (k) => { app.settings[k] = true; };
  app.set = (k, v) => { app.settings[k] = v; return app; };
  app.listen = () => { throw new Error('В браузере сервер не запускается'); };
  return app;
}
const passThrough = () => (_req, _res, next) => next();
express.Router = Router;
express.json = passThrough;
express.raw = passThrough;
express.text = passThrough;
express.urlencoded = passThrough;
express.static = passThrough;
export const json = express.json, raw = express.raw, text = express.text, urlencoded = express.urlencoded;
export default express;
