"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { revokeDeps } from "@/lib/sns/adapters";
import { linkAccountToProject, replacedCookie } from "@/lib/sns/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { choosePages } from "./pages";

const inputSchema = z.object({
  projectId: z.uuid(),
  choiceId: z.uuid(),
  // 1 つのプロジェクトに SNS ごとに 1 つなので、ページも 1 つだけ（docs/architecture.md の 4.6）
  pageId: z.string().regex(/^\d{1,30}$/),
});

// つなぐページを選んだとき（docs/architecture.md の 4.21）。置き場は本人の・期限内のものだけ使える（choosePages が確かめる）
export async function selectFacebookPage(projectId: string, choiceId: string, pageId: string): Promise<{ error?: string }> {
  const parsed = inputSchema.safeParse({ projectId, choiceId, pageId });
  if (!parsed.success) return { error: "つなぐページを 1 つ選んでください。" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const admin = createAdminClient();
  const result = await choosePages(admin, { choiceId, ownerId: userId, pageIds: [parsed.data.pageId] });
  if (!result || result.projectId !== projectId) {
    return { error: "選ぶ時間（15 分）が過ぎたか、すでにつなぎました。もう一度「つなぐ」から始めてください。" };
  }
  if (result.accountIds[0]) {
    // プロジェクトに付ける。別のページがつながっていたら付け替える
    try {
      const replaced = await linkAccountToProject(admin, { ownerId: userId, projectId, accountId: result.accountIds[0] }, revokeDeps());
      if (replaced.length) (await cookies()).set(replacedCookie(projectId, replaced));
    } catch (e) {
      console.error("[facebook] 接続に失敗しました", e instanceof Error ? e.message : e);
      return { error: "つなげませんでした。もう一度お試しください。" };
    }
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}?connected=facebook`);
}
