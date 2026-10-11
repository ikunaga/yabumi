import type { SupabaseClient } from "@supabase/supabase-js";
import { revokeSnsAccess, type RevokeDeps, type RevokeResult } from "@/lib/sns/revoke";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

export type WithdrawDeps = RevokeDeps & {
  // GitHub App のインストールを外す。GitHub の設定がないときは渡さない
  uninstallGithub?: (installationId: number) => Promise<void>;
};

export type WithdrawReport = {
  sns: { sns: string; revoke: RevokeResult }[];
  github: { installationId: number; result: "uninstalled" | "shared" | "failed" | "skipped" }[];
};

// 退会の本体（docs/architecture.md の 4.14）。本人の確認（パスワード）は呼ぶ側で済ませておく。RLS を通らないクライアントで呼ぶ。
// 1. SNS 側の連携を、解除できるもの（X）は解除する  2. GitHub App のインストールを外す（ほかの矢書の利用者が使っていなければ）
// 3. 利用者を消す。auth.users からのカスケードで本人のデータがすべて消え、費用の記録（ai_usage、sns_api_usage）は紐づけが空になって残る。
// 1・2 は失敗しても続ける（矢書の側のトークンは 3 で消えるので、それ以上は使われない）
export async function withdrawUser(admin: Admin, userId: string, deps: WithdrawDeps): Promise<WithdrawReport> {
  const report: WithdrawReport = { sns: [], github: [] };

  const { data: accounts, error: accountsError } = await admin.from("social_accounts").select("id, sns").eq("owner_id", userId);
  if (accountsError) throw accountsError;
  for (const a of accounts) report.sns.push({ sns: a.sns, revoke: await revokeSnsAccess(admin, a.id, a.sns, deps) });

  const { data: installs, error: installsError } = await admin.from("github_installations").select("installation_id").eq("owner_id", userId);
  if (installsError) throw installsError;
  for (const { installation_id: id } of installs) {
    const { count } = await admin
      .from("github_installations")
      .select("owner_id", { count: "exact", head: true })
      .eq("installation_id", id)
      .neq("owner_id", userId);
    if ((count ?? 0) > 0) {
      report.github.push({ installationId: id, result: "shared" });
    } else if (!deps.uninstallGithub) {
      report.github.push({ installationId: id, result: "skipped" });
    } else {
      try {
        await deps.uninstallGithub(id);
        report.github.push({ installationId: id, result: "uninstalled" });
      } catch (e) {
        console.error("[withdraw] GitHub App のインストールを外せませんでした", e instanceof Error ? e.message : e);
        report.github.push({ installationId: id, result: "failed" });
      }
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
  return report;
}
