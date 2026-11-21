"use client";

import { useEffect, useState } from "react";
import { aiBudgetStateAction, type AiPurpose } from "@/lib/ai/budget-status-actions";
import { aiBlockedText, type AiBlockedWords, type AiBudgetState } from "@/lib/ai/budget-status-text";

// 画面の中の AI のボタン用: 開いたときに 1 回、その用途の枠の状態を読む（2026-11-21 オーナーの依頼）。
// blocked: 使い切っていて押せない理由（使えるときは null）。読めないときも null（押したときに今までどおり断る）
export const INLINE_BLOCKED_WORDS: AiBlockedWords = { can: "AI を使えます" };

export function useAiQuota(purpose: AiPurpose, enabled = true): { state: AiBudgetState | null; blocked: string | null } {
  const [state, setState] = useState<AiBudgetState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    aiBudgetStateAction(purpose).then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [purpose, enabled]);
  return { state, blocked: state ? aiBlockedText(state, INLINE_BLOCKED_WORDS) : null };
}
