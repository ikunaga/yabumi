// 用語集の挿絵を Gemini で作る（docs/architecture.md の 4.45）。一度だけ流して public/glossary/<key>.webp に置き、リポジトリに入れる。
// 使い方:
//   node scripts/glossary-illustrations.mjs --dry-run            作る枚数と費用の見込みだけ出す
//   node scripts/glossary-illustrations.mjs --only=ugc,kgi       指定した語だけ作る（作り済みは飛ばす）
//   node scripts/glossary-illustrations.mjs --force --only=ugc   作り直す（作り済みも上書き）
//   node scripts/glossary-illustrations.mjs                      まだない語を全部作る
// 指示文は scripts/glossary-illustrations.prompts.json（絵柄の共通の指示 style と、語ごとの場面 terms）。
// 鍵（GEMINI_API_KEY）は .env.local から読み、ログには出さない。webp に変えるのに cwebp（brew install webp）を使う
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(ROOT, "public", "glossary");
const PROMPTS = JSON.parse(readFileSync(path.join(ROOT, "scripts", "glossary-illustrations.prompts.json"), "utf8"));
// 1 枚の値段（src/lib/ai/pricing.ts の gemini-nano-banana-2.1。入力の文の分はわずか）と、円に直すときの目安
const USD_PER_IMAGE = 0.0336;
const YEN_PER_USD = 150;
const MAX_BYTES = 150 * 1024;
const WIDTH = 1200;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean) ?? null;

const keys = Object.keys(PROMPTS.terms);
for (const k of only ?? []) if (!keys.includes(k)) throw new Error(`prompts に ${k} がありません`);
const targets = (only ?? keys).filter((k) => force || !existsSync(path.join(OUT_DIR, `${k}.webp`)));
const skipped = (only ?? keys).length - targets.length;
console.log(`作る: ${targets.length} 枚（作り済みで飛ばす: ${skipped} 枚）。費用の見込み: 約 $${(targets.length * USD_PER_IMAGE).toFixed(2)}（約 ${Math.round(targets.length * USD_PER_IMAGE * YEN_PER_USD)} 円）`);
if (dryRun || targets.length === 0) process.exit(0);

const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const apiKey = env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error(".env.local に GEMINI_API_KEY がありません");
const model = env.IMAGE_GEN_MODEL?.trim() || "gemini-nano-banana-2.1";

// アプリと同じ呼び方（src/lib/ai/gemini-image.ts の Interactions API）
async function generate(prompt) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "text", text: prompt }],
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "3:2", image_size: "1K" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${json?.errors?.[0]?.message ?? json?.error?.message ?? ""}`);
  const blocks = [...(json?.steps ?? []).filter((s) => s?.type !== "thought").flatMap((s) => s?.content ?? []), ...(json?.outputs ?? []), ...(json?.output_image ? [json.output_image] : [])];
  const img = blocks.filter((b) => b?.type === "image" && typeof b.data === "string" && b.data).at(-1);
  if (!img) throw new Error("画像が返ってきませんでした");
  return Buffer.from(img.data, "base64");
}

// 幅 1200px の webp に縮め、150KB を超えたら質を下げて作り直す
function toWebp(jpeg, out) {
  const dir = mkdtempSync(path.join(tmpdir(), "glossary-"));
  try {
    const src = path.join(dir, "in.jpg");
    writeFileSync(src, jpeg);
    for (const q of [80, 72, 64, 56, 48]) {
      execFileSync("cwebp", ["-quiet", "-q", String(q), "-resize", String(WIDTH), "0", "-metadata", "none", src, "-o", out]);
      if (statSync(out).size <= MAX_BYTES) return { q, bytes: statSync(out).size };
    }
    throw new Error(`${path.basename(out)} が ${MAX_BYTES} バイトに収まりません`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let made = 0;
for (const k of targets) {
  const prompt = `${PROMPTS.style}\n\nScene: ${PROMPTS.terms[k]}`;
  try {
    const jpeg = await generate(prompt);
    const { q, bytes } = toWebp(jpeg, path.join(OUT_DIR, `${k}.webp`));
    made++;
    console.log(`✓ ${k}.webp（質 ${q}、${Math.round(bytes / 1024)}KB）`);
  } catch (e) {
    console.error(`✗ ${k}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`作った: ${made} 枚 / ${targets.length} 枚。費用: 約 $${(made * USD_PER_IMAGE).toFixed(2)}（約 ${Math.round(made * USD_PER_IMAGE * YEN_PER_USD)} 円）`);
