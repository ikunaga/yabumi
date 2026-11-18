// ER 図の材料を集める。DB には触らず、次の 2 つを読むだけ。
// - src/lib/supabase/database.types.ts: 表・列・必須・外部キーの正（型にない古い表は出さない）
// - supabase/migrations/*.sql: 列の並び・SQL の型・主キー・一意・check の値の一覧・comment と -- コメント
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// ---------- database.types.ts ----------
function readTypes() {
  const src = fs.readFileSync(path.join(root, "src/lib/supabase/database.types.ts"), "utf8");
  const pub = src.slice(src.indexOf("\n  public: {"));
  const tablesSrc = pub.slice(pub.indexOf("    Tables: {"), pub.indexOf("\n    Views: {"));
  const tables = {};
  const re = /^ {6}([a-z0-9_]+): \{\n([\s\S]*?)^ {6}\}/gm;
  let m;
  while ((m = re.exec(tablesSrc))) {
    const [, name, body] = m;
    const block = (k) => {
      const b = body.match(new RegExp(`^ {8}${k}: \\{\\n([\\s\\S]*?)^ {8}\\}`, "m"));
      return b ? b[1] : "";
    };
    const row = [...block("Row").matchAll(/^ {10}([a-z0-9_]+): (.+)$/gm)].map(([, c, t]) => ({ name: c, ts: t.trim() }));
    const insertOptional = new Set([...block("Insert").matchAll(/^ {10}([a-z0-9_]+)\?:/gm)].map((x) => x[1]));
    const rels = [];
    const relSrc = body.slice(body.indexOf("Relationships: ["));
    for (const r of relSrc.matchAll(/columns: \[([^\]]*)\]\s*isOneToOne: (true|false)\s*referencedRelation: "([a-z0-9_]+)"\s*referencedColumns: \[([^\]]*)\]/g)) {
      const cols = r[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
      const refCols = r[4].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
      rels.push({ cols, to: r[3], toCols: refCols, oneToOne: r[2] === "true" });
    }
    tables[name] = { cols: row, insertOptional, rels };
  }
  return tables;
}

// ---------- migrations ----------
// 文に分ける（$$ の本文・文字列・コメントの中の ; では切らない）。コメントは残す
function statements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const e = sql.indexOf("\n", i);
      const end = e < 0 ? sql.length : e;
      cur += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const t = sql.slice(i).match(/^\$[a-z_]*\$/i);
      if (t) {
        const e = sql.indexOf(t[0], i + t[0].length);
        cur += " $BODY$ ";
        i = e + t[0].length;
        continue;
      }
    }
    if (c === ";") {
      out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const stripComments = (s) => s.replace(/--[^\n]*/g, "");

// 深さ 0 のカンマで切る。各要素に、前の行の -- コメントと同じ行の -- コメントを付ける
function splitItems(body) {
  const items = [];
  let code = "";
  let notes = [];
  let pending = [];
  let depth = 0;
  const lines = body.split("\n");
  for (const line of lines) {
    let ci = -1;
    let inStr = false;
    for (let k = 0; k < line.length; k++) {
      if (line[k] === "'") inStr = !inStr;
      if (!inStr && line[k] === "-" && line[k + 1] === "-") {
        ci = k;
        break;
      }
    }
    const lc = ci >= 0 ? line.slice(0, ci) : line;
    const cm = ci >= 0 ? line.slice(ci + 2).trim() : "";
    if (!lc.trim()) {
      if (cm) pending.push(cm);
      continue;
    }
    if (!code.trim() && pending.length) {
      notes.push(...pending);
      pending = [];
    }
    let endedHere = false;
    for (const ch of lc) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        items.push({ code: code.trim(), notes });
        code = "";
        notes = [];
        endedHere = true;
        continue;
      }
      code += ch;
    }
    code += " ";
    if (cm) {
      // 同じ行のコメントは、その行で終わった要素（なければ書きかけの要素）に付ける
      if (endedHere && !code.trim()) items[items.length - 1].notes.push(cm);
      else notes.push(cm);
    }
  }
  if (code.trim()) items.push({ code: code.trim(), notes: notes.concat(pending) });
  return items;
}

function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") d++;
    if (s[i] === ")" && --d === 0) return i;
  }
  return -1;
}

const enumRe = /([a-z_]+)\s+in\s*\(((?:\s*'[^']*'\s*,?)+)\)/gi;
function enumsIn(check) {
  const out = [];
  for (const m of check.matchAll(enumRe)) out.push([m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1])]);
  return out;
}

function sqlType(rest) {
  const m = rest.match(/^([a-z_]+(?:\s+(?:with(?:out)?\s+time\s+zone|varying|precision))?(?:\s*\([^)]*\))?(?:\[\])?)/i);
  return m ? m[1].replace(/\s+/g, " ").toLowerCase() : "";
}

const KEYWORD = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;

function readMigrations() {
  const dir = path.join(root, "supabase/migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const T = {}; // name -> { comment, sqlNotes, cols: Map(name -> info), pk: [], uniques: [[]] }
  const tbl = (n) => (T[n] ??= { comment: "", notes: [], cols: new Map(), pk: [], uniques: [] });
  const col = (t, c) => {
    const x = tbl(t);
    if (!x.cols.has(c)) x.cols.set(c, { sqlType: "", notes: [], comment: "", enum: null, pk: false, unique: false, refTo: null });
    return x.cols.get(c);
  };
  const applyColumn = (t, code, notes) => {
    const m = code.match(/^(?:if not exists\s+)?"?([a-z0-9_]+)"?\s+([\s\S]*)$/i);
    if (!m) return;
    const [, name, rest] = m;
    const c = col(t, name);
    c.sqlType = sqlType(rest) || c.sqlType;
    if (notes.length) c.notes = notes;
    if (/\bprimary key\b/i.test(rest)) {
      c.pk = true;
      tbl(t).pk = [name];
    }
    if (/\bunique\b/i.test(rest)) c.unique = true;
    const ref = rest.match(/references\s+(?:public\.)?([a-z0-9_.]+)/i);
    if (ref) c.refTo = ref[1];
    for (const [cn, vals] of enumsIn(rest)) if (cn === name) c.enum = vals;
  };
  const applyTableConstraint = (t, code) => {
    const pk = code.match(/primary key\s*\(([^)]*)\)/i);
    if (pk) {
      tbl(t).pk = pk[1].split(",").map((s) => s.trim().replace(/"/g, ""));
      for (const c of tbl(t).pk) col(t, c).pk = true;
    }
    const uq = code.match(/^(?:constraint\s+\S+\s+)?unique\s*(?:nulls not distinct\s*)?\(([^)]*)\)/i);
    if (uq) {
      const cs = uq[1].split(",").map((s) => s.trim());
      tbl(t).uniques.push(cs);
      if (cs.length === 1) col(t, cs[0]).unique = true;
    }
    if (/\bcheck\b/i.test(code)) for (const [cn, vals] of enumsIn(code)) if (tbl(t).cols.has(cn)) col(t, cn).enum = vals;
  };

  for (const f of files) {
    for (const st of statements(fs.readFileSync(path.join(dir, f), "utf8"))) {
      const flat = stripComments(st).replace(/\s+/g, " ").trim();
      let m;
      if ((m = flat.match(/^create table (?:if not exists )?public\.([a-z0-9_]+)\s*\(/i))) {
        const t = m[1];
        const open = st.indexOf("(", st.search(/public\./i));
        const body = st.slice(open + 1, matchParen(st, open));
        tbl(t);
        for (const it of splitItems(body)) {
          const code = stripComments(it.code).replace(/\s+/g, " ").trim();
          if (!code) continue;
          if (KEYWORD.test(code)) applyTableConstraint(t, code);
          else applyColumn(t, code, it.notes);
        }
        continue;
      }
      if ((m = flat.match(/^alter table (?:if exists )?(?:only )?public\.([a-z0-9_]+)\s+([\s\S]*)$/i))) {
        const t = m[1];
        const rest = st.slice(st.search(new RegExp(`public\\.${t}`, "i")) + 7 + t.length);
        for (const it of splitItems(rest)) {
          const code = stripComments(it.code).replace(/\s+/g, " ").trim();
          let a;
          if ((a = code.match(/^add column (.*)$/i))) applyColumn(t, a[1], it.notes);
          else if ((a = code.match(/^drop column (?:if exists )?([a-z0-9_]+)/i))) T[t]?.cols.delete(a[1]);
          else if ((a = code.match(/^add (constraint .*)$/i))) applyTableConstraint(t, a[1]);
          else if ((a = code.match(/^add (primary key.*|unique.*|check.*)$/i))) applyTableConstraint(t, a[1]);
          else if ((a = code.match(/^alter column ([a-z0-9_]+) type ([^ ]+(?: [a-z ]+)?)/i))) col(t, a[1]).sqlType = sqlType(a[2]);
        }
        continue;
      }
      if ((m = flat.match(/^comment on table public\.([a-z0-9_]+) is '([\s\S]*)'$/i))) {
        tbl(m[1]).comment = m[2].replace(/''/g, "'");
        continue;
      }
      if ((m = flat.match(/^comment on column public\.([a-z0-9_]+)\.([a-z0-9_]+) is '([\s\S]*)'$/i))) {
        col(m[1], m[2]).comment = m[3].replace(/''/g, "'");
        continue;
      }
      if ((m = flat.match(/^drop table (?:if exists )?public\.([a-z0-9_]+)/i))) delete T[m[1]];
    }
  }
  return T;
}

// 型を正にして、マイグレーションの情報を重ねる
export function loadSchema() {
  const types = readTypes();
  const mig = readMigrations();
  const out = {};
  for (const [name, t] of Object.entries(types)) {
    const g = mig[name] ?? { comment: "", cols: new Map(), pk: [], uniques: [] };
    const order = [...g.cols.keys()];
    const cols = [...t.cols].sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });
    const fkOf = {};
    // 複数列の外部キー（持ち主＋ID）は、持ち主の列を除いた列を外部キーとして出す
    for (const r of t.rels) for (const c of r.cols) if (r.cols.length === 1 || (c !== "owner_id" && c !== "user_id")) fkOf[c] = r.to;
    out[name] = {
      comment: g.comment,
      pk: g.pk,
      uniques: g.uniques,
      cols: cols.map((c) => {
        const info = g.cols.get(c.name) ?? {};
        const ref = info.refTo;
        return {
          name: c.name,
          ts: c.ts,
          sqlType: info.sqlType || "",
          nullable: c.ts.includes("| null"),
          hasDefault: t.insertOptional.has(c.name),
          pk: g.pk.includes(c.name),
          unique: !!info.unique,
          fk: fkOf[c.name] ?? null,
          authRef: ref === "auth.users",
          enum: info.enum ?? null,
          comment: info.comment || "",
          notes: info.notes || [],
        };
      }),
      rels: t.rels,
    };
  }
  return out;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const s = loadSchema();
  const n = Object.keys(s).length;
  const c = Object.values(s).reduce((a, t) => a + t.cols.length, 0);
  const r = Object.values(s).reduce((a, t) => a + t.rels.length, 0);
  console.log(`${n} 表・${c} 列・外部キー ${r} 本`);
  if (process.argv[2] === "--dump") fs.writeFileSync(process.argv[3], JSON.stringify(s, null, 1));
}
