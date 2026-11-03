"use server";

import { revalidatePath } from "next/cache";
import { glossary, isGlossaryKey } from "@/lib/glossary/terms";
import { isUuid } from "@/lib/uuid";
import { createClient } from "@/lib/supabase/server";
import { isTipTrigger, tipByKey, TIPS } from "./tips";

// 学びの表示（4.47）の操作。本人は DB の関数の中で auth.uid() から取る（ログインしていなければ断られる）

export type ShownTip = { text: string; term: { key: string; label: string } };

// きっかけ（作業が終わった・URL を入れた など）で、ひとことを 1 つ出すかを DB に聞く。出さないときは null（1 日 1 回まで・オフ）
export async function claimTip(trigger: unknown): Promise<ShownTip | null> {
  if (!isTipTrigger(trigger)) return null;
  const candidates = TIPS[trigger].filter((t) => isGlossaryKey(t.term)).map((t) => t.key);
  if (candidates.length === 0) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data, error } = await supabase.rpc("claim_learning_tip", { p_candidates: candidates });
  if (error) {
    console.error("[claimTip]", error.message);
    return null;
  }
  const tip = data ? tipByKey(data) : null;
  if (!tip || !isGlossaryKey(tip.term)) return null;
  return { text: tip.text, term: { key: tip.term, label: glossary[tip.term].label } };
}

// 今日の用語を閉じる（その日は出さない）
export async function dismissTodayTerm(projectId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_learning_today_term");
  if (error) console.error("[dismissTodayTerm]", error.message);
  if (typeof projectId === "string" && isUuid(projectId)) revalidatePath(`/projects/${projectId}`);
}
