// yabumi の ER 図（docs/design/database_er.html）を作る。DB には触らない。
//
// 作り直し方:
//   node scripts/er/build.mjs
//
// 材料:
//   - src/lib/supabase/database.types.ts と supabase/migrations/*.sql（schema.mjs が読む）
//   - scripts/er/names.json  … 表と列の日本語の名前・表の目的・補足（補足を書かなければマイグレーションの comment と -- コメントを使う）
//   - scripts/er/layout.json … 区分（色・説明・表）・区分ごとの図の配置・制約のない参照（点線）・読むときの注意点
//
// マイグレーションで表や列を足したら: pnpm db:types のあと、names.json に名前を足し、新しい表は layout.json の区分と図に置いて、作り直す。
// 名前の無い列・区分に無い表があると、作り直すときに一覧を出して止まる（--force で、そのまま作る）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadSchema } from "./schema.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../..");
const S = loadSchema();
const N = JSON.parse(fs.readFileSync(path.join(here, "names.json"), "utf8"));
const L = JSON.parse(fs.readFileSync(path.join(here, "layout.json"), "utf8"));
const force = process.argv.includes("--force");

// ---------- 名前 ----------
const groupOf = {};
for (const g of L.groups) for (const t of g.tables) groupOf[t] = g;
const tName = (t) => N.tables[t]?.n ?? t;
const colEntry = (t, c) => N.tables[t]?.c?.[c] ?? N.common[c];
const cName = (t, c) => {
  const e = colEntry(t, c);
  return Array.isArray(e) ? e[0] : (e ?? c);
};
const fixWords = (s) => s.replace(/\s*矢書\s*/g, " yabumi ").replace(/^ yabumi /, "yabumi ");
function cNote(t, col) {
  const e = colEntry(t, col.name);
  if (Array.isArray(e) && e[1]) return e[1];
  return fixWords(col.comment || col.notes.join(" "));
}

// 足りないものを数える
const problems = [];
for (const t of Object.keys(S)) {
  if (!groupOf[t]) problems.push(`区分に無い表: ${t}（layout.json の groups に足す）`);
  if (!N.tables[t]) problems.push(`名前の無い表: ${t}（names.json に足す）`);
  for (const c of S[t].cols) if (colEntry(t, c.name) === undefined) problems.push(`名前の無い列: ${t}.${c.name}`);
}
for (const g of L.groups) for (const t of g.tables) if (!S[t]) problems.push(`型に無い表: ${t}（layout.json から外す）`);
if (problems.length) {
  console.error(problems.join("\n"));
  if (!force) process.exit(1);
}

// ---------- 小物 ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TYPE_JA = {
  uuid: "UUID",
  text: "文字列",
  integer: "整数",
  bigint: "整数",
  smallint: "整数",
  numeric: "数値",
  boolean: "真偽",
  timestamptz: "日時",
  date: "日付",
  jsonb: "JSON",
  bytea: "バイト列",
  inet: "IP アドレス",
  "text[]": "文字列の配列",
  "bigint[]": "整数の配列",
  "uuid[]": "UUID の配列",
  "integer[]": "整数の配列",
  "char(64)": "文字列",
};
const typeJa = (c) => TYPE_JA[c.sqlType] ?? TYPE_JA[c.sqlType.replace(/\(.*\)/, "")] ?? c.sqlType;
const keyOf = (t, c) => [c.pk ? "PK" : "", c.fk ? "FK" : "", c.unique && !c.pk ? "UQ" : ""].filter(Boolean).join(" ");

// ---------- 区分の図 ----------
// 文字の幅の見積もり（全角は 1 文字、半角は 0.6 文字）
const textW = (s, px) => [...s].reduce((w, ch) => w + (/[ -~]/.test(ch) ? 0.6 : 1) * px, 0);
const BW = 210; // 箱の幅
const COLX = (i) => 24 + i * 310; // 列の x
const HEAD = 40;
const ROW = 19;
const boxRows = (t, extra, ext, present) => {
  const cols = S[t].cols;
  const want = [];
  for (const c of cols) if (c.pk) want.push(c.name);
  // ref の箱は、図の中の表を指す外部キーだけ出す
  for (const c of cols) if (c.fk && !want.includes(c.name) && (!ext || present(c.fk))) want.push(c.name);
  for (const c of extra) if (!want.includes(c)) want.push(c);
  return want.map((n) => cols.find((c) => c.name === n)).filter(Boolean);
};

function figureSvg(g, fig) {
  const boxes = {};
  const refOf = Object.fromEntries(fig.boxes.map(([t, , , , r]) => [t, r === "ref"]));
  for (const [t, ci, y, extra] of fig.boxes) {
    const ext = refOf[t];
    const skip = new Set(fig.skip ?? []);
    const rows = boxRows(t, extra, ext, (to) => to in refOf && !(ext && refOf[to])).filter((c) => !(ext && skip.has(`${t}.${c.name}`)));
    const h = HEAD + 10 + rows.length * ROW;
    boxes[t] = { t, x: COLX(ci), y, w: BW, h, ci, rows, ext, color: (groupOf[t] ?? g).color };
  }
  const rowY = (b, col) => {
    const i = b.rows.findIndex((r) => r.name === col);
    return i < 0 ? null : b.y + HEAD + 4 + i * ROW + ROW / 2 + 2;
  };
  // 線: 図に両方の箱がある外部キーと、dash
  const edges = [];
  for (const t of Object.keys(boxes)) {
    for (const r of S[t].rels) {
      const col = r.cols.find((c) => c !== "owner_id") ?? r.cols[0];
      if (!boxes[r.to]) continue;
      if (boxes[t].ext && boxes[r.to].ext) continue;
      if ((fig.skip ?? []).includes(`${t}.${col}`)) continue;
      edges.push({ from: t, col, to: r.to, toCol: r.toCols[r.cols.indexOf(col)] ?? "id", one: r.oneToOne, dash: false, label: fig.labels?.[`${t}.${col}`] });
    }
  }
  for (const [from, col, to, label] of fig.dash ?? []) edges.push({ from, col, to, toCol: null, dash: true, label });

  // 端の点を決める
  const svg = [];
  const labels = [];
  const arrive = {}; // 先の箱の辺ごとに、入ってくる線を集めて散らす
  const plans = [];
  for (const e of edges) {
    const a = boxes[e.from];
    const b = boxes[e.to];
    if (e.from === e.to) {
      plans.push({ e, self: true });
      continue;
    }
    const ay = rowY(a, e.col) ?? a.y + HEAD / 2;
    const lane = fig.lanes?.[`${e.from}.${e.col}`];
    if (a.ci !== b.ci) {
      const right = b.ci > a.ci;
      if (Math.abs(a.ci - b.ci) > 1 && lane == null) console.warn(`離れた列への線（lanes で通り道を決める）: ${fig.title} ${e.from}.${e.col} → ${e.to}`);
      const sx = right ? a.x + a.w : a.x;
      const side = `${e.to}:${right ? "L" : "R"}`;
      // 通り道を回る線は、先の箱の下（上）から入る
      if (lane == null) (arrive[side] ??= []).push(e);
      plans.push({ e, kind: "h", sx, sy: ay, right, side, lane });
    } else {
      const down = b.y > a.y;
      const side = `${e.to}:${down ? "T" : "B"}`;
      (arrive[side] ??= []).push(e);
      plans.push({ e, kind: "v", down, side });
    }
  }
  // 入ってくる点: 1 本なら先の列の行、複数なら辺に均等に並べる
  const endOf = new Map();
  for (const [side, es] of Object.entries(arrive)) {
    const [t, s] = side.split(":");
    const b = boxes[t];
    if (s === "L" || s === "R") {
      const x = s === "L" ? b.x : b.x + b.w;
      if (es.length === 1) {
        const e = es[0];
        endOf.set(e, { x, y: (e.toCol && rowY(b, e.toCol)) || b.y + HEAD + 4 + ROW / 2 + 2 });
      } else {
        const sorted = [...es].sort((p, q) => (rowY(boxes[p.from], p.col) ?? boxes[p.from].y) - (rowY(boxes[q.from], q.col) ?? boxes[q.from].y));
        let top = b.y + HEAD + 6;
        let bot = b.y + b.h - 8;
        // 行が少なくて詰まるときは、見出しの帯も使う
        if ((bot - top) / sorted.length < 18) top = b.y + 10;
        // 同じ辺から出ていく線の高さとは重ねない
        const departs = plans.filter((p) => p.kind === "h" && p.e.from === t && (p.right ? "R" : "L") === s).map((p) => p.sy);
        sorted.forEach((e, i) => {
          let y = Math.round(top + ((bot - top) * (i + 0.5)) / sorted.length);
          if (departs.some((d) => Math.abs(d - y) < 8)) y += departs.some((d) => Math.abs(d - (y + ROW / 2)) < 8) ? -ROW / 2 : ROW / 2;
          endOf.set(e, { x, y });
        });
      }
    } else {
      const y = s === "T" ? b.y : b.y + b.h;
      const sorted = [...es].sort((p, q) => boxes[p.from].x - boxes[q.from].x);
      sorted.forEach((e, i) => endOf.set(e, { x: Math.round(b.x + (b.w * (i + 1)) / (sorted.length + 1)), y }));
    }
  }
  // 同じすき間を縦に通る線を散らす
  const gapUse = {};
  for (const p of plans) {
    if (p.kind !== "h") continue;
    const a = boxes[p.e.from];
    p.gap = p.right ? a.ci : a.ci - 1; // 元の箱と先の箱のあいだのすき間
    (gapUse[p.gap] ??= []).push(p);
  }
  for (const [gap, ps] of Object.entries(gapUse)) {
    const x0 = COLX(Number(gap)) + BW + 14;
    const x1 = COLX(Number(gap) + 1) - 14;
    // 縦に長く走る線ほど先の箱の近くを通すと、線どうしが交わりにくい
    const far = (p) => Math.abs(p.sy - (endOf.get(p.e)?.y ?? p.sy));
    ps.sort((p, q) => far(q) - far(p));
    ps.forEach((p, i) => {
      const k = (i + 1) / (ps.length + 1);
      p.mx = Math.round(p.right ? x1 - (x1 - x0) * k : x0 + (x1 - x0) * k);
    });
  }

  for (const p of plans) {
    const { e } = p;
    const cls = `edge${e.dash ? " dash" : ""}`;
    const text = e.label ?? (e.dash ? "jsonb などで指す" : e.one ? "1対1" : "1対多");
    if (p.self) {
      const a = boxes[e.from];
      const y = rowY(a, e.col);
      const idx = plans.filter((q) => q.self && q.e.from === e.from).indexOf(p);
      const x = a.x + a.w;
      const out = 14 + idx * 10;
      const ty = a.y + HEAD + 4 + ROW / 2 + 2;
      svg.push(`<polyline points="${x},${y} ${x + out},${y} ${x + out},${ty - 6 + idx * 2} ${x},${ty - 6 + idx * 2}" class="${cls}"/>`);
      const n = plans.filter((q) => q.self && q.e.from === e.from).length;
      const lowest = Math.max(...plans.filter((q) => q.self && q.e.from === e.from).map((q) => rowY(a, q.e.col)));
      if (idx === 0) labels.push({ x: x + 4, y: lowest + 16, text: `同じ表を指す（${n} 本）`, anchor: "start" });
      continue;
    }
    const end = endOf.get(e);
    let pts;
    let lab;
    if (p.kind === "h") {
      if (p.lane != null) {
        // 下（上）の通り道を回る: 元の外へ → 通り道 → 先の外へ
        const a = boxes[e.from];
        const b = boxes[e.to];
        const gx1 = p.right ? COLX(a.ci) + BW + 30 : COLX(a.ci) - 30;
        const ex = Math.round(b.x + b.w * (p.right ? 0.25 : 0.75));
        const ey = p.lane > b.y ? b.y + b.h : b.y;
        pts = [
          [p.sx, p.sy],
          [gx1, p.sy],
          [gx1, p.lane],
          [ex, p.lane],
          [ex, ey],
        ];
        lab = { x: (gx1 + ex) / 2, y: p.lane - 5, anchor: "middle" };
      } else {
        pts = [
          [p.sx, p.sy],
          [p.mx, p.sy],
          [p.mx, end.y],
          [end.x, end.y],
        ];
        // 言葉は先の箱の手前の横線の上に置く
        lab = p.right ? { x: end.x - 5, y: end.y - 4, anchor: "end" } : { x: end.x + 5, y: end.y - 4, anchor: "start" };
      }
    } else {
      const a = boxes[e.from];
      const sx = end.x;
      const sy = p.down ? a.y + a.h : a.y;
      pts = [
        [sx, sy],
        [end.x, end.y],
      ];
      lab = { x: end.x + 5, y: (sy + end.y) / 2 + 4, anchor: "start" };
    }
    svg.push(`<polyline points="${pts.map((q) => q.join(",")).join(" ")}" class="${cls}"/>`);
    // 多の側に小さな印（三つ又）
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[1];
    if (!e.dash && !e.one) {
      if (y0 === y1) {
        const d = x1 > x0 ? 1 : -1;
        svg.push(`<path d="M${x0},${y0 - 5} L${x0 + 9 * d},${y0} L${x0},${y0 + 5}" class="edge"/>`);
      } else {
        const d = y1 > y0 ? 1 : -1;
        svg.push(`<path d="M${x0 - 5},${y0} L${x0},${y0 + 9 * d} L${x0 + 5},${y0}" class="edge"/>`);
      }
    }
    labels.push({ ...lab, text });
  }

  // 箱
  const boxSvg = [];
  for (const b of Object.values(boxes)) {
    const id = `t-${b.t}`;
    boxSvg.push(
      `<g${b.ext ? ' class="ext"' : ""}><a href="#${id}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="7" class="tbl"/>` +
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${HEAD}" rx="7" fill="${b.color}"/><rect x="${b.x}" y="${b.y + HEAD - 7}" width="${b.w}" height="7" fill="${b.color}"/>` +
        `<text x="${b.x + 10}" y="${b.y + 17}" class="th">${esc(tName(b.t))}${b.ext && textW(tName(b.t), 13) + textW(groupOf[b.t]?.title ?? "", 10) + 26 <= b.w - 20 ? `<tspan class="thx">（${esc(groupOf[b.t]?.title ?? "")}）</tspan>` : ""}</text><text x="${b.x + 10}" y="${b.y + 32}" class="tp">${b.t}</text></a>`,
    );
    b.rows.forEach((c, i) => {
      const y = b.y + HEAD + 4 + i * ROW + ROW / 2 + 6;
      boxSvg.push(`<text x="${b.x + 10}" y="${y}" class="cl">${esc(cName(b.t, c.name))}</text><text x="${b.x + b.w - 10}" y="${y}" class="cm" text-anchor="end">${keyOf(b.t, c)}</text>`);
    });
    boxSvg.push("</g>");
  }
  const seen = new Set();
  const labSvg = labels
    .filter((l) => {
      const k = `${l.text}@${Math.round(l.x)}`;
      if (seen.has(k) && !/^1対/.test(l.text)) return false;
      seen.add(k);
      return true;
    })
    .map((l) => `<text x="${l.x}" y="${l.y}" class="el" text-anchor="${l.anchor}">${esc(l.text)}</text>`);
  const W = Math.max(...Object.values(boxes).map((b) => b.x + b.w)) + 70;
  const H = Math.max(...Object.values(boxes).map((b) => b.y + b.h), ...Object.values(fig.lanes ?? {})) + 30;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(fig.title)}">${svg.join("")}${boxSvg.join("")}${labSvg.join("")}</svg>`;
}

// ---------- 全体像 ----------
// 上の帯: 投稿とフォーマット、中の段: それ以外の区分、下の帯: プロジェクトと SNS、いちばん下: 利用者（auth.users）
function overviewSvg() {
  const O = L.overview;
  const gOf = Object.fromEntries(L.groups.map((g) => [g.key, g]));
  const W = 1200;
  const RW = 172;
  const RG = 22;
  const out = [];
  const box = (x, y, w, h, g, sub) =>
    `<a href="#g-${g.key}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" class="tbl"/><rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${g.color}"/>` +
    `<text x="${x + 20}" y="${y + 28}" class="th2">${esc(g.title)}</text><text x="${x + 20}" y="${y + 51}" class="sub">${esc(sub)}</text><text x="${x + 20}" y="${y + 73}" class="sub2">${g.tables.length} テーブル</text></a>`;
  const top = { x: 30, y: 30, w: W - 60, h: 86 };
  const rowY = 200;
  const RH = 92;
  const row = O.row.map((k, i) => ({ k, x: 30 + i * (RW + RG), y: rowY }));
  const lastHub = row.filter((r) => r.k !== "legal").at(-1);
  const hub = { x: 30, y: 380, w: lastHub.x + RW - 30, h: 86 };
  const users = { x: 30, y: 540, w: W - 60, h: 70 };
  const lines = [];
  const lab = (x, y, t, anchor = "start") => (t ? `<text x="${x}" y="${y}" class="el" text-anchor="${anchor}">${esc(t)}</text>` : "");
  for (const [k, to, label] of O.edges) {
    const r = row.find((z) => z.k === k);
    if (to === O.top) {
      const x = r.x + 36;
      lines.push(
        `<polyline points="${x},${r.y} ${x},${top.y + top.h}" class="edge"/><path d="M${x - 5},${r.y} L${x},${r.y - 9} L${x + 5},${r.y}" class="edge"/>`,
        lab(x + 6, (r.y + top.y + top.h) / 2 + 4, label),
      );
    } else {
      const x = r.x + 36;
      lines.push(
        `<polyline points="${x},${r.y + RH} ${x},${hub.y}" class="edge"/><path d="M${x - 5},${r.y + RH} L${x},${r.y + RH + 9} L${x + 5},${r.y + RH}" class="edge"/>`,
        lab(x + 6, (r.y + RH + hub.y) / 2 + 4, label),
      );
    }
  }
  // 投稿 → プロジェクト（左の外を回る）
  const ly1 = top.y + top.h / 2;
  const ly2 = hub.y + hub.h / 2;
  lines.push(`<polyline points="${top.x},${ly1} 12,${ly1} 12,${ly2} ${hub.x},${ly2}" class="edge"/><path d="M${top.x},${ly1 - 5} L${top.x - 9},${ly1} L${top.x},${ly1 + 5}" class="edge"/>`);
  // プロジェクト → 利用者、規約 → 利用者
  const ux = hub.x + 300;
  lines.push(
    `<polyline points="${ux},${hub.y + hub.h} ${ux},${users.y}" class="edge"/><path d="M${ux - 5},${hub.y + hub.h} L${ux},${hub.y + hub.h + 9} L${ux + 5},${hub.y + hub.h}" class="edge"/>`,
    lab(ux + 6, (hub.y + hub.h + users.y) / 2 + 4, "持ち主（ほとんどの表）"),
  );
  const legal = row.find((z) => z.k === "legal");
  if (legal) {
    const x = legal.x + 36;
    lines.push(
      `<polyline points="${x},${legal.y + RH} ${x},${users.y}" class="edge"/><path d="M${x - 5},${legal.y + RH} L${x},${legal.y + RH + 9} L${x + 5},${legal.y + RH}" class="edge"/>`,
      lab(x + 6, (legal.y + RH + users.y) / 2 + 4, "利用者ごと"),
    );
  }
  out.push(box(top.x, top.y, top.w, top.h, gOf[O.top], gOf[O.top].sub));
  for (const r of row) out.push(box(r.x, r.y, RW, RH, gOf[r.k], O.short[r.k] ?? ""));
  out.push(box(hub.x, hub.y, hub.w, hub.h, gOf[O.hub], gOf[O.hub].sub));
  out.push(
    `<rect x="${users.x}" y="${users.y}" width="${users.w}" height="${users.h}" rx="9" class="tbl user"/><text x="${users.x + 20}" y="${users.y + 29}" class="th2">利用者（auth.users）</text><text x="${users.x + 20}" y="${users.y + 52}" class="sub">Supabase の認証の利用者。ほとんどの表が持ち主（owner_id・user_id）で指す（外部キー）。各図では省く</text>`,
  );
  const H = users.y + users.h + 20;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="区分の全体像">${lines.join("")}${out.join("")}</svg>`;
}

// ---------- 列挙 ----------
function enumMeanings(text) {
  const m = {};
  for (const part of text.split(/\s*\/\s*|。/)) {
    const x = part.match(/^\s*([a-z_]+)\s*[:：]\s*(.+)$/);
    if (x) m[x[1]] = x[2].trim();
  }
  return m;
}

// ---------- 組み立て ----------
const totalCols = Object.values(S).reduce((a, t) => a + t.cols.length, 0);
const totalFk = Object.values(S).reduce((a, t) => a + t.rels.length, 0);
const enums = [];
for (const g of L.groups) for (const t of g.tables) for (const c of S[t].cols) if (c.enum) enums.push([t, c]);
let head = "";
try {
  head = execFileSync("git", ["log", "-1", "--format=%h"], { cwd: root }).toString().trim();
} catch {
  head = "";
}
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

let figNo = 1;
let body = "";
body += `<h2 id="overview">1. 全体像</h2><p class="lead">区分ごとの箱と、区分どうしのつながり。箱を押すと区分の図へ移る。</p>`;
body += `<figure><figcaption>図${figNo++}　区分の構成（${Object.keys(S).length} テーブル）</figcaption><div class="scroll">${overviewSvg()}</div></figure>`;
L.groups.forEach((g, gi) => {
  body += `<h2 id="g-${g.key}">${gi + 2}. ${esc(g.title)}</h2><p class="lead">${esc(g.lead)}</p>`;
  for (const fig of g.figures) body += `<figure><figcaption>図${figNo++}　${esc(fig.title)}</figcaption><div class="scroll">${figureSvg(g, fig)}</div></figure>`;
});
let sec = L.groups.length + 2;
body += `<h2 id="notes">${sec++}. 読むときの注意点</h2>`;
for (const [h, p] of L.notes) body += `<div class="note-box"><h4>${esc(h)}</h4><p>${esc(p)}</p></div>`;
body += `<h2 id="toc">${sec++}. テーブル一覧</h2>`;
for (const g of L.groups)
  body += `<div class="tocrow"><span class="dot" style="background:${g.color}"></span><strong>${esc(g.title)}</strong><div class="toclinks">${g.tables.map((t) => `<a href="#t-${t}">${esc(tName(t))}</a>`).join(" ")}</div></div>`;
body += `<h2 id="detail">${sec++}. テーブル詳細</h2>`;
for (const g of L.groups) {
  for (const t of g.tables) {
    const d = S[t];
    const uniq = d.uniques.filter((u) => u.length > 1);
    body += `<section class="tdetail" id="t-${t}"><h3><span class="dot" style="background:${g.color}"></span>${esc(tName(t))} <code>${t}</code><span class="badge">${esc(g.title)}</span></h3>`;
    body += `<p class="purpose">${esc(N.tables[t]?.p ?? "")}${d.pk.length > 1 ? `　主キー: (${d.pk.join(", ")})` : ""}${uniq.length ? `　一意: ${uniq.map((u) => `(${u.join(", ")})`).join("・")}` : ""}</p>`;
    body += `<div class="scroll"><table><thead><tr><th>カラム論理名</th><th>カラム物理名</th><th>型</th><th>必須</th><th>キー</th><th>補足</th></tr></thead><tbody>`;
    for (const c of d.cols) {
      const keys = [];
      if (c.pk) keys.push('<span class="k pk">PK</span>');
      if (c.fk) keys.push('<span class="k fk">FK</span>');
      if (c.unique && !c.pk) keys.push('<span class="k uk">UQ</span>');
      const refs = [];
      if (c.fk) refs.push(`→ <a href="#t-${c.fk}">${esc(tName(c.fk))}</a>`);
      if (c.authRef) refs.push("→ 利用者（auth.users）");
      const note = [refs.join(" "), esc(cNote(t, c))].filter(Boolean).join("　");
      const type = c.enum ? `<a class="en" href="#e-${t}-${c.name}">列挙</a>` : esc(typeJa(c));
      body += `<tr><td class="ja">${esc(cName(t, c.name))}</td><td class="ph">${c.name}</td><td>${type}</td><td class="c">${c.nullable ? "任意" : "必須"}</td><td class="c">${keys.join("")}</td><td class="note">${note}</td></tr>`;
    }
    body += "</tbody></table></div></section>";
  }
}
body += `<h2 id="enums">${sec++}. 列挙</h2><p class="lead">check (列 in (...)) で値を絞っている列。値の意味は、マイグレーションのコメントに書いてあるものだけを添えた。</p>`;
body += `<div class="scroll"><table class="enum"><thead><tr><th>論理名</th><th>物理名</th><th>取りうる値</th></tr></thead><tbody>`;
for (const [t, c] of enums) {
  const mean = enumMeanings(fixWords([c.comment, ...c.notes].join(" / ")));
  const vals = c.enum.map((v) => `<span class="ev"><code>${esc(v)}</code>${mean[v] ? `<span class="evm">${esc(mean[v])}</span>` : ""}</span>`).join("");
  body += `<tr id="e-${t}-${c.name}"><td class="ja">${esc(cName(t, c.name))}<span class="et">${esc(tName(t))}</span></td><td class="ph">${t}.${c.name}</td><td class="vals">${vals}</td></tr>`;
}
body += "</tbody></table></div>";

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>yabumi データベース ER 図</title>
<style>
:root{--bg:#fff;--card:#fff;--fg:#111827;--muted:#6B7280;--line:#E5E7EB;--accent:#2563EB;--code:#F3F4F6}
*{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.7}
.wrap{max-width:1280px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:26px;margin:0 0 6px}
h2{font-size:19px;margin:48px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line);scroll-margin-top:16px}
h3{font-size:15px;margin:0 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lead{color:var(--muted);margin:0 0 4px;font-size:14px}
code{background:var(--code);padding:1px 6px;border-radius:4px;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none}
.badge{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 9px}
figure{margin:12px 0 26px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
figcaption{font-size:13px;font-weight:700;margin-bottom:12px}
.scroll{overflow-x:auto}
svg{max-width:100%;height:auto;display:block}
svg a{cursor:pointer}
.tbl{fill:#fff;stroke:#D1D5DB;stroke-width:1}
.user{fill:#F9FAFB}
.ext .tbl{stroke-dasharray:4 3}
.th{fill:#fff;font-size:12.5px;font-weight:700}
.thx{fill:rgba(255,255,255,.85);font-size:10px;font-weight:400}
.tp{fill:rgba(255,255,255,.85);font-size:10.5px;font-family:ui-monospace,Menlo,monospace}
.th2{fill:var(--fg);font-size:15px;font-weight:700}
.sub{fill:var(--muted);font-size:12px}
.sub2{fill:var(--muted);font-size:11px}
.cl{fill:var(--fg);font-size:11.5px}
.cm{fill:var(--muted);font-size:9.5px;font-weight:700}
.edge{fill:none;stroke:#6B7280;stroke-width:1.3}
.dash{stroke-dasharray:5 4}
.el{fill:#4B5563;font-size:10.5px;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
th{font-size:11.5px;color:var(--muted);font-weight:600;white-space:nowrap}
td.ja{font-weight:600;white-space:nowrap}
td.ph{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted);white-space:nowrap}
td.c{text-align:center;white-space:nowrap}
td.note{color:var(--muted);font-size:12px;min-width:240px}
.et{display:block;font-weight:400;font-size:11.5px;color:var(--muted)}
td.note a,.en{color:var(--accent);text-decoration:none}
.k{font-size:10px;font-weight:700;border-radius:3px;padding:1px 5px;margin-right:3px;color:#fff}
.pk{background:#5B4FE9}.fk{background:#0EA5E9}.uk{background:#10B981}
.en{font-size:12px}
.tdetail{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;scroll-margin-top:16px}
.purpose{color:var(--muted);font-size:13px;margin:0 0 12px}
.tocrow{display:flex;gap:10px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.toclinks{display:flex;gap:12px;flex-wrap:wrap}
.toclinks a,.nav a{color:var(--accent);text-decoration:none;font-size:13px}
.toclinks a:hover,.nav a:hover{text-decoration:underline}
.nav{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 8px}
.note-box{background:var(--card);border:1px solid var(--line);border-left:4px solid #F59E0B;border-radius:8px;padding:14px 16px;margin-bottom:12px}
.note-box h4{margin:0 0 6px;font-size:14px}
.note-box p{margin:0;font-size:13px;color:var(--muted)}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:14px 0 8px;align-items:center}
.legend svg{display:inline-block;vertical-align:middle}
td.vals{line-height:2}
.ev{display:inline-block;margin:0 10px 0 0}
.evm{color:var(--muted);font-size:12px;margin-left:4px}
tr[id]{scroll-margin-top:16px}
</style></head><body><div class="wrap">

<h1>yabumi データベース ER 図</h1>
<p class="lead">対象: public スキーマ（${Object.keys(S).length} テーブル・${totalCols} 列・外部キー ${totalFk} 本・列挙 ${enums.length}）　元: main ${head}　作った日: ${today}</p>
<p class="lead">図には主なカラムだけを載せている。全部のカラムは「テーブル詳細」を見る。図の表を押すと、その表の詳細へ移る。点線の枠は、ほかの区分の表。</p>

<div class="legend">
<span><span class="k pk">PK</span> 主キー</span>
<span><span class="k fk">FK</span> 外部キー制約あり</span>
<span><span class="k uk">UQ</span> 一意制約</span>
<span><svg width="44" height="12"><polyline points="2,6 42,6" class="edge"/><path d="M2,1 L11,6 L2,11" class="edge"/></svg> 外部キーで繋がる関係（三つ又が「多」の側）</span>
<span><svg width="44" height="12"><polyline points="2,6 42,6" class="edge dash"/></svg> 制約のない参照（jsonb の中の ID など。アプリ側で担保）</span>
</div>
<div class="nav"><a href="#overview">全体像</a>${L.groups.map((g) => `<a href="#g-${g.key}">${esc(g.title)}</a>`).join("")}<a href="#notes">注意点</a><a href="#toc">テーブル一覧</a><a href="#detail">テーブル詳細</a><a href="#enums">列挙</a></div>
${body}
</div></body></html>
`;
const out = path.join(root, "docs/design/database_er.html");
fs.writeFileSync(out, html);
console.log(
  `docs/design/database_er.html: ${Object.keys(S).length} 表・${totalCols} 列・外部キー ${totalFk} 本・列挙 ${enums.length}${problems.length ? `（足りないもの ${problems.length} 件）` : ""}`,
);
