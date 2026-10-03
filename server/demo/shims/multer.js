// multer для демо: файлы формы уже прочитаны слоем перехвата запросов (req._form = { fields, files })
export default function multer(opts = {}) {
  const lim = opts.limits || {};
  const check = (files) => {
    for (const f of files) {
      if (lim.fileSize && f.size > lim.fileSize) throw Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
    }
  };
  const filter = (files) => new Promise((resolve, reject) => {
    if (!opts.fileFilter) return resolve(files);
    let k = 0; const ok = [];
    const step = () => {
      if (k >= files.length) return resolve(ok);
      const f = files[k++];
      opts.fileFilter(null, f, (err, accept) => { if (err) return reject(err); if (accept) ok.push(f); step(); });
    };
    step();
  });
  const mw = (field, max, single) => async (req, _res, next) => {
    const form = req._form || { fields: {}, files: [] };
    req.body = form.fields;
    const files = form.files.filter(f => f.fieldname === field);
    if (form.files.some(f => f.fieldname !== field) || (max && files.length > max) || (lim.files && files.length > lim.files)) throw Object.assign(new Error('Unexpected field'), { code: 'LIMIT_UNEXPECTED_FILE' });
    check(files);
    const ok = await filter(files);
    if (single) req.file = ok[0]; else req.files = ok;
    next();
  };
  return { array: (field, max) => mw(field, max, false), single: (field) => mw(field, 1, true), none: () => mw('__none__', 0, false) };
}
multer.memoryStorage = () => ({});
