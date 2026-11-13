// 文章の AI（Claude）を呼ぶところは、すべて上限の入口（src/lib/ai/budget.ts の withAiBudget・reserveAi・budgeted）を通す（セキュリティ確認 2026-11-03 の M2）。
// ソースを読んで、呼び忘れ・ai_usage への直接の書き込み・テスト用の切り替えの使い忘れがないことを確かめる
import { voiceMemoSchema } from "@/lib/ai/voice-memo";
import { postFormatProposalsSchema } from "@/lib/ai/post-format-ai";
import { roundProposalsSchema } from "@/lib/ai/format-round-ai";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AI_MAX_RESERVATION_USD, AI_MAX_TOKENS, COUNTED_TOKENS_MARGIN, REQUEST_OVERHEAD_TOKENS, estimateRequestUsd, limitMessage, reserveEstimateUsd, tokenCounterOf, type AiCall } from "@/lib/ai/budget";
import * as calls from "@/lib/ai/anthropic";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { coachTurnSchema } from "@/lib/ai/plan-coach-schema";
import { consultTurnSchema } from "@/lib/ai/consult-schema";
import { appDescriptionSchema, filePickSchema } from "@/lib/ai/app-description";
import { postIdeasSchema } from "@/lib/ai/post-ideas";
import { aiCheckSchema } from "@/lib/ai/ai-check";
import { imageBriefSchema } from "@/lib/ai/image-brief";
import { photoIdeasSchema } from "@/lib/ai/photo";
import { shortenSchema } from "@/lib/ai/shorten";
import { tidyDraftSchema } from "@/lib/ai/tidy-draft";

vi.mock("server-only", () => ({}));

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
        // tokenCounterOf(deps.callX) は数える関数を取り出すだけ（呼ばない）
        if (!/deps\.call[A-Z]\w+/.test(line.replace(/tokenCounterOf\(deps\.call[A-Z]\w+\)/g, "")) || /^\s*(\/\/|\*)/.test(line) || /deps: \{/.test(line)) return;
        // 同じ行か、直前 12 行に入口がある（withAiBudget の中・budgeted で包む）。reserveAi で予約したあとに呼ぶときは、すぐ下で失敗したら予約を消す
        const around = lines.slice(Math.max(0, i - 12), i + 5).join("\n");
        expect(around, `${f.path}:${i + 1} ${line.trim()}`).toMatch(/withAiBudget|budgeted\(|(pickBudget|reservation)\.fail\(/);
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

// 用途（ai_usage.purpose）ごとに使う呼び出しの種類
const PURPOSE_CALLS: Record<string, AiCall[]> = {
  account_plan: ["plan_coach"],
  consult: ["consult", "shorten"],
  app_description: ["file_pick", "app_description"],
  post_ideas: ["post_ideas", "shorten"],
  ai_check: ["ai_check"],
  image_brief: ["image_brief"],
  image_photo_idea: ["photo_ideas"],
  tidy_draft: ["tidy_draft", "shorten"],
  voice_memo: ["voice_memo"],
  post_format: ["post_format"],
  post_format_round: ["post_format_round"],
};
const SCHEMAS: Record<AiCall, z.ZodType> = {
  plan_coach: coachTurnSchema,
  consult: consultTurnSchema,
  file_pick: filePickSchema,
  app_description: appDescriptionSchema,
  post_ideas: postIdeasSchema,
  ai_check: aiCheckSchema,
  image_brief: imageBriefSchema,
  photo_ideas: photoIdeasSchema,
  shorten: shortenSchema,
  tidy_draft: tidyDraftSchema,
  voice_memo: voiceMemoSchema,
  post_format: postFormatProposalsSchema,
  post_format_round: roundProposalsSchema,
};

// いちばん新しいマイグレーションの reserve_ai_usage の、用途ごとの下限の表
function dbFloors(): Record<string, number> {
  const dir = "supabase/migrations";
  const latest = readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => readFileSync(join(dir, n), "utf8"))
    .filter((t) => /function public\.reserve_ai_usage\(/.test(t))
    .at(-1)!;
  return Object.fromEntries([...latest.matchAll(/when '(\w+)' then ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
}

describe("予約の見込み（その呼び出しで起こりうる最大の額。セキュリティ確認 2026-11-03 の M3）", () => {
  const empty = { system: [], messages: [] };

  it("送る中身をすべてトークンにし（1 トークン 1 バイト以上）、出力の上限まで出し、いちばん高いモデルで、入力がすべてキャッシュへの書き込みでも、見込みを超えない", () => {
    const request = { system: [{ type: "text", text: "あなたは相棒です。🙂".repeat(200) }], messages: [{ role: "user", content: [{ type: "text", text: "こんにちは".repeat(300) }] }] };
    for (const call of Object.keys(AI_MAX_TOKENS) as AiCall[]) {
      const estimate = reserveEstimateUsd(call, request);
      const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
      for (const model of ["claude-opus-5-5", "claude-opus-5", "unknown-fallback-model"]) {
        const worst = { inputTokens: 0, cacheWriteTokens: bytes + REQUEST_OVERHEAD_TOKENS, cacheReadTokens: 0, outputTokens: AI_MAX_TOKENS[call] };
        expect(estimateCostUsd(model, worst), `${call} ${model}`).toBeLessThanOrEqual(estimate);
        expect(estimateCostUsd(model, { ...worst, inputTokens: worst.cacheWriteTokens, cacheWriteTokens: 0 })).toBeLessThanOrEqual(estimate);
      }
    }
    // 送る中身が大きいほど見込みも大きい
    expect(reserveEstimateUsd("consult", { ...request, messages: [...request.messages, ...request.messages] })).toBeGreaterThan(reserveEstimateUsd("consult", request));
  });

  it("足される分（REQUEST_OVERHEAD_TOKENS）は、どの返事の形の JSON スキーマのバイト数より大きい", () => {
    for (const [call, schema] of Object.entries(SCHEMAS)) {
      expect(Buffer.byteLength(JSON.stringify(z.toJSONSchema(schema)), "utf8"), call).toBeLessThan(REQUEST_OVERHEAD_TOKENS / 2);
    }
  });

  it("anthropic.ts の max_tokens は、見込みと同じ表（AI_MAX_TOKENS）から取る。SDK の自動のやり直しは使わない", () => {
    const text = readFileSync("src/lib/ai/anthropic.ts", "utf8");
    expect(text).not.toMatch(/max_tokens: \d/);
    expect(text).not.toMatch(/structuredCaller\(\w+, \d/);
    expect(text).toMatch(/maxRetries: 0/);
    for (const call of Object.keys(AI_MAX_TOKENS)) expect(text, call).toContain(`AI_MAX_TOKENS.${call}`);
  });

  it("DB の関数の用途ごとの下限は、その用途のアプリの見込みの最小（送る中身が空のとき）と同じ（下限がアプリの見込みを持ち上げることはない）", () => {
    const floors = dbFloors();
    expect(Object.keys(floors).sort()).toEqual(Object.keys(PURPOSE_CALLS).sort());
    for (const [purpose, calls] of Object.entries(PURPOSE_CALLS)) {
      const min = Math.min(...calls.map((c) => reserveEstimateUsd(c, empty)));
      expect(floors[purpose], purpose).toBeLessThanOrEqual(min);
      expect(floors[purpose], purpose).toBeGreaterThan(min - 0.01);
    }
  });

  it("ソースで予約に渡している用途（purpose）は、どれも DB の関数の表にある（知らない用途は断られる）", () => {
    const floors = dbFloors();
    const used = new Set(
      src
        .filter((f) => /from "(\.\/budget|@\/lib\/ai\/budget)"/.test(f.text))
        .flatMap((f) => [...f.text.matchAll(/purpose: "(\w+)"/g)].map((m) => m[1])),
    );
    expect(used.size).toBeGreaterThanOrEqual(8);
    for (const p of used) expect(Object.keys(floors), p).toContain(p);
    expect([...used].sort()).toEqual(Object.keys(PURPOSE_CALLS).sort());
  });

  it("普段の長さの相談（20 往復）は、1 回の上限（$1）に届かない", () => {
    // 相談の system（約 15KB）・いまの状況（10KB とみる）・利用者の発言 100 字・AI の返事の JSON 1,600 バイト（ローカルの会話の平均）
    const system = [{ type: "text", text: "あ".repeat(5000) }];
    const turns = Array.from({ length: 20 }, () => [
      { role: "user", content: [{ type: "text", text: "あ".repeat(100) }] },
      { role: "assistant", content: [{ type: "text", text: "a".repeat(1600) }] },
    ]).flat();
    const estimate = reserveEstimateUsd("consult", { system, messages: [...turns, { role: "system", content: "あ".repeat(3400) }] });
    expect(estimate).toBeLessThan(AI_MAX_RESERVATION_USD);
  });
});

describe("count_tokens で数えた見込み", () => {
  const request = { system: [{ type: "text", text: "相談の相棒です。".repeat(300) }], messages: [{ role: "user", content: [{ type: "text", text: "長い相談".repeat(500) }] }] };

  it("数えたトークン数にゆとりを掛けたもの（バイト数の見積もりより大きくはしない）。そこまで使っても見込みを超えない", () => {
    const counted = 4000;
    const estimate = reserveEstimateUsd("consult", request, counted);
    expect(estimate).toBeLessThan(reserveEstimateUsd("consult", request));
    const worst = { inputTokens: 0, cacheWriteTokens: Math.ceil(counted * COUNTED_TOKENS_MARGIN), cacheReadTokens: 0, outputTokens: AI_MAX_TOKENS.consult };
    expect(estimateCostUsd("unknown-fallback-model", worst)).toBeLessThanOrEqual(estimate);
    // 数えた値がバイト数の見積もりより大きいときは、バイト数のほう
    expect(reserveEstimateUsd("consult", request, 10_000_000)).toBe(reserveEstimateUsd("consult", request));
  });

  it("数えられれば数えた値で、失敗・0・数える関数がないときはバイト数で見積もる（上限を超えない側）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await estimateRequestUsd("consult", request, async () => 4000)).toBe(reserveEstimateUsd("consult", request, 4000));
    expect(await estimateRequestUsd("consult", request, async () => Promise.reject(new Error("overloaded")))).toBe(reserveEstimateUsd("consult", request));
    expect(await estimateRequestUsd("consult", request, async () => 0)).toBe(reserveEstimateUsd("consult", request));
    expect(await estimateRequestUsd("consult", request)).toBe(reserveEstimateUsd("consult", request));
    vi.restoreAllMocks();
  });

  it("数えるのに 2 秒を超えたら知らせる（見込みは数えた値のまま）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (t += 1500));
    expect(await estimateRequestUsd("consult", request, async () => 4000)).toBe(reserveEstimateUsd("consult", request, 4000));
    expect(warn).toHaveBeenCalledTimes(0);
    t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (t += 2500));
    await estimateRequestUsd("consult", request, async () => 4000);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("anthropic.ts の呼び出しには、どれも数える関数が付いている", () => {
    const exported = Object.entries(calls).filter(([k, v]) => /^call[A-Z]/.test(k) && typeof v === "function");
    expect(exported.length).toBe(13);
    for (const [k, v] of exported) expect(tokenCounterOf(v as never), k).toBeTypeOf("function");
  });
});
