import { NextResponse } from "next/server";
import { z } from "zod";
import { aiConfigured, callShortenDrafts, callTidyDraft } from "@/lib/ai/anthropic";
import { aiLimitsFromEnv } from "@/lib/ai/limits";
import { MAX_TIDY_CHARS, runTidyDraft } from "@/lib/ai/tidy-draft";
import { parseDirection } from "@/lib/ai/tidy-direction";
import type { TidyOption } from "@/lib/ai/tidy-draft-apply";
import { isSameOriginJson } from "@/lib/http/same-origin";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  projectId: z.uuid(),
  text: z.string().max(MAX_TIDY_CHARS * 2),
  sns: z.array(z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]])).max(SNS_KEYS.length),
  // 整え方（形が合わない項目は「おまかせ」にする。ほかに一言は 100 字まで）
  direction: z.unknown().optional(),
});

export type TidyDraftResponse = { error?: string; options?: TidyOption[] };

const reply = (body: TidyDraftResponse, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// 本文（話し言葉など）を、選んだ SNS ごとの投稿の案に整える（docs/architecture.md の 4.34）。結果は保存しない。
// server action ではなく route handler にしたのは、画面の「やめる」で待つのをやめられるようにするため（server action は 1 つずつしか動かず、
// やめても AI の返事を待つ間は保存などを押せなくなる）。やめても、ここは最後まで動いて利用量を記録する（費用はかかっているので、上限に数える）
export async function POST(req: Request) {
  // ほかのサイトから呼ばせない（AI の費用と利用者の上限を使わせない）
  if (!isSameOriginJson(req)) return reply({ error: "この画面からは使えません。" }, 403);
  const t = inputSchema.safeParse(await req.json().catch(() => null));
  if (!t.success) return reply({ error: "入力の形式が正しくありません。" }, 400);
  if (!aiConfigured()) return reply({ error: "AI はまだ準備中です。" });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return reply({ error: "ログインし直してください。" }, 401);
  try {
    const r = await runTidyDraft(
      supabase,
      createAdminClient(),
      { callTidy: callTidyDraft, callShorten: callShortenDrafts, limits: aiLimitsFromEnv() },
      { userId, projectId: t.data.projectId, text: t.data.text, sns: t.data.sns, direction: parseDirection(t.data.direction) },
    );
    return reply(r.ok ? { options: r.options } : { error: r.message });
  } catch (e) {
    console.error("[tidy-draft]", e);
    return reply({ error: "うまくいきませんでした。時間をおいてもう一度お試しください。" }, 500);
  }
}
