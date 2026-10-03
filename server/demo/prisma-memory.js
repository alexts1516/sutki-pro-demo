// Prisma «в памяти»: тот же API (findMany/findFirst/findUnique/create/update/updateMany/upsert/delete/deleteMany/count/groupBy,
// where/select/include/orderBy/take/skip, связи, уникальность с кодом P2002, каскадное удаление по схеме), но без базы.
// Нужен статическому демо (браузер) и проверке: все тесты сервера можно прогнать на нём (npm run test:memory).
// Каждая операция выполняется синхронно в момент вызова — поэтому «Беру» (updateMany по статусу) атомарен, как в базе.

export class PrismaClientKnownRequestError extends Error {
  constructor(message, { code, meta } = {}) { super(message); this.name = 'PrismaClientKnownRequestError'; this.code = code; this.meta = meta; this.clientVersion = 'memory'; }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && !(v instanceof Uint8Array);
const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1);
let idCounter = 0;
const cuid = () => 'c' + Date.now().toString(36) + (idCounter++ % 1679616).toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const clone = (v) => v instanceof Date ? new Date(v.getTime()) : (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;

export function createMemoryPrisma({ models, state = null, onChange = () => {} }) {
  let db = {};               // { Model: [rows] }
  let idx = {};              // { Model: Map(id -> row) }
  const meta = models;

  function load(s) {
    db = {}; idx = {};
    for (const name of Object.keys(meta)) {
      const rows = (s && s[name]) || [];
      const dates = Object.values(meta[name].fields).filter(f => f.type === 'DateTime').map(f => f.name);
      for (const r of rows) for (const k of dates) if (r[k] != null && !(r[k] instanceof Date)) r[k] = new Date(r[k]);
      db[name] = rows; idx[name] = new Map(rows.map(r => [r.id, r]));
    }
  }
  load(state);

  // ---------- значения и сравнения ----------
  const norm = (f, v) => (v == null ? v : f?.type === 'DateTime' ? new Date(v).getTime() : v);
  const eq = (f, a, b) => {
    if (f?.type === 'Json') return JSON.stringify(a) === JSON.stringify(b);
    return norm(f, a) === norm(f, b);
  };
  const toStore = (f, v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (f.type === 'DateTime') return new Date(v);
    if (f.type === 'Json') return clone(v);
    if (f.type === 'Int' || f.type === 'Float') return typeof v === 'number' ? v : Number(v);
    return v;
  };

  function matchScalar(f, val, cond) {
    if (cond === undefined) return true;
    if (cond === null) return val == null;
    if (!isPlain(cond) || f.type === 'Json' && !('equals' in cond || 'not' in cond)) return val != null && eq(f, val, cond);
    const ins = cond.mode === 'insensitive';
    const s = (x) => (ins ? String(x).toLowerCase() : String(x));
    for (const [op, c] of Object.entries(cond)) {
      if (c === undefined || op === 'mode') continue;
      switch (op) {
        case 'equals': if (c === null ? val != null : (val == null || !eq(f, val, c))) return false; break;
        case 'in': if (val == null || !c.some(x => eq(f, val, x))) return false; break;
        case 'notIn': if (val == null || c.some(x => eq(f, val, x))) return false; break;
        case 'not':
          if (c === null) { if (val == null) return false; }
          else if (isPlain(c)) { if (val == null || matchScalar(f, val, c)) return false; }
          else if (val == null || eq(f, val, c)) return false;
          break;
        case 'lt': if (val == null || !(norm(f, val) < norm(f, c))) return false; break;
        case 'lte': if (val == null || !(norm(f, val) <= norm(f, c))) return false; break;
        case 'gt': if (val == null || !(norm(f, val) > norm(f, c))) return false; break;
        case 'gte': if (val == null || !(norm(f, val) >= norm(f, c))) return false; break;
        case 'contains': if (val == null || !s(val).includes(s(c))) return false; break;
        case 'startsWith': if (val == null || !s(val).startsWith(s(c))) return false; break;
        case 'endsWith': if (val == null || !s(val).endsWith(s(c))) return false; break;
        default: throw new Error(`prisma-memory: неизвестный фильтр «${op}»`);
      }
    }
    return true;
  }

  // ---------- связи ----------
  function relOne(model, f, row) {
    if (f.fromFields) {
      const vals = f.fromFields.map(k => row[k]);
      if (vals.some(v => v == null)) return null;
      if (f.toFields.length === 1 && f.toFields[0] === 'id') return idx[f.type].get(vals[0]) || null;
      return db[f.type].find(r => f.toFields.every((k, i) => r[k] === vals[i])) || null;
    }
    const back = meta[f.type].fields[f.backOf];
    return db[f.type].find(r => back.fromFields.every((k, i) => r[k] != null && r[k] === row[back.toFields[i]])) || null;
  }
  function relMany(model, f, row) {
    const back = meta[f.type].fields[f.backOf];
    return db[f.type].filter(r => back.fromFields.every((k, i) => r[k] != null && r[k] === row[back.toFields[i]]));
  }

  function matches(name, row, where) {
    if (!where) return true;
    const M = meta[name];
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === 'AND') { if (![].concat(v).every(w => matches(name, row, w))) return false; continue; }
      if (k === 'OR') { if (!v.some(w => matches(name, row, w))) return false; continue; }
      if (k === 'NOT') { if ([].concat(v).some(w => matches(name, row, w))) return false; continue; }
      const f = M.fields[k];
      if (!f) { if (isPlain(v)) { if (!matches(name, row, v)) return false; continue; } throw new Error(`prisma-memory: ${name}.${k} — нет такого поля`); }
      if (f.kind !== 'object') { if (!matchScalar(f, row[k], v)) return false; continue; }
      if (f.isList) {
        const list = relMany(name, f, row);
        if (v.some && !list.some(r => matches(f.type, r, v.some))) return false;
        if (v.none && list.some(r => matches(f.type, r, v.none))) return false;
        if (v.every && !list.every(r => matches(f.type, r, v.every))) return false;
        continue;
      }
      const rel = relOne(name, f, row);
      if (v === null) { if (rel) return false; continue; }
      if ('is' in v || 'isNot' in v) {
        if ('is' in v && (v.is === null ? rel : !rel || !matches(f.type, rel, v.is))) return false;
        if ('isNot' in v && (v.isNot === null ? !rel : rel && matches(f.type, rel, v.isNot))) return false;
        continue;
      }
      if (!rel || !matches(f.type, rel, v)) return false;
    }
    return true;
  }

  // ---------- сортировка ----------
  function cmpVal(f, a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;            // как в SQLite: пусто — раньше
    if (b == null) return 1;
    a = norm(f, a); b = norm(f, b);
    if (typeof a === 'boolean') { a = +a; b = +b; }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function sorter(name, orderBy) {
    const list = [].concat(orderBy || []).flatMap(o => Object.entries(o).map(([k, v]) => ({ k, v })));
    if (!list.length) return null;
    return (x, y) => {
      for (const { k, v } of list) {
        const f = meta[name].fields[k];
        let c;
        if (k === '_count' || (f && f.kind === 'object' && f.isList)) {
          const [[rk, dir]] = Object.entries(k === '_count' ? v : { _count: v._count });
          const rf = meta[name].fields[rk];
          c = relMany(name, rf, x).length - relMany(name, rf, y).length; if (dir === 'desc') c = -c;
        } else if (f && f.kind === 'object') {
          const a = relOne(name, f, x), b = relOne(name, f, y);
          c = sorter(f.type, v)(a || {}, b || {});
        } else {
          const dir = isPlain(v) ? v.sort : v; const nulls = isPlain(v) ? v.nulls : null;
          const a = x[k], b = y[k];
          if (nulls && (a == null) !== (b == null)) c = (a == null) === (nulls === 'first') ? -1 : 1;
          else { c = cmpVal(f, a, b); if (dir === 'desc') c = -c; }
        }
        if (c) return c;
      }
      return 0;
    };
  }

  // ---------- выборка полей ----------
  function project(name, row, args = {}) {
    const M = meta[name];
    const out = {};
    const sel = args.select, inc = args.include;
    if (sel) {
      for (const [k, v] of Object.entries(sel)) {
        if (!v) continue;
        if (k === '_count') { out._count = counts(name, row, v); continue; }
        const f = M.fields[k]; if (!f) throw new Error(`prisma-memory: select ${name}.${k} — нет такого поля`);
        out[k] = f.kind === 'object' ? relValue(name, f, row, v) : clone(row[k] ?? null);
      }
      return out;
    }
    for (const f of Object.values(M.fields)) if (f.kind !== 'object') out[f.name] = clone(row[f.name] ?? null);
    if (inc) for (const [k, v] of Object.entries(inc)) {
      if (!v) continue;
      if (k === '_count') { out._count = counts(name, row, v); continue; }
      const f = M.fields[k]; if (!f) throw new Error(`prisma-memory: include ${name}.${k} — нет такого поля`);
      out[k] = relValue(name, f, row, v);
    }
    return out;
  }
  function counts(name, row, v) {
    const M = meta[name]; const out = {};
    const keys = v === true ? Object.values(M.fields).filter(f => f.isList).map(f => [f.name, true]) : Object.entries(v.select || {});
    for (const [k, c] of keys) { if (!c) continue; const f = M.fields[k]; out[k] = relMany(name, f, row).filter(r => matches(f.type, r, c === true ? null : c.where)).length; }
    return out;
  }
  function relValue(name, f, row, v) {
    const a = v === true ? {} : v;
    if (!f.isList) { const r = relOne(name, f, row); return r && (!a.where || matches(f.type, r, a.where)) ? project(f.type, r, a) : null; }
    return pick(f.type, relMany(name, f, row), a).map(r => project(f.type, r, a));
  }
  function pick(name, rows, a = {}) {
    let list = rows.filter(r => matches(name, r, a.where));
    const s = sorter(name, a.orderBy); if (s) list = [...list].sort(s);
    if (a.distinct) { const seen = new Set(); list = list.filter(r => { const key = JSON.stringify([].concat(a.distinct).map(k => r[k])); if (seen.has(key)) return false; seen.add(key); return true; }); }
    const skip = a.skip || 0;
    if (a.take != null) list = a.take >= 0 ? list.slice(skip, skip + a.take) : list.slice(Math.max(0, list.length + a.take - skip), list.length - skip);
    else if (skip) list = list.slice(skip);
    return list;
  }

  // ---------- запись ----------
  function checkUnique(name, row, self = null) {
    const M = meta[name];
    for (const group of [M.id, ...M.uniques]) {
      const vals = group.map(k => row[k]);
      if (vals.some(v => v == null)) continue;
      const clash = group.length === 1 && group[0] === 'id' ? idx[name].get(vals[0]) : db[name].find(r => group.every((k, i) => eq(M.fields[k], r[k], vals[i])));
      if (clash && clash !== self) throw new PrismaClientKnownRequestError(`Unique constraint failed on the fields: (${group.map(k => '`' + k + '`').join(',')})`, { code: 'P2002', meta: { modelName: name, target: group } });
    }
  }
  function defaultFor(name, f) {
    const d = f.default;
    if (f.isUpdatedAt) return new Date();
    if (!d) return null;
    if (d.fn === 'cuid' || d.fn === 'uuid') return d.fn === 'uuid' ? (globalThis.crypto?.randomUUID?.() || cuid()) : cuid();
    if (d.fn === 'now') return new Date();
    if (d.fn === 'autoincrement') return db[name].reduce((m, r) => Math.max(m, r[f.name] || 0), 0) + 1;
    if (f.type === 'Json' && typeof d.value === 'string') { try { return JSON.parse(d.value); } catch { return d.value; } }
    return d.value;
  }
  function applyData(name, row, data, creating) {
    const M = meta[name];
    for (const [k, v] of Object.entries(data || {})) {
      if (v === undefined) continue;
      const f = M.fields[k];
      if (!f) throw new Error(`prisma-memory: ${name}.${k} — нет такого поля`);
      if (f.kind === 'object') {
        if (isPlain(v) && v.connect && f.fromFields) { f.fromFields.forEach((fk, i) => { row[fk] = v.connect[f.toFields[i]]; }); continue; }
        if (isPlain(v) && v.disconnect && f.fromFields) { f.fromFields.forEach(fk => { row[fk] = null; }); continue; }
        throw new Error(`prisma-memory: вложенная запись ${name}.${k} не поддерживается`);
      }
      if (isPlain(v) && f.type !== 'Json') {
        if ('set' in v) row[k] = toStore(f, v.set);
        else if ('increment' in v) row[k] = (row[k] || 0) + v.increment;
        else if ('decrement' in v) row[k] = (row[k] || 0) - v.decrement;
        else if ('multiply' in v) row[k] = (row[k] || 0) * v.multiply;
        else if ('divide' in v) row[k] = (row[k] || 0) / v.divide;
        else throw new Error(`prisma-memory: ${name}.${k} — неизвестная операция`);
      } else row[k] = toStore(f, v);
    }
    if (!creating) for (const f of Object.values(M.fields)) if (f.isUpdatedAt && !(data && data[f.name] !== undefined)) row[f.name] = new Date();
  }
  function insert(name, data) {
    const M = meta[name]; const row = {};
    for (const f of Object.values(M.fields)) if (f.kind !== 'object') row[f.name] = defaultFor(name, f);
    applyData(name, row, data, true);
    for (const f of Object.values(M.fields)) if (f.kind !== 'object' && row[f.name] === undefined) row[f.name] = null;
    checkUnique(name, row);
    db[name].push(row); idx[name].set(row.id, row);
    return row;
  }
  function update(name, row, data) {
    const before = { ...row };
    applyData(name, row, data, false);
    try { checkUnique(name, row, row); } catch (e) { Object.assign(row, before); throw e; }
    if (before.id !== row.id) { idx[name].delete(before.id); idx[name].set(row.id, row); }
    return row;
  }
  function remove(name, row) {
    // сначала зависимые записи: Cascade — удалить, SetNull (или необязательная связь без правила) — обнулить ключ, иначе — ошибка
    for (const other of Object.values(meta)) {
      for (const g of Object.values(other.fields)) {
        if (g.kind !== 'object' || !g.fromFields || g.type !== name) continue;
        const deps = db[other.name].filter(r => g.fromFields.every((k, i) => r[k] != null && r[k] === row[g.toFields[i]]));
        if (!deps.length) continue;
        const rule = g.onDelete || (g.isRequired ? 'Restrict' : 'SetNull');
        if (rule === 'Cascade') deps.forEach(d => remove(other.name, d));
        else if (rule === 'SetNull') deps.forEach(d => g.fromFields.forEach(k => { d[k] = null; }));
        else throw new PrismaClientKnownRequestError(`Foreign key constraint failed on the field: ${other.name}.${g.name}`, { code: 'P2003', meta: { field_name: g.name } });
      }
    }
    const i = db[name].indexOf(row); if (i >= 0) db[name].splice(i, 1);
    idx[name].delete(row.id);
  }
  const notFound = (name, op) => new PrismaClientKnownRequestError(`An operation failed because it depends on one or more records that were required but not found. No record was found for ${op} (${name}).`, { code: 'P2025', meta: { modelName: name, cause: 'Record to ' + op + ' not found.' } });
  const findOne = (name, where) => (where && Object.keys(where).length === 1 && typeof where.id === 'string') ? (idx[name].get(where.id) || null) : (db[name].find(r => matches(name, r, where)) || null);

  // ---------- делегаты моделей ----------
  function delegate(name) {
    const changed = () => onChange(name);
    return {
      async findMany(a = {}) { return pick(name, db[name], a).map(r => project(name, r, a)); },
      async findFirst(a = {}) { const r = pick(name, db[name], { ...a, take: 1 })[0]; return r ? project(name, r, a) : null; },
      async findFirstOrThrow(a = {}) { const r = pick(name, db[name], { ...a, take: 1 })[0]; if (!r) throw notFound(name, 'find'); return project(name, r, a); },
      async findUnique(a = {}) { const r = findOne(name, a.where); return r ? project(name, r, a) : null; },
      async findUniqueOrThrow(a = {}) { const r = findOne(name, a.where); if (!r) throw notFound(name, 'find'); return project(name, r, a); },
      async count(a = {}) { return pick(name, db[name], a).length; },
      async create(a = {}) { const r = insert(name, a.data); changed(); return project(name, r, a); },
      async createMany(a = {}) { let n = 0; for (const d of [].concat(a.data || [])) { try { insert(name, d); n++; } catch (e) { if (!(a.skipDuplicates && e.code === 'P2002')) throw e; } } if (n) changed(); return { count: n }; },
      async update(a = {}) { const r = findOne(name, a.where); if (!r) throw notFound(name, 'update'); update(name, r, a.data); changed(); return project(name, r, a); },
      async updateMany(a = {}) { const list = db[name].filter(r => matches(name, r, a.where)); for (const r of list) update(name, r, a.data); if (list.length) changed(); return { count: list.length }; },
      async upsert(a = {}) { const r = findOne(name, a.where); const out = r ? update(name, r, a.update) : insert(name, a.create); changed(); return project(name, out, a); },
      async delete(a = {}) { const r = findOne(name, a.where); if (!r) throw notFound(name, 'delete'); const out = project(name, r, a); remove(name, r); changed(); return out; },
      async deleteMany(a = {}) { const list = db[name].filter(r => matches(name, r, a.where)); for (const r of list) remove(name, r); if (list.length) changed(); return { count: list.length }; },
      async aggregate(a = {}) {
        const list = pick(name, db[name], a); const out = {};
        if (a._count) out._count = a._count === true ? list.length : Object.fromEntries(Object.keys(a._count).map(k => [k, k === '_all' ? list.length : list.filter(r => r[k] != null).length]));
        for (const op of ['_sum', '_avg', '_min', '_max']) if (a[op]) out[op] = Object.fromEntries(Object.keys(a[op]).map(k => {
          const vals = list.map(r => r[k]).filter(v => v != null);
          if (!vals.length) return [k, null];
          return [k, op === '_sum' ? vals.reduce((s, v) => s + v, 0) : op === '_avg' ? vals.reduce((s, v) => s + v, 0) / vals.length : op === '_min' ? vals.reduce((m, v) => (v < m ? v : m)) : vals.reduce((m, v) => (v > m ? v : m))];
        }));
        return out;
      },
      async groupBy(a = {}) {
        const list = db[name].filter(r => matches(name, r, a.where));
        const groups = new Map();
        for (const r of list) { const key = JSON.stringify(a.by.map(k => r[k] instanceof Date ? r[k].getTime() : r[k])); (groups.get(key) || groups.set(key, []).get(key)).push(r); }
        return [...groups.values()].map(rows => {
          const o = Object.fromEntries(a.by.map(k => [k, clone(rows[0][k])]));
          if (a._count) o._count = a._count === true ? rows.length : Object.fromEntries(Object.keys(a._count).map(k => [k, k === '_all' ? rows.length : rows.filter(r => r[k] != null).length]));
          if (a._sum) o._sum = Object.fromEntries(Object.keys(a._sum).map(k => [k, rows.reduce((s, r) => s + (r[k] || 0), 0)]));
          return o;
        });
      },
    };
  }

  const client = {
    async $connect() {}, async $disconnect() {},
    async $transaction(arg) { return typeof arg === 'function' ? arg(client) : Promise.all(arg); },
    async $queryRaw() { return [{ ok: 1 }]; },
    async $executeRaw() { return 0; },
    $on() {}, $use() {}, $extends() { return client; },
    /** снимок всех таблиц (для сохранения в браузере) и загрузка снимка */
    $dump() { return db; },
    $load(s) { load(s); },
    $models: meta,
  };
  for (const name of Object.keys(meta)) client[lowerFirst(name)] = delegate(name);
  return client;
}
