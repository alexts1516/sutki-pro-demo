// Разбор prisma/schema.prisma в простое описание моделей для Prisma-в-памяти (demo/prisma-memory.js).
// Нужен статическому демо: тот же код сервера работает в браузере без базы.
const SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes']);

/** Аргументы вида fields: [a, b], references: [id], onDelete: Cascade, "Имя" */
function parseArgs(s) {
  const out = { _pos: [] };
  const parts = []; let depth = 0, cur = '', q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && (ch === '[' || ch === '(')) depth++;
    if (!q && (ch === ']' || ch === ')')) depth--;
    if (!q && depth === 0 && ch === ',') { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  for (const p of parts) {
    const m = p.match(/^(\w+)\s*:\s*(.+)$/s);
    const val = (v) => v.startsWith('[') ? v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean) : v.startsWith('"') ? JSON.parse(v) : v;
    if (m) out[m[1]] = val(m[2].trim()); else out._pos.push(val(p));
  }
  return out;
}

/** Атрибуты поля: @id @unique @default(...) @updatedAt @relation(...) */
function parseAttrs(s) {
  const attrs = {}; let i = 0;
  while ((i = s.indexOf('@', i)) !== -1) {
    const m = s.slice(i).match(/^@([\w.]+)/); if (!m) { i++; continue; }
    let j = i + m[0].length, args = null;
    if (s[j] === '(') { let d = 0, k = j, q = false; for (; k < s.length; k++) { if (s[k] === '"') q = !q; if (q) continue; if (s[k] === '(') d++; if (s[k] === ')') { d--; if (!d) break; } } args = s.slice(j + 1, k); j = k + 1; }
    attrs[m[1]] = args; i = j;
  }
  return attrs;
}

function parseDefault(a) {
  if (a == null) return null;
  const t = a.trim();
  const fn = t.match(/^(\w+)\(\)$/); if (fn) return { fn: fn[1] };
  if (t.startsWith('"')) return { value: JSON.parse(t) };
  if (t === 'true' || t === 'false') return { value: t === 'true' };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { value: Number(t) };
  return { value: t };
}

export function parseSchema(text) {
  const models = {}, enums = new Set();
  const src = text.replace(/\/\/\/?[^\n]*/g, '');
  for (const m of src.matchAll(/^enum\s+(\w+)\s*\{/gm)) enums.add(m[1]);
  for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const model = { name: m[1], fields: {}, uniques: [], id: ['id'] };
    for (const raw of m[2].split('\n')) {
      const line = raw.trim(); if (!line) continue;
      if (line.startsWith('@@')) {
        const a = parseAttrs(line.slice(1));
        if (a.unique != null) model.uniques.push(parseArgs(a.unique)._pos[0] || parseArgs(a.unique).fields);
        if (a.id != null) model.id = parseArgs(a.id)._pos[0] || parseArgs(a.id).fields;
        continue;
      }
      const f = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/); if (!f) continue;
      const [, name, type, list, opt, rest] = f;
      const a = parseAttrs(rest);
      const field = { name, type, kind: SCALARS.has(type) ? 'scalar' : enums.has(type) ? 'enum' : 'object', isList: !!list, isRequired: !opt && !list };
      if ('id' in a) { field.isId = true; model.id = [name]; }
      if ('unique' in a) { field.isUnique = true; model.uniques.push([name]); }
      if ('default' in a) field.default = parseDefault(a.default);
      if ('updatedAt' in a) field.isUpdatedAt = true;
      if (field.kind === 'object') {
        const r = a.relation != null ? parseArgs(a.relation) : { _pos: [] };
        field.relationName = r.name || r._pos.find(x => typeof x === 'string' && !Array.isArray(x)) || null;
        if (r.fields) { field.fromFields = r.fields; field.toFields = r.references; field.onDelete = r.onDelete || null; }
      }
      model.fields[name] = field;
    }
    models[model.name] = model;
  }
  // обратная сторона связей: где лежит внешний ключ
  for (const model of Object.values(models)) {
    for (const f of Object.values(model.fields)) {
      if (f.kind !== 'object' || f.fromFields) continue;
      const other = models[f.type];
      const back = Object.values(other.fields).find(g => g.kind === 'object' && g.type === model.name && g.fromFields && (g.relationName || null) === (f.relationName || null));
      if (!back) throw new Error(`Нет пары для связи ${model.name}.${f.name}`);
      f.backOf = back.name;
    }
  }
  return models;
}
