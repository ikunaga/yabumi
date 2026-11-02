import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { notifyOperatorWithin, type OperatorMail, type OperatorNotifyDeps, type OperatorNotifyResult } from "@/lib/notify/operator";
import type { AiProvider, AiUnavailableError } from "./provider-failure";

// 外の AI が支払い・鍵の問題で使えないことを、運営者にメールで知らせる（provider-failure.ts の続き。サーバーだけ）。
// 知らせには状態番号と直す場所の手がかりだけを書き、鍵・指示文・利用者の情報は書かない

const PROVIDER_NAME: Record<AiProvider, string> = { gemini: "AI の画像（Gemini API）", anthropic: "AI（Claude API）" };

// 直す場所の手がかり（状態番号ごと）
function hint(provider: AiProvider, status: number): string {
  if (provider === "gemini") {
    if (status === 402) return "Google AI Studio で、鍵（GEMINI_API_KEY）を作った Google Cloud のプロジェクトの課金（支払いの設定・前払いの残高）を確かめてください（docs/deploy.md の 24）。";
    if (status === 403) return "Google Cloud のそのプロジェクトで Generative Language API が有効か、鍵の制限（使える API・接続元）で弾かれていないかを確かめてください。";
    return "Vercel の環境変数 GEMINI_API_KEY の値が、Google AI Studio の鍵と同じか（消した・作り直した鍵でないか）を確かめてください。";
  }
  if (status === 401) return "Vercel の環境変数 ANTHROPIC_API_KEY の値が、Claude Console の鍵と同じか（消した・作り直した鍵でないか）を確かめてください。";
  if (status === 403) return "Claude Console で、鍵のワークスペースの権限と、使っているモデルを使えるかを確かめてください。";
  return "Claude Console の Billing で、クレジットの残高と支払い方法を確かめてください。";
}

export function unavailableMail(provider: AiProvider, status: number): OperatorMail {
  return {
    subject: `${PROVIDER_NAME[provider]}が ${status} を返して使えません`,
    text: [
      `${PROVIDER_NAME[provider]}が状態番号 ${status} を返しました。支払い・鍵の問題で、時間をおいても直りません。`,
      "利用者の画面には「いま使えません（運営者に知らせました）」と出しています（枚数・費用には数えていません）。",
      "",
      `直す場所: ${hint(provider, status)}`,
      "",
      "同じ理由の知らせは 1 時間に 1 回までです。",
    ].join("\n"),
  };
}

export function unavailableKey(provider: AiProvider, status: number, scope?: string): string {
  return `ai_unavailable:${provider}:${status}${scope ? `:${scope}` : ""}`;
}

// 運営者に知らせる（1 時間に 1 回まで）。知らせに失敗しても、利用者への返事は止めない
export async function reportAiUnavailable(
  e: AiUnavailableError,
  deps: { admin?: SupabaseClient<Database>; notify?: OperatorNotifyDeps; scope?: string } = {},
): Promise<OperatorNotifyResult | "skipped" | "error"> {
  console.error(`[ai] ${PROVIDER_NAME[e.provider]}が ${e.status} を返しました（支払い・鍵の問題）`);
  try {
    // 管理用のクライアントは、知らせるときだけ読み込む（このファイルを読み込むだけでは、DB の設定を求めない）
    const admin = deps.admin ?? (await import("@/lib/supabase/admin")).createAdminClient();
    return await notifyOperatorWithin(admin, unavailableKey(e.provider, e.status, deps.scope), "1 hour", unavailableMail(e.provider, e.status), deps.notify);
  } catch (err) {
    console.error("[ai] 運営者に知らせられませんでした", err instanceof Error ? err.message : err);
    return "error";
  }
}

