import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { appDescriptionSchema, filePickSchema, type CallDescriber, type CallPicker } from "./app-description";
import { envReady } from "@/lib/env-check";
import { coachTurnSchema } from "./plan-coach-schema";
import { PLAN_COACH_MODEL, type CallModel } from "./plan-coach";

// Claude API のキー（ANTHROPIC_API_KEY）があるときだけ AI を使える。ないときは画面で「準備中」と出す
export function aiConfigured(): boolean {
  return envReady("AI（Claude API）", ["ANTHROPIC_API_KEY"]);
}

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return client;
}

// アカウント設計の相棒を呼ぶ。返事は構造化出力で coachTurnSchema の形に固定する。
// - effort は medium（このモデルの既定）。会話の質と費用のつり合いをとる
// - 安全のための判定で断られたときは、fallbacks: "default" で Anthropic がすすめるモデルに自動で回す
export const callPlanCoach: CallModel = async ({ system, messages }) => {
  const res = await anthropic().beta.messages.parse({
    model: PLAN_COACH_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(coachTurnSchema) },
    system,
    messages,
  });
  const u = res.usage;
  return {
    turn: res.stop_reason === "refusal" ? null : res.parsed_output,
    stopReason: res.stop_reason,
    model: res.model,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
    },
  };
};

// アプリの紹介文の下書き（① 読むファイルを選ぶ、② ③ 紹介文を書く）。要約に近い作業なので effort は low にして費用を抑える
function structuredCaller<T extends z.ZodType>(schema: T, maxTokens: number): CallDescriber {
  return async ({ system, messages }) => {
    const res = await anthropic().beta.messages.parse({
      model: PLAN_COACH_MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      system,
      messages,
    });
    const u = res.usage;
    return {
      output: res.stop_reason === "refusal" ? null : res.parsed_output,
      stopReason: res.stop_reason,
      model: res.model,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
      },
    };
  };
}

export const callFilePicker: CallPicker = structuredCaller(filePickSchema, 2000);
export const callAppDescriber: CallDescriber = structuredCaller(appDescriptionSchema, 4000);
