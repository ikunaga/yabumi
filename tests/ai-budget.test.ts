// 文章の AI（Claude）を呼ぶところは、すべて上限の入口（src/lib/ai/budget.ts の withAiBudget・reserveAi・budgeted）を通す（セキュリティ確認 2026-11-03 の M2）。
// ソースを読んで、呼び忘れ・ai_usage への直接の書き込み・テスト用の切り替えの使い忘れがないことを確かめる
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { limitMessage } from "@/lib/ai/budget";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const src = files("src").map((p) => ({ path: p.replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));

describe("文章の AI の上限の入口", () => {
  it("Anthropic の SDK を読むのは anthropic.ts だけ（ほかは型だけ）", () => {
    expect(src.filter((f) => /^import (?!type )[^\n]*from "@anthropic-ai\/sdk/m.test(f.text)).map((f) => f.path)).toEqual(["src/lib/ai/anthropic.ts"]);
  });

  it("anthropic.ts の呼び出しを使うのは、上限の入口を通す流れに渡す画面とサーバー関数だけ", () => {
    const users = src.filter((f) => f.path !== "src/lib/ai/anthropic.ts" && /from "(@\/lib\/ai\/anthropic|\.\/anthropic)"/.test(f.text) && /\bcall[A-Z]\w+/.test(f.text.match(/import \{[^}]*\} from "(@\/lib\/ai\/anthropic|\.\/anthropic)"/)?.[0] ?? ""));
    // どれも deps として run・step・draft の関数に渡すだけで、自分では呼ばない（呼ぶのは下の流れの中で、入口を通す）
    for (const f of users) expect(f.text, f.path).not.toMatch(/await call[A-Z]\w+\(/);
    expect(users.length).toBeGreaterThan(5);
  });

  it("流れの中で AI を呼ぶところ（deps.callX）は、どれも入口を通している", () => {
    const flows = src.filter((f) => f.path.startsWith("src/lib/") && /deps\.call[A-Z]\w+/.test(f.text));
    expect(flows.length).toBeGreaterThan(6);
    for (const f of flows) {
      const lines = f.text.split("\n");
      lines.forEach((line, i) => {
        if (!/deps\.call[A-Z]\w+/.test(line) || /^\s*(\/\/|\*)/.test(line) || /deps: \{/.test(line)) return;
        // 同じ行か、直前 12 行に入口がある（withAiBudget の中・budgeted で包む）。reserveAi で予約したあとに呼ぶときは、すぐ下で失敗したら予約を消す
        const around = lines.slice(Math.max(0, i - 12), i + 5).join("\n");
        expect(around, `${f.path}:${i + 1} ${line.trim()}`).toMatch(/withAiBudget|budgeted\(|(pickBudget|reservation)\.cancel\(\)/);
      });
    }
  });

  it("ai_usage に直接書くのは budget.ts だけ。テスト用の切り替え（setAiBudgetTestScope）はソースから呼ばない。前の判定（checkAiLimits）は残っていない", () => {
    expect(src.filter((f) => /from\("ai_usage"\)\s*\.(insert|update|upsert|delete)/.test(f.text)).map((f) => f.path)).toEqual(["src/lib/ai/budget.ts"]);
    expect(src.filter((f) => f.path !== "src/lib/ai/budget.ts" && /setAiBudgetTestScope/.test(f.text))).toEqual([]);
    expect(src.filter((f) => /checkAiLimits|aiLimitsFromEnv|AI_USER_MONTHLY_BUDGET_USD|AI_USER_DAILY_TURNS/.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});

describe("上限に届いたときの文言", () => {
  it("新しい人は、いつ普段の枠に戻るかを書く（M/D）", () => {
    expect(limitMessage("new_user_limit", "2026-11-10")).toContain("登録して 7 日までは、AI の利用は少なめです（今月の分に届きました）。11/10 から普段の枠になります。");
    expect(limitMessage("new_global_limit", "2026-11-10")).toContain("登録して 7 日までの方が使える今月の AI の枠が、いっぱいになりました。11/10 から使えます。");
    expect(limitMessage("user_limit", null)).toContain("来月 1 日");
    expect(limitMessage("global_limit", null)).toContain("全体");
    expect(limitMessage("daily_limit", null)).toContain("明日");
  });
});
