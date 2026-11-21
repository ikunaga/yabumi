"use server";

import { getAiBudgetState } from "./budget-status";
import type { AiBudgetState } from "./budget-status-text";

// 画面の中の AI のボタンが、押す前に枠の状態を読む（読むだけ。本人の分だけ。DB の ai_budget_status は auth.uid() で数える）
// ふだんの用途だけ（自動投稿の枠は、画面のボタンでは使わない）
const PURPOSES = ["consult", "account_plan", "post_ideas", "tidy_draft", "ai_check", "image_brief", "image_photo_idea", "voice_memo", "post_format", "post_format_round", "app_description"] as const;
export type AiPurpose = (typeof PURPOSES)[number];

export async function aiBudgetStateAction(purpose: AiPurpose): Promise<AiBudgetState | null> {
  if (!(PURPOSES as readonly string[]).includes(purpose)) return null;
  try {
    return await getAiBudgetState(purpose);
  } catch {
    return null;
  }
}
