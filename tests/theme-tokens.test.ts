// 切り替えボタン用に globals.css へ写したテーマの値が、Claude Design のトークンと一致しているか
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync("docs/design/design_handoff_yabumi_1b/yabumi-tokens.css", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function block(css: string, re: RegExp): string {
  const m = css.match(re);
  if (!m) throw new Error(`見つかりません: ${re}`);
  return m[1];
}

const tokenLight = vars(block(tokens, /:root \{\n([\s\S]*?)\n\}/));
const tokenDark = vars(block(tokens, /@media \(prefers-color-scheme: dark\) \{\n {2}:root \{\n([\s\S]*?)\n {2}\}/));
const forcedLight = vars(block(globals, /:root\[data-theme="light"\] \{\n([\s\S]*?)\n\}/));
const forcedDark = vars(block(globals, /:root\[data-theme="dark"\] \{\n([\s\S]*?)\n\}/));

describe("テーマ切り替え用の色", () => {
  it("ライトの値がトークンと一致する", () => {
    expect(Object.keys(tokenLight).length).toBeGreaterThan(20);
    for (const [k, v] of Object.entries(tokenLight)) expect(forcedLight[k], k).toBe(v);
  });

  it("ダークの値がトークンと一致する", () => {
    expect(Object.keys(tokenDark).length).toBeGreaterThan(20);
    for (const [k, v] of Object.entries(tokenDark)) expect(forcedDark[k], k).toBe(v);
  });
});
