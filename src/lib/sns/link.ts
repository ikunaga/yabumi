import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { purgeSnsDataOf } from "./accounts";
import { revokeSnsAccess, type RevokeDeps } from "./revoke";

type Admin = SupabaseClient<Database>;

export type ReplacedAccount = { name: string; removed: boolean; movedTargets: number };

// つないだアカウントをプロジェクトに付ける（どの SNS の callback も、Facebook のページの選択も、これを通す。docs/architecture.md の 4.6）。
// 1 つのプロジェクトに SNS ごとに 1 つ。同じ SNS の別のアカウントがつながっていたら、送る前の配信先を新しいアカウントに移し、
// 古いつながりを外す（switch_project_sns_account）。古いアカウントがほかのプロジェクトで使われていなければ、
// 「外す」と同じように、SNS の側で取り消し（X）、SNS から受け取ったもの（数字、SNS 上の投稿の ID と URL）とアカウント・トークンを消す。
// ownerId は、サーバーで確かめたログイン中の利用者。返すのは外した古いアカウント（画面の「@古い を外し、@新しい をつなぎました」に使う）
export async function linkAccountToProject(
  admin: Admin,
  args: { ownerId: string; projectId: string; accountId: string },
  deps: RevokeDeps,
): Promise<ReplacedAccount[]> {
  const { data, error } = await admin.rpc("switch_project_sns_account", {
    p_owner_id: args.ownerId,
    p_project_id: args.projectId,
    p_account_id: args.accountId,
  });
  if (error) throw error;

  const replaced: ReplacedAccount[] = [];
  for (const old of data ?? []) {
    const name = old.old_handle ? `@${old.old_handle}` : old.old_display_name || "前のアカウント";
    if (old.still_used) {
      replaced.push({ name, removed: false, movedTargets: old.moved_targets });
      continue;
    }
    const { data: acc } = await admin.from("social_accounts").select("sns").eq("id", old.old_account_id).eq("owner_id", args.ownerId).maybeSingle();
    if (acc) {
      // 取り消しに失敗しても、矢書の側のトークンは消すので、それ以上は使われない
      await revokeSnsAccess(admin, old.old_account_id, acc.sns, deps);
      await purgeSnsDataOf(admin, [old.old_account_id]);
      // トークンはアカウントの行からカスケードで消える。配信先からの参照は空になる（本文と送った記録は残る）
      const { error: delError } = await admin.from("social_accounts").delete().eq("id", old.old_account_id).eq("owner_id", args.ownerId);
      if (delError) throw delError;
    }
    replaced.push({ name, removed: true, movedTargets: old.moved_targets });
  }
  return replaced;
}

// 付け替えたことを、戻った先の画面に 1 回だけ伝える（アカウント名を URL に入れないため、短い期限の cookie で渡す）
export const SNS_REPLACED_COOKIE = "yabumi_sns_replaced";

export function replacedCookie(projectId: string, replaced: ReplacedAccount[]) {
  return {
    name: SNS_REPLACED_COOKIE,
    value: encodeURIComponent(JSON.stringify(replaced.map((r) => r.name))),
    path: `/projects/${projectId}`,
    maxAge: 120,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function readReplacedCookie(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const v = JSON.parse(decodeURIComponent(value));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}
