import type { SnsKey } from "@/lib/sns";

// テンプレートで画像を作る（F14 の段取り ①。docs/architecture.md の 4.25）。
// ここは描く中身（どこに何をどの大きさで置くか）を決めるだけで、Canvas には触らない（単体テストできるように）。
// 色は画像の中身の色で、矢書の画面の色（トークン）ではない。利用者のアプリらしさを出せるよう、選ぶだけで整う組み合わせにしぼる

export const TEMPLATE_KINDS = ["card", "diagram", "screen", "note"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  card: "文字のカード",
  diagram: "図解",
  screen: "アプリの画面",
  note: "note のヘッダー",
};

export const TEMPLATE_KIND_HINT: Record<TemplateKind, string> = {
  card: "お知らせ・リリース・ひとことを、大きな文字で",
  diagram: "ポイント・手順・使う前と後を、並べて見せる",
  screen: "アプリの画面に見出しを添える（画面の画像はあなたが選ぶ）",
  note: "note の記事の見出し画像（1280×670）",
};

export const DIAGRAM_STYLES = ["points", "steps", "compare"] as const;
export type DiagramStyle = (typeof DIAGRAM_STYLES)[number];
export const DIAGRAM_STYLE_LABEL: Record<DiagramStyle, string> = { points: "ポイント", steps: "手順", compare: "前と後" };

// 縦横比。どれも Instagram の範囲（4:5〜1.91:1）に入り、長い辺は 4.18 の 2,048px までに収まる
export const TEMPLATE_SIZES = {
  portrait: { w: 1080, h: 1350, label: "縦 4:5" },
  square: { w: 1080, h: 1080, label: "正方形 1:1" },
  landscape: { w: 1600, h: 900, label: "横 16:9" },
} as const;
export type TemplateSizeKey = keyof typeof TEMPLATE_SIZES;
export const NOTE_SIZE = { w: 1280, h: 670 } as const;

// 送り先から既定の縦横比を決める。Instagram・Facebook・Threads は縦長が大きく見え、X だけなら横長が切られにくい
export function defaultSizeFor(targets: readonly SnsKey[]): { size: TemplateSizeKey; reason: string } {
  const tall = (["instagram", "facebook", "threads"] as const).filter((s) => targets.includes(s));
  if (tall.length) return { size: "portrait", reason: `送り先に ${tall.map(snsName).join("・")} があるので、縦長がいちばん大きく見えます` };
  if (targets.includes("x")) return { size: "landscape", reason: "X のタイムラインで切られにくい横長です" };
  return { size: "portrait", reason: "多くの SNS で大きく見える縦長です" };
}

function snsName(s: SnsKey): string {
  return { instagram: "Instagram", facebook: "Facebook", threads: "Threads" }[s as "instagram"] ?? s;
}

export function canvasSize(kind: TemplateKind, size: TemplateSizeKey): { w: number; h: number } {
  return kind === "note" ? NOTE_SIZE : TEMPLATE_SIZES[size];
}

// ── 色 ──

export type Palette = { key: string; label: string; bg: string; fg: string; sub: string; accent: string; panel: string; panelFg: string; panelSub: string };

// 画像の中身の色（画面の色ではないので、トークンではなく色を直接書く）
export const PALETTES: Palette[] = [
  { key: "ai", label: "藍", bg: "#1d3557", fg: "#ffffff", sub: "#c9d6e6", accent: "#ffd166", panel: "rgba(255,255,255,0.10)", panelFg: "#ffffff", panelSub: "#c9d6e6" },
  { key: "kinari", label: "生成り", bg: "#f6f1e7", fg: "#2b2724", sub: "#6b6359", accent: "#c8553d", panel: "#ffffff", panelFg: "#2b2724", panelSub: "#6b6359" },
  { key: "sumi", label: "墨", bg: "#16181d", fg: "#f5f5f4", sub: "#a8a29e", accent: "#4ade80", panel: "rgba(255,255,255,0.08)", panelFg: "#f5f5f4", panelSub: "#a8a29e" },
  { key: "wakakusa", label: "若草", bg: "#e7f2e8", fg: "#1f3d2b", sub: "#4b6b57", accent: "#2f855a", panel: "#ffffff", panelFg: "#1f3d2b", panelSub: "#4b6b57" },
  { key: "sakura", label: "桜", bg: "#fdeef0", fg: "#4a2330", sub: "#8a5a67", accent: "#d6456b", panel: "#ffffff", panelFg: "#4a2330", panelSub: "#8a5a67" },
  { key: "sora", label: "空", bg: "#e6f0fb", fg: "#14324f", sub: "#4d6782", accent: "#2b6cb0", panel: "#ffffff", panelFg: "#14324f", panelSub: "#4d6782" },
];

export const DEFAULT_BRAND_COLOR = "#e4572e";

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// アプリの色（1 色）から組み合わせを作る。背景はその色、文字は白か黒の読みやすいほう
export function brandPalette(hex: string): Palette {
  const bgRgb = parseHex(hex) ?? parseHex(DEFAULT_BRAND_COLOR)!;
  const bg = mix(bgRgb, bgRgb, 0);
  const light = contrastRatio("#ffffff", bg) >= contrastRatio("#111111", bg);
  const fg = light ? "#ffffff" : "#111111";
  const sub = mix(parseHex(fg)!, bgRgb, 0.25);
  return {
    key: "brand",
    label: "アプリの色",
    bg,
    fg,
    sub,
    accent: fg,
    panel: light ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.55)",
    panelFg: fg,
    panelSub: sub,
  };
}

// ── 文字の形 ──

export const FONT_KEYS = ["gothic", "rounded", "mincho", "pop"] as const;
export type FontKey = (typeof FONT_KEYS)[number];
export const FONT_LABEL: Record<FontKey, string> = { gothic: "すっきり", rounded: "やわらか", mincho: "落ち着き", pop: "力強い" };

// 描くときの書体。family は画面で読み込んだフォントの名前（template-fonts.ts）を入れる
export type FontFace = { family: string; weight: number };
export type FontSet = { heading: FontFace; body: FontFace; bodyBold: FontFace };

// ── 文字の折り返しと大きさ合わせ ──

export type Measure = (text: string, font: FontFace, size: number) => number;

// 行の頭に来てはいけない字（句読点・閉じかっこ・小さい字・長音）と、行の終わりに来てはいけない字（開きかっこ）
const NO_START = new Set([..."、。，．,.・：；:;？！?!ー〜…‥）)］]｝}」』】〉》〕’”ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々"]);
const BREAK_AFTER = new Set([..."、。，．！？!? 　"]);
const NO_END = new Set([..."（(［[｛{「『【〈《〔‘“"]);

// 英数字のつながり（単語・数字・URL の一部）は途中で折らない
function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9_.,%'’\-/:+#&@]*|\s+|./gu) ?? [];
}

export function wrapLines(text: string, maxWidth: number, font: FontFace, size: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    const tokens = tokenize(para);
    let line = "";
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (measure(line + tok, font, size) <= maxWidth || line === "") {
        // 1 つで幅を超える長い英単語は、字で折る
        if (line === "" && measure(tok, font, size) > maxWidth && tok.length > 1) {
          let rest = "";
          for (const ch of tok) {
            if (rest && measure(rest + ch, font, size) > maxWidth) {
              out.push(rest);
              rest = "";
            }
            rest += ch;
          }
          line = rest;
        } else {
          line += tok;
        }
        continue;
      }
      // ここで折る。行の後ろ 4 割に読点・句点・空白があれば、そこで折る（「時間を、／自分で」のように、意味の切れ目で折る）
      let carry = /^\s+$/.test(tok) ? "" : tok;
      {
        const chars = [...line];
        for (let k = chars.length - 1; k >= Math.ceil(chars.length * 0.6); k--) {
          if (BREAK_AFTER.has(chars[k]) && k < chars.length - 1) {
            carry = chars.slice(k + 1).join("").trimStart() + carry;
            line = chars.slice(0, k + 1).join("");
            break;
          }
        }
      }
      // 行頭に来てはいけない字なら、前の字ごと次の行へ送る（追い出し）
      if (carry && NO_START.has([...carry][0]) && [...line].length > 1) {
        const chars = [...line];
        carry = chars.pop() + carry;
        line = chars.join("");
      }
      // 行の終わりに開きかっこが残るなら、それも次の行へ
      while ([...line].length > 1 && NO_END.has([...line].at(-1)!)) {
        const chars = [...line];
        carry = chars.pop() + carry;
        line = chars.join("");
      }
      out.push(line.trimEnd());
      line = carry;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export type Fitted = { size: number; lines: string[]; lineHeight: number };

// 決めた行数に収まるまで文字を小さくする。いちばん小さくしても収まらなければ、最後の行を「…」で切る
export function fitText(
  text: string,
  opts: { maxWidth: number; maxLines: number; maxSize: number; minSize: number; font: FontFace; lineHeight?: number; balance?: boolean },
  measure: Measure,
): Fitted {
  const lh = opts.lineHeight ?? 1.35;
  const t = text.trim();
  if (!t) return { size: opts.maxSize, lines: [], lineHeight: opts.maxSize * lh };
  for (let size = opts.maxSize; size >= opts.minSize; size = Math.floor(size * 0.94)) {
    const lines = wrapLines(t, opts.maxWidth, opts.font, size, measure);
    if (lines.length <= opts.maxLines) {
      if (!opts.balance) return { size, lines, lineHeight: size * lh };
      const b = balanceLines(t, lines, size, { ...opts, minSize: Math.max(opts.minSize, size * 0.8) }, measure);
      return { size: b.size, lines: b.lines, lineHeight: b.size * lh };
    }
  }
  const size = opts.minSize;
  const lines = wrapLines(t, opts.maxWidth, opts.font, size, measure).slice(0, opts.maxLines);
  let last = lines[lines.length - 1] ?? "";
  while (last && measure(`${last}…`, opts.font, size) > opts.maxWidth) last = [...last].slice(0, -1).join("");
  lines[lines.length - 1] = `${last}…`;
  return { size, lines, lineHeight: size * lh };
}

// 見出しの最後の行に 1〜2 字だけ残るときは、まず字を少し（2 割まで）小さくして、意味の切れ目で折れる大きさを探す。
// それでもだめなら、同じ行数のまま幅を少しずつ狭める（狭めすぎると助詞の前で折れるので、必要なぶんだけ）。直したいところは利用者が改行を入れられる
function balanceLines(
  text: string,
  lines: string[],
  size: number,
  opts: { maxWidth: number; minSize: number; font: FontFace },
  measure: Measure,
): { size: number; lines: string[] } {
  if (lines.length < 2 || text.includes("\n")) return { size, lines };
  const short = (ls: string[], sz: number) => ls.length > 1 && measure(ls[ls.length - 1], opts.font, sz) < measure(ls[0], opts.font, sz) * 0.35;
  if (!short(lines, size)) return { size, lines };
  for (let sz = Math.floor(size * 0.96); sz >= opts.minSize; sz = Math.floor(sz * 0.96)) {
    const next = wrapLines(text, opts.maxWidth, opts.font, sz, measure);
    if (next.length <= lines.length && !short(next, sz)) return { size: sz, lines: next };
  }
  for (let w = opts.maxWidth * 0.97; w >= opts.maxWidth * 0.6; w *= 0.97) {
    const next = wrapLines(text, w, opts.font, size, measure);
    if (next.length !== lines.length) break;
    if (!short(next, size)) return { size, lines: next };
  }
  return { size, lines };
}

// ── 描くもの ──

export type DrawOp =
  | { type: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { type: "circle"; cx: number; cy: number; r: number; fill: string }
  | { type: "tri"; points: [number, number][]; fill: string }
  | { type: "text"; x: number; y: number; text: string; font: FontFace; size: number; color: string; align: "left" | "center" | "right" }
  | { type: "image"; x: number; y: number; w: number; h: number; r: number }
  | { type: "placeholder"; x: number; y: number; w: number; h: number; r: number; text: string; font: FontFace; size: number; color: string; stroke: string };

export type TemplateItem = { title: string; text: string };

export type TemplateInput = {
  kind: TemplateKind;
  size: TemplateSizeKey;
  palette: Palette;
  fonts: FontSet;
  label: string;
  headline: string;
  subline: string;
  footer: string;
  diagramStyle: DiagramStyle;
  items: TemplateItem[];
  // アプリの画面の画像の大きさ（選んでいなければ null）
  screenshot: { w: number; h: number } | null;
};

export type Layout = { w: number; h: number; ops: DrawOp[] };

export const MAX_ITEMS = 5;

export function layoutTemplate(input: TemplateInput, measure: Measure): Layout {
  const { w, h } = canvasSize(input.kind, input.size);
  const ops: DrawOp[] = [{ type: "rect", x: 0, y: 0, w, h, r: 0, fill: input.palette.bg }];
  // 文字の大きさの基準。note のヘッダーは横に長く低いので、幅から決める
  const ctx: Ctx = { input, measure, w, h, u: input.kind === "note" ? w / 1500 : Math.min(w, h) / 1080, ops };
  if (input.kind === "card") layoutCard(ctx, "left");
  else if (input.kind === "note") layoutCard(ctx, "center");
  else if (input.kind === "diagram") layoutDiagram(ctx);
  else layoutScreen(ctx);
  return { w, h, ops };
}

type Ctx = { input: TemplateInput; measure: Measure; w: number; h: number; u: number; ops: DrawOp[] };

function pushLines(ctx: Ctx, f: Fitted, x: number, top: number, font: FontFace, color: string, align: "left" | "center" | "right"): number {
  // 1 行目の文字の上端を top に合わせる（ベースラインは字の大きさの 0.88 ほど下）
  f.lines.forEach((text, i) => ctx.ops.push({ type: "text", x, y: top + f.size * 0.88 + i * f.lineHeight, text, font, size: f.size, color, align }));
  return f.lines.length ? (f.lines.length - 1) * f.lineHeight + f.size * 1.1 : 0;
}

function blockHeight(f: Fitted): number {
  return f.lines.length ? (f.lines.length - 1) * f.lineHeight + f.size * 1.1 : 0;
}

function layoutCard(ctx: Ctx, align: "left" | "center") {
  const { input, w, h, u, ops, measure } = ctx;
  const p = input.palette;
  const note = input.kind === "note";
  const m = (note ? 64 : 88) * u;
  const innerW = w - m * 2;
  const x = align === "center" ? w / 2 : m;

  // 飾り: 左上の短い線（カード）、上下の帯（note）
  if (note) {
    ops.push({ type: "rect", x: 0, y: 0, w, h: 14 * u, r: 0, fill: p.accent });
  } else {
    ops.push({ type: "rect", x: m, y: m, w: 72 * u, h: 10 * u, r: 5 * u, fill: p.accent });
  }

  const label = fitText(input.label, { maxWidth: innerW, maxLines: 1, maxSize: (note ? 34 : 38) * u, minSize: 24 * u, font: input.fonts.bodyBold }, measure);
  const landscape = w > h;
  const headline = fitText(
    input.headline,
    { maxWidth: innerW, maxLines: note ? 2 : landscape ? 3 : 4, maxSize: (note ? 92 : landscape ? 104 : 116) * u, minSize: (note ? 52 : 56) * u, font: input.fonts.heading, lineHeight: 1.3, balance: true },
    measure,
  );
  const sub = fitText(input.subline, { maxWidth: innerW, maxLines: note ? 1 : 3, maxSize: (note ? 34 : 42) * u, minSize: 26 * u, font: input.fonts.body, lineHeight: 1.55 }, measure);
  const footer = fitText(input.footer, { maxWidth: innerW, maxLines: 1, maxSize: 30 * u, minSize: 22 * u, font: input.fonts.bodyBold }, measure);

  const gap = 28 * u;
  const labelH = label.lines.length ? blockHeight(label) + gap : 0;
  const subH = sub.lines.length ? gap + blockHeight(sub) : 0;
  const total = labelH + blockHeight(headline) + subH;
  const areaTop = note ? m : m + 60 * u;
  const areaBottom = h - m - (footer.lines.length ? 60 * u : 0);
  let y = Math.max(areaTop, areaTop + (areaBottom - areaTop - total) / 2);

  if (label.lines.length) y += pushLines(ctx, label, x, y, input.fonts.bodyBold, p.accent, align) + gap;
  y += pushLines(ctx, headline, x, y, input.fonts.heading, p.fg, align);
  if (sub.lines.length) pushLines(ctx, sub, x, y + gap, input.fonts.body, p.sub, align);

  if (footer.lines.length) {
    const fx = note ? w - m : m;
    ctx.ops.push({ type: "text", x: fx, y: h - m + footer.size * 0.2, text: footer.lines[0], font: input.fonts.bodyBold, size: footer.size, color: p.sub, align: note ? "right" : "left" });
  }
}

function layoutDiagram(ctx: Ctx) {
  const { input, w, h, u, ops, measure } = ctx;
  const p = input.palette;
  const m = 80 * u;
  const innerW = w - m * 2;
  const landscape = w > h;
  const style = input.diagramStyle;
  const items = (style === "compare" ? input.items.slice(0, 2) : input.items.slice(0, MAX_ITEMS)).filter((it) => it.title.trim() || it.text.trim());

  let y = m;
  if (input.label.trim()) {
    const label = fitText(input.label, { maxWidth: innerW, maxLines: 1, maxSize: 34 * u, minSize: 24 * u, font: input.fonts.bodyBold }, measure);
    y += pushLines(ctx, label, m, y, input.fonts.bodyBold, p.accent, "left") + 18 * u;
  }
  const title = fitText(input.headline, { maxWidth: innerW, maxLines: 2, maxSize: (landscape ? 72 : 80) * u, minSize: 44 * u, font: input.fonts.heading, lineHeight: 1.3, balance: true }, measure);
  y += pushLines(ctx, title, m, y, input.fonts.heading, p.fg, "left");
  y += 48 * u;

  const footer = input.footer.trim()
    ? fitText(input.footer, { maxWidth: innerW, maxLines: 1, maxSize: 28 * u, minSize: 20 * u, font: input.fonts.bodyBold }, measure)
    : null;
  const bottom = h - m - (footer ? 52 * u : 0);
  if (footer) ops.push({ type: "text", x: m, y: h - m + footer.size * 0.2, text: footer.lines[0], font: input.fonts.bodyBold, size: footer.size, color: p.sub, align: "left" });

  if (items.length === 0) {
    ops.push({ type: "placeholder", x: m, y, w: innerW, h: bottom - y, r: 24 * u, text: "項目を書くと、ここに並びます", font: input.fonts.body, size: 34 * u, color: p.sub, stroke: p.sub });
    return;
  }

  // 横長は横に並べ、縦長・正方形は縦に積む。「前と後」は、横長なら左右、縦長なら上下
  const across = landscape;
  const n = items.length;
  const arrow = style === "steps" || style === "compare";
  const gap = (arrow ? 56 : 22) * u;
  const boxW = across ? (innerW - gap * (n - 1)) / n : innerW;
  const pad = 28 * u;
  let boxH = across ? bottom - y : (bottom - y - gap * (n - 1)) / n;
  // 横に並べるときは、箱を中身の高さにそろえ、余白の上下の真ん中に置く（縦に長い空の箱にしない）
  if (across) {
    const numH = style === "compare" ? 0 : 72 * u + 20 * u;
    const tw = boxW - pad * 2;
    const contentH = Math.max(
      ...items.map((it) => {
        const t = fitText(it.title, { maxWidth: tw, maxLines: 2, maxSize: 48 * u, minSize: 26 * u, font: input.fonts.bodyBold, lineHeight: 1.3 }, measure);
        const x = fitText(it.text, { maxWidth: tw, maxLines: 6, maxSize: 36 * u, minSize: 22 * u, font: input.fonts.body, lineHeight: 1.5 }, measure);
        return (t.lines.length ? blockHeight(t) : 0) + (x.lines.length ? 12 * u + blockHeight(x) : 0);
      }),
    );
    const want = Math.min(boxH, Math.max(contentH + numH + pad * 2.5, boxH * 0.45));
    y += (boxH - want) / 2;
    boxH = want;
  }

  items.forEach((it, i) => {
    const bx = across ? m + i * (boxW + gap) : m;
    const by = across ? y : y + i * (boxH + gap);
    const isAfter = style === "compare" && i === 1;
    ops.push({ type: "rect", x: bx, y: by, w: boxW, h: boxH, r: 24 * u, fill: isAfter ? p.accent : p.panel });
    const fg = isAfter ? p.bg : p.panelFg;
    const subC = isAfter ? p.bg : p.panelSub;

    // 番号（ポイント・手順）
    let tx = bx + pad;
    let tw = boxW - pad * 2;
    let ty = by + pad;
    if (style !== "compare") {
      const d = Math.min(72 * u, boxH - pad * 2);
      const numSize = d * 0.55;
      if (across) {
        ops.push({ type: "circle", cx: bx + pad + d / 2, cy: by + pad + d / 2, r: d / 2, fill: p.accent });
        ops.push({ type: "text", x: bx + pad + d / 2, y: by + pad + d / 2 + numSize * 0.36, text: String(i + 1), font: input.fonts.heading, size: numSize, color: p.bg, align: "center" });
        ty = by + pad + d + 20 * u;
      } else {
        ops.push({ type: "circle", cx: bx + pad + d / 2, cy: by + boxH / 2, r: d / 2, fill: p.accent });
        ops.push({ type: "text", x: bx + pad + d / 2, y: by + boxH / 2 + numSize * 0.36, text: String(i + 1), font: input.fonts.heading, size: numSize, color: p.bg, align: "center" });
        tx = bx + pad + d + 24 * u;
        tw = boxW - (tx - bx) - pad;
      }
    }

    const availH = by + boxH - pad - ty;
    const titleF = fitText(it.title, { maxWidth: tw, maxLines: 2, maxSize: 48 * u, minSize: 26 * u, font: input.fonts.bodyBold, lineHeight: 1.3 }, measure);
    const textMaxLines = Math.max(1, Math.floor((availH - (titleF.lines.length ? blockHeight(titleF) + 12 * u : 0)) / (36 * u * 1.5)));
    const textF = fitText(it.text, { maxWidth: tw, maxLines: Math.min(textMaxLines, across ? 6 : 3), maxSize: 36 * u, minSize: 22 * u, font: input.fonts.body, lineHeight: 1.5 }, measure);
    const contentH = (titleF.lines.length ? blockHeight(titleF) : 0) + (textF.lines.length ? 12 * u + blockHeight(textF) : 0);
    // 縦に積むときは、箱の中で上下の真ん中に
    let cy = across ? ty : Math.max(by + pad, by + (boxH - contentH) / 2);
    if (titleF.lines.length) cy += pushLines(ctx, titleF, tx, cy, input.fonts.bodyBold, fg, "left") + 12 * u;
    if (textF.lines.length) pushLines(ctx, textF, tx, cy, input.fonts.body, subC, "left");

    // 矢印（手順・前と後）
    if (arrow && i < n - 1) {
      const s = 18 * u;
      if (across) {
        const ax = bx + boxW + gap / 2;
        const ay = by + boxH / 2;
        ops.push({ type: "tri", points: [[ax - s * 0.7, ay - s], [ax - s * 0.7, ay + s], [ax + s * 0.8, ay]], fill: p.accent });
      } else {
        const ax = bx + boxW / 2;
        const ay = by + boxH + gap / 2;
        ops.push({ type: "tri", points: [[ax - s, ay - s * 0.7], [ax + s, ay - s * 0.7], [ax, ay + s * 0.8]], fill: p.accent });
      }
    }
  });
}

function layoutScreen(ctx: Ctx) {
  const { input, w, h, u, ops, measure } = ctx;
  const p = input.palette;
  const m = 80 * u;
  const landscape = w > h;
  const shot = input.screenshot;
  const shotRatio = shot ? shot.w / shot.h : 9 / 19.5;

  // 文字の欄: 横長は左半分、縦長・正方形は上
  const textW = landscape ? w * 0.5 - m : w - m * 2;
  const label = fitText(input.label, { maxWidth: textW, maxLines: 1, maxSize: 34 * u, minSize: 24 * u, font: input.fonts.bodyBold }, measure);
  const headline = fitText(
    input.headline,
    { maxWidth: textW, maxLines: landscape ? 4 : input.size === "square" ? 2 : 3, maxSize: (landscape ? 84 : 88) * u, minSize: 48 * u, font: input.fonts.heading, lineHeight: 1.3, balance: true },
    measure,
  );
  const sub = fitText(input.subline, { maxWidth: textW, maxLines: landscape ? 3 : 2, maxSize: 36 * u, minSize: 24 * u, font: input.fonts.body, lineHeight: 1.55 }, measure);
  const gap = 22 * u;
  const textH = (label.lines.length ? blockHeight(label) + gap : 0) + blockHeight(headline) + (sub.lines.length ? gap + blockHeight(sub) : 0);

  let y = landscape ? Math.max(m, (h - textH) / 2) : m;
  if (label.lines.length) y += pushLines(ctx, label, m, y, input.fonts.bodyBold, p.accent, "left") + gap;
  y += pushLines(ctx, headline, m, y, input.fonts.heading, p.fg, "left");
  if (sub.lines.length) y += gap + pushLines(ctx, sub, m, y + gap, input.fonts.body, p.sub, "left");

  // 画面の枠。縦長の画面（スマホ）は下にはみ出して「のぞかせる」。横長の画面（PC）は枠に収める
  const bezel = 14 * u;
  let fw: number;
  let fx: number;
  let fy: number;
  if (landscape) {
    const maxW = w * 0.42;
    const maxH = h - m;
    fw = Math.min(maxW, (maxH * shotRatio) | 0);
    fx = w * 0.5 + (w * 0.5 - m - fw) / 2 + m / 2;
    fy = shotRatio < 1 ? m : Math.max(m, (h - fw / shotRatio) / 2);
  } else {
    const top = y + 56 * u;
    const space = h - top;
    fw = shotRatio < 1 ? Math.min(w * (input.size === "square" ? 0.5 : 0.62), w - m * 2) : w - m * 2;
    // 横長の画面で場所が足りなければ小さくする
    if (shotRatio >= 1 && fw / shotRatio > space - m) fw = Math.max(200 * u, (space - m) * shotRatio);
    fx = (w - fw) / 2;
    fy = top;
  }
  const fh = fw / shotRatio;
  const r = (shotRatio < 1 ? 56 : 24) * u;
  // 端末の縁（画像の中身の色）。暗い背景でも縁が見えるよう、外側に薄い明るい輪を置く
  const ring = 3 * u;
  ops.push({ type: "rect", x: fx - bezel - ring, y: fy - bezel - ring, w: fw + (bezel + ring) * 2, h: fh + (bezel + ring) * 2, r: r + bezel + ring, fill: "rgba(255,255,255,0.22)" });
  ops.push({ type: "rect", x: fx - bezel, y: fy - bezel, w: fw + bezel * 2, h: fh + bezel * 2, r: r + bezel, fill: "#0e0e10" });
  if (shot) {
    ops.push({ type: "image", x: fx, y: fy, w: fw, h: fh, r });
  } else {
    ops.push({ type: "placeholder", x: fx, y: fy, w: fw, h: Math.min(fh, h - fy), r, text: "画面の画像を選んでください", font: input.fonts.body, size: 30 * u, color: "#d4d4d4", stroke: "#3a3a3a" });
  }
}

// 画像に描く文字がすべて入っているか（空の見出しのまま添えないため）
export function templateReady(input: Pick<TemplateInput, "kind" | "headline" | "items" | "screenshot">): string | null {
  if (!input.headline.trim()) return input.kind === "diagram" ? "図解のタイトルを書いてください" : "見出しを書いてください";
  if (input.kind === "diagram" && !input.items.some((it) => it.title.trim() || it.text.trim())) return "項目を 1 つ以上書いてください";
  if (input.kind === "screen" && !input.screenshot) return "アプリの画面の画像を選んでください";
  return null;
}

// 代わりの文（alt）を、描いた文字から作る。画面の画像の中身は読めないので、見出しと「アプリの画面」とだけ書く
export function autoAlt(input: Pick<TemplateInput, "kind" | "label" | "headline" | "subline" | "diagramStyle" | "items">): string {
  const join = (...xs: string[]) => xs.map((x) => x.trim()).filter(Boolean).join("。");
  const head = input.headline.trim() ? `「${input.headline.trim()}」` : "";
  if (input.kind === "diagram") {
    const items = (input.diagramStyle === "compare" ? input.items.slice(0, 2) : input.items)
      .filter((it) => it.title.trim() || it.text.trim())
      .map((it, i) => `${input.diagramStyle === "compare" ? "" : `${i + 1}. `}${[it.title.trim(), it.text.trim()].filter(Boolean).join("：")}`);
    return join(`${head}の図解（${DIAGRAM_STYLE_LABEL[input.diagramStyle]}）`, ...items).slice(0, 1000);
  }
  if (input.kind === "screen") return join(`アプリの画面に${head || "見出し"}と添えた画像`, input.subline).slice(0, 1000);
  return join(`${head}と書かれた画像`, input.label, input.subline).slice(0, 1000);
}
