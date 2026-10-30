// globals.css のダークの値は 2 か所（OS の設定と、切り替えボタンで選んだ data-theme="dark"）にある。
// 片方だけ直して見た目が食い違わないよう、同じ値かを確かめる（docs/design/new_design/README.md）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

const light = vars(block(globals, /^:root \{\n([\s\S]*?)\n\}/m));
const osDark = vars(block(globals, /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme="light"\]\) \{\n([\s\S]*?)\n {2}\}/));
const forcedDark = vars(block(globals, /:root\[data-theme="dark"\] \{\n([\s\S]*?)\n\}/));

describe("テーマの色", () => {
  it("OS の設定のダークと、選んだダークの値が一致する", () => {
    expect(Object.keys(osDark).length).toBeGreaterThan(30);
    expect(forcedDark).toEqual(osDark);
  });

  it("ライトの色はすべてダークでも決めてある", () => {
    expect(Object.keys(light).length).toBeGreaterThan(30);
    for (const k of Object.keys(light)) expect(osDark[k], k).toBeDefined();
  });
});
