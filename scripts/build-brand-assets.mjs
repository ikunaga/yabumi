// ロゴ（矢のマーク。src/components/brand.tsx の LOGO_MARK_PATH）から、ファビコン・アプリのアイコン・OGP 画像・メールのロゴを作る。
// 使い方: node scripts/build-brand-assets.mjs（マークや色を変えたら実行し直す）
// 見本は docs/design/new_design/logo/ の D ミニマル。扱いの決まりは docs/design/new_design/README.md の「ロゴ」
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// sharp は Next.js が画像の最適化に使うもの。依存を増やさないよう、next の中から読む
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.dirname(require.resolve("next/package.json"))] }));

// src/components/brand.tsx の LOGO_MARK_PATH と同じ形（viewBox 10 22 70 56、線幅 7）
const MARK = "M14 26 L38 50 L14 74 M38 50 L72 50 M60 36 L76 50 L60 64";
// ロゴの墨（globals.css の --logo）と、画面の地（--bg）
const INK = "#16233d";
const BG = "#f6f6f7";

// 中心 (cx, cy) に、幅 width で矢のマークを置く SVG の部品
function mark({ cx, cy, width, color, strokeWidth = 7 }) {
  const s = width / 70;
  return `<g transform="translate(${cx - 45 * s} ${cy - 50 * s}) scale(${s})"><path d="${MARK}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

// 墨の角丸の正方形に白いマークを置いた PNG。radius は角の丸み（0 なら四角いまま。iOS などは自分で丸める）。
// ratio はマークの幅の割合。小さいアイコンほど大きめにし、線も太くして潰れないようにする
function tile(size, { radius = 0, ratio = 0.66, strokeWidth = 7 } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${INK}"/>${mark({ cx: size / 2, cy: size / 2, width: size * ratio, color: "#ffffff", strokeWidth })}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// PNG を入れた .ico（Windows Vista 以降と主なブラウザが読める形）
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

const FONT = `-apple-system, 'Helvetica Neue', 'Hiragino Sans', 'Noto Sans JP', sans-serif`;

// 横組みのロゴ（マーク ＋ yabumi）。height はマークの高さ
function wordmark({ x, y, height, color }) {
  const markWidth = (height / 56) * 70;
  const fontSize = height * 1.2;
  return `${mark({ cx: x + markWidth / 2, cy: y + height / 2, width: markWidth, color })}<text x="${x + markWidth + height * 0.55}" y="${y + height * 0.86}" font-family="${FONT}" font-size="${fontSize}" font-weight="700" letter-spacing="${fontSize * 0.06}" fill="${color}">yabumi</text>`;
}

mkdirSync("public/icons", { recursive: true });

// ファビコン（16・32・48）。16 はマークを大きく、線を太くして判別できるようにする
const small = [];
for (const size of [16, 32, 48]) {
  const tiny = size === 16;
  small.push({ size, buf: await tile(size, { radius: Math.round(size * 0.22), ratio: tiny ? 0.8 : 0.7, strokeWidth: tiny ? 9 : 8 }) });
}
writeFileSync("src/app/favicon.ico", icoFromPngs(small));

// ブラウザのタブなど（PNG）。角は透明
writeFileSync("src/app/icon.png", await tile(512, { radius: 116 }));
// iPhone のホーム画面（180）。角は iOS が丸めるので四角いまま
writeFileSync("src/app/apple-icon.png", await tile(180));
// PWA（manifest.ts）。maskable は円や角丸に切り抜かれてもマークが欠けないよう、マークを小さめに
writeFileSync("public/icons/icon-192.png", await tile(192, { radius: 44 }));
writeFileSync("public/icons/icon-512.png", await tile(512, { radius: 116 }));
writeFileSync("public/icons/maskable-512.png", await tile(512, { ratio: 0.5 }));

// メールのロゴ（supabase/templates/*.html。高さ 24 で出すので 2 倍で作る）。白い地
{
  const h = 48;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="${h}"><rect width="220" height="${h}" fill="#ffffff"/>${wordmark({ x: 2, y: h * 0.2, height: h * 0.6, color: INK })}</svg>`;
  writeFileSync("public/icons/email-logo.png", await sharp(Buffer.from(svg)).png().toBuffer());
}

// OGP 画像（1200×630）。うすい灰の地にロゴと一言
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="${BG}"/>
  ${wordmark({ x: 330, y: 230, height: 96, color: INK })}
  <text x="600" y="450" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="600" fill="#606366">矢書（やぶみ）— ひとりで売る人のための SNS 運用ツール</text>
</svg>`;
  const og = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync("src/app/opengraph-image.png", og);
  writeFileSync("src/app/twitter-image.png", og);
}

console.log("作りました: favicon.ico, icon.png, apple-icon.png, public/icons/*, opengraph-image.png, twitter-image.png");
