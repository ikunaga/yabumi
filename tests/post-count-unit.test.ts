// 投稿の数は「本」で数える（CLAUDE.md の呼び方。投稿でないもの〈メモ・タスク・相談・予定・自動投稿の設定など〉は「件」。2026-11-24 PM の指摘）。
// 画面の部品で、投稿・下書き・送信済みの数に「件」を付けていないかを、ソースの形で見る（見つけたら「本」にする）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx|ts)$/.test(n) ? [p] : [];
  });
}

// 投稿の数の言い方（ラベルや文の中の数のすぐ後ろが「件」）。コメントの行は見ない。
// 「予約」は入れない（お店の予約〈顧客の予約 30 件〉は投稿でないので「件」でよい）
const POST_WORDS = "(投稿|下書き|送信済み|下書きに残した)";
const PATTERNS = [
  // <Metric label="下書き" ... unit="件" />（ラベルと単位が同じ部品の中。ラベルが <span> 入りの JSX でも、次の <Metric までに収まるもの）
  new RegExp(`<Metric(?:(?!<Metric)[\\s\\S]){0,400}?${POST_WORDS}(?:(?!<Metric)[\\s\\S]){0,400}?unit="件"`),
  // { label: "下書き", ..., unit: "件" }
  new RegExp(`label: "${POST_WORDS}"[^}]{0,120}unit: "件"`),
  // 「投稿 3 件」「下書き {n} 件」のような文
  new RegExp(`${POST_WORDS}[ ・]?(\\d+|\\$?\\{[^}]{1,40}\\})\\s*件`),
  // 「この {n} 件は、もうできています」（自動投稿のでき上がった投稿）
  /この \$\{[^}]{1,40}\} 件は、もうできています/,
];

describe("投稿の数は「本」", () => {
  it("画面のソースで、投稿・下書き・送信済みの数に「件」を付けていない", () => {
    const found: string[] = [];
    for (const f of files("src")) {
      const text = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l))
        .join("\n");
      for (const re of PATTERNS) {
        const m = text.match(re);
        if (m) found.push(`${f}: ${m[0].replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    expect(found).toEqual([]);
  });
});
