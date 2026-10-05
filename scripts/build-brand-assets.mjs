// ロゴ（docs/design/logo/ の PNG）から、ファビコン・アプリのアイコン・OGP 画像を作る。
// 使い方: node scripts/build-brand-assets.mjs（元の PNG を差し替えたら実行し直す）
// 扱いの決まりは docs/design/logo/README.md
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// sharp は Next.js が画像の最適化に使うもの。依存を増やさないよう、next の中から読む
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.dirname(require.resolve("next/package.json"))] }));

const HORIZONTAL = "docs/design/logo/yabumi-logo-2a-horizontal.png";
// 横組みの PNG の中の、朱の角印の位置（画素。scripts で測った値）
const SEAL = { left: 1836, top: 712, size: 152 };
// トークンと同じ色（src/app/globals.css の --signal と --bg）
const SIGNAL = "#b6402a";
const BG = "#f2f2ee";

// 角印の中の白い「文」を、形（明るさの濃淡）として取り出す。角の丸みに焼き込まれた背景は除く
async function glyphMask() {
  const inset = 14;
  const { data, info } = await sharp(HORIZONTAL)
    .extract({ left: SEAL.left, top: SEAL.top, width: SEAL.size, height: SEAL.size })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = Buffer.alloc(info.width * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      const inside = x >= inset && y >= inset && x < info.width - inset && y < info.height - inset;
      // 緑の値で白さを測る（朱は緑が小さく、白い字は大きい）
      const g = data[i + 1];
      mask[y * info.width + x] = inside ? Math.max(0, Math.min(255, Math.round(((g - 64) / (242 - 64)) * 255))) : 0;
    }
  }
  return { mask, size: info.width };
}

// 1 チャンネルの raw にそろえて取り出す（sharp は処理の途中でチャンネル数を変えることがあるので、実際の値を見て 1 つ目だけを使う）
async function toGray(img) {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return { buf: data, width: info.width, height: info.height };
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels];
  return { buf: out, width: info.width, height: info.height };
}

// 「文」の形を size に拡大し、輪郭をくっきりさせる（拡大でぼやけた縁を締める）。
// scale が 1 より大きいときは、拡大して中央を size の大きさで切り出す（周りは空白なので字は欠けない）
async function scaledGlyph(m, size, scale = 1) {
  const target = Math.round(size * scale);
  const up = await toGray(
    sharp(m.mask, { raw: { width: m.size, height: m.size, channels: 1 } })
      .resize(target, target, { kernel: "lanczos3" })
      .linear(2.2, -0.6 * 255), // 縁の中間の濃さを狭める
  );
  if (target <= size) return { buf: up.buf, size: target };
  const o = Math.floor((target - size) / 2);
  const cut = await toGray(sharp(up.buf, { raw: { width: target, height: target, channels: 1 } }).extract({ left: o, top: o, width: size, height: size }));
  return { buf: cut.buf, size };
}

// 朱の正方形に白い「文」を置いた PNG。radius は角の丸み（0 なら四角いまま。iOS などは自分で丸める）
async function sealIcon(m, size, { radius = 0, glyphScale = 1, background = SIGNAL } = {}) {
  const g = await scaledGlyph(m, size, glyphScale);
  const offset = Math.round((size - g.size) / 2);
  const white = await sharp({ create: { width: g.size, height: g.size, channels: 3, background: "#ffffff" } })
    .joinChannel(g.buf, { raw: { width: g.size, height: g.size, channels: 1 } })
    .png()
    .toBuffer();
  const shape = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/></svg>`;
  return sharp(Buffer.from(shape)).composite([{ input: white, left: offset, top: offset }]).png().toBuffer();
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

const m = await glyphMask();
mkdirSync("public/icons", { recursive: true });

// ファビコン（16・32・48）。小さいので字を少し大きめに
const small = [];
for (const size of [16, 32, 48]) small.push({ size, buf: await sealIcon(m, size, { radius: Math.round(size * 0.16), glyphScale: 1.12 }) });
writeFileSync("src/app/favicon.ico", icoFromPngs(small));

// ブラウザのタブなど（PNG）。角は透明
writeFileSync("src/app/icon.png", await sealIcon(m, 512, { radius: 80 }));
// iPhone のホーム画面（180）。角は iOS が丸めるので四角いまま
writeFileSync("src/app/apple-icon.png", await sealIcon(m, 180));
// PWA（manifest.ts）。maskable は円や角丸に切り抜かれても字が欠けないよう、字を小さめに
writeFileSync("public/icons/icon-192.png", await sealIcon(m, 192, { radius: 30 }));
writeFileSync("public/icons/icon-512.png", await sealIcon(m, 512, { radius: 80 }));
writeFileSync("public/icons/maskable-512.png", await sealIcon(m, 512, { glyphScale: 0.78 }));

// OGP 画像（1200×630）。横組みのロゴを、焼き込まれた角丸の外を除いて、生成りの地に置く
const inner = await sharp(HORIZONTAL).extract({ left: 40, top: 40, width: 2808 - 80, height: 1200 - 80 }).resize({ height: 630 }).toBuffer();
const innerMeta = await sharp(inner).metadata();
const og = await sharp({ create: { width: 1200, height: 630, channels: 3, background: BG } })
  .composite([{ input: await sharp(inner).extract({ left: Math.round((innerMeta.width - 1200) / 2), top: 0, width: 1200, height: 630 }).toBuffer(), left: 0, top: 0 }])
  .png()
  .toBuffer();
writeFileSync("src/app/opengraph-image.png", og);
writeFileSync("src/app/twitter-image.png", og);

console.log("作りました: favicon.ico, icon.png, apple-icon.png, public/icons/*, opengraph-image.png, twitter-image.png");
