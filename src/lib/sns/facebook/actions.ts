"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { choosePages } from "./pages";

const inputSchema = z.object({
  projectId: z.uuid(),
  choiceId: z.uuid(),
  pageIds: z.array(z.string().regex(/^\d{1,30}$/)).min(1).max(50),
});

// つなぐページを選んだとき（docs/architecture.md の 4.21）。置き場は本人の・期限内のものだけ使える（choosePages が確かめる）
export async function selectFacebookPages(projectId: string, choiceId: string, pageIds: string[]): Promise<{ error?: string }> {
  const parsed = inputSchema.safeParse({ projectId, choiceId, pageIds });
  if (!parsed.success) return { error: "つなぐページを 1 つ以上選んでください。" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const result = await choosePages(createAdminClient(), { choiceId, ownerId: userId, pageIds: parsed.data.pageIds });
  if (!result || result.projectId !== projectId) {
    return { error: "選ぶ時間（15 分）が過ぎたか、すでにつなぎました。もう一度「つなぐ」から始めてください。" };
  }
  if (result.accountIds.length) {
    // プロジェクトとの紐づけは利用者の権限で行う（RLS で自分のものどうしだけ）
    const { error } = await supabase
      .from("project_social_accounts")
      .upsert(
        result.accountIds.map((id) => ({ project_id: projectId, social_account_id: id })),
        { ignoreDuplicates: true },
      );
    if (error) return { error: "つなげませんでした。もう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}?connected=facebook`);
}
