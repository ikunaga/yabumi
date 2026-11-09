import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { appDescriptionSchema, filePickSchema, type CallDescriber, type CallPicker } from "./app-description";
import { envReady } from "@/lib/env-check";
import { coachTurnSchema } from "./plan-coach-schema";
import { consultTurnSchema } from "./consult-schema";
import { postIdeasSchema, type CallIdeas } from "./post-ideas";
import { aiCheckSchema, type CallCheck } from "./ai-check";
import { imageBriefSchema, type CallBrief } from "./image-brief";
import { photoIdeasSchema } from "./photo";
import type { CallPhotoIdeas } from "./photo-gen";
import { shortenSchema, type CallShorten } from "./shorten";
import { tidyDraftSchema, type CallTidy } from "./tidy-draft";
import { voiceMemoSchema, type CallVoiceMemo } from "./voice-memo";
import { PLAN_COACH_MODEL, type CallModel } from "./plan-coach";
import { AI_MAX_TOKENS, countable, type CountTokens } from "./budget";
import { AiRequestRejected, AiUnavailableError, isRejectedStatus, isUnavailableResponse } from "./provider-failure";
import { reportAiUnavailable } from "./provider-failure-report";

// Claude API のキー（ANTHROPIC_API_KEY）があるときだけ AI を使える。ないときは画面で「準備中」と出す
export function aiConfigured(): boolean {
  return envReady("AI（Claude API）", ["ANTHROPIC_API_KEY"]);
}

// SDK の自動のやり直しは使わない（タイムアウト・5xx のあとにやり直すと、請求された分が予約の見込みの何倍にもなりうる。
// セキュリティ確認 2026-11-03 の M3）。やり直すのは、処理の前に断られる 429（回数の制限）だけ（下の guardUnavailable）
let client: Anthropic | null = null;
function anthropicClient() {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 120_000 });
  return client;
}

const RATE_LIMIT_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 支払い・鍵の問題（401・402・403、残高が足りないときの 400）は、時間をおいても直らない。運営者に知らせて AiUnavailableError にする。
// ほかの 4xx（408 を除く）は処理されずに断られたので AiRequestRejected にする（上限の予約を消す。budget.ts）。429 は 2 回までやり直す。
// それ以外の失敗（5xx・タイムアウト・接続が切れた）は、そのまま投げる（請求されたかわからないので、予約は見込みの額のまま数える。呼ぶ側で「時間をおいて」と出す）
export async function guardUnavailable<T>(call: () => Promise<T>, report = reportAiUnavailable, wait = sleep): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof Anthropic.APIError) || typeof e.status !== "number") throw e;
      if (isUnavailableResponse("anthropic", e.status, e.message)) {
        const err = new AiUnavailableError("anthropic", e.status);
        await report(err);
        throw err;
      }
      if (e.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const after = Number(e.headers?.get?.("retry-after"));
        await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 20) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (isRejectedStatus(e.status)) throw new AiRequestRejected(e.status, e.message);
      throw e;
    }
  }
}

function anthropic() {
  const c = anthropicClient();
  return { beta: { messages: { parse: ((params: Parameters<typeof c.beta.messages.parse>[0]) => guardUnavailable(() => c.beta.messages.parse(params))) as typeof c.beta.messages.parse } } };
}

// 送る前に入力のトークン数を数える（count_tokens。無料。予約の見込みに使う。budget.ts）。返事の形（スキーマ）と思考の設定も同じものを渡す。
// 429 は呼び出しと同じく 2 回までやり直す（guardUnavailable）
type Wire = Pick<Anthropic.Beta.Messages.MessageCountTokensParams, "system" | "messages">;
function tokenCounter(schema: z.ZodType, effort: "low" | "medium"): CountTokens<Wire> {
  return async ({ system, messages }) => {
    const c = anthropicClient();
    const r = await guardUnavailable(() =>
      c.beta.messages.countTokens({ model: PLAN_COACH_MODEL, thinking: { type: "adaptive" }, output_config: { effort, format: betaZodOutputFormat(schema) }, system, messages }),
    );
    return r.input_tokens;
  };
}

// アカウント設計の相棒を呼ぶ。返事は構造化出力で coachTurnSchema の形に固定する。
// - effort は medium（このモデルの既定）。会話の質と費用のつり合いをとる
// - 安全のための判定で断られたときは、fallbacks: "default" で Anthropic がすすめるモデルに自動で回す
export const callPlanCoach: CallModel = countable<CallModel>(async ({ system, messages }) => {
  const res = await anthropic().beta.messages.parse({
    model: PLAN_COACH_MODEL,
    max_tokens: AI_MAX_TOKENS.plan_coach,
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
}, tokenCounter(coachTurnSchema, "medium"));

// AI と相談（docs/architecture.md の 4.23）。設計の相棒と同じく、相手の状況をくみ取って次の一手を出すので effort は medium
export const callConsult: CallModel = countable<CallModel>(async ({ system, messages }) => {
  const res = await anthropic().beta.messages.parse({
    model: PLAN_COACH_MODEL,
    max_tokens: AI_MAX_TOKENS.consult,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(consultTurnSchema) },
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
}, tokenCounter(consultTurnSchema, "medium"));

// 構造化出力で 1 回呼ぶ。effort は用途ごとに決める
function structuredCaller<T extends z.ZodType>(schema: T, maxTokens: number, effort: "low" | "medium" = "low"): CallDescriber {
  return countable<CallDescriber>(async ({ system, messages }) => {
    const res = await anthropic().beta.messages.parse({
      model: PLAN_COACH_MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort, format: betaZodOutputFormat(schema) },
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
  }, tokenCounter(schema, effort));
}

// アプリの紹介文の下書き（① 読むファイルを選ぶ、② ③ 紹介文を書く）。要約に近い作業なので effort は low にして費用を抑える
export const callFilePicker: CallPicker = structuredCaller(filePickSchema, AI_MAX_TOKENS.file_pick);
export const callAppDescriber: CallDescriber = structuredCaller(appDescriptionSchema, AI_MAX_TOKENS.app_description);
// 投稿のネタ（docs/architecture.md の 4.15）。口調に合わせて書き分け、苦労話を作らないなどの判断が要るので effort は medium
export const callPostIdeas: CallIdeas = structuredCaller(postIdeasSchema, AI_MAX_TOKENS.post_ideas, "medium");
// AI っぽさチェック（docs/architecture.md の 4.20）。文面を読んで指摘するだけの軽い作業なので effort は low
export const callAiCheck: CallCheck = structuredCaller(aiCheckSchema, AI_MAX_TOKENS.ai_check, "low");
// 画像の文字の案（docs/architecture.md の 4.25）。投稿から短い文字を拾う軽い作業なので effort は low
export const callImageBrief: CallBrief = structuredCaller(imageBriefSchema, AI_MAX_TOKENS.image_brief, "low");
// AI で写真・絵をつくるときの、場面の説明の案（docs/architecture.md の 4.25 の ②）。本文から場面を 2〜3 考える軽い作業なので effort は low
export const callPhotoIdeas: CallPhotoIdeas = structuredCaller(photoIdeasSchema, AI_MAX_TOKENS.photo_ideas, "low");
// 上限を超えた下書きを縮める（docs/architecture.md の 4.15「文字数の上限」）。超えたときだけ呼ぶ。削るだけの軽い作業なので effort は low
export const callShortenDrafts: CallShorten = structuredCaller(shortenSchema, AI_MAX_TOKENS.shorten, "low");
// AI で投稿に整える（docs/architecture.md の 4.34）。話し言葉を絞って書き分け、誇張や作り話をしない判断が要るので effort は medium
export const callTidyDraft: CallTidy = structuredCaller(tidyDraftSchema, AI_MAX_TOKENS.tidy_draft, "medium");
// 書き方（文調のメモ）を、本人の投稿から読み取る（docs/design/voice-from-posts.md の 4）。数えた値を渡して観察を書くだけなので effort は low
export const callVoiceMemo: CallVoiceMemo = structuredCaller(voiceMemoSchema, AI_MAX_TOKENS.voice_memo, "low");
