import type { SupabaseClient } from "@supabase/supabase-js";
import { drainLinkDomainRemovals, type LinkDomainDeps } from "@/lib/links/domains";
import { revokeSnsAccess, type RevokeDeps, type RevokeResult } from "@/lib/sns/revoke";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

export type WithdrawDeps = RevokeDeps & {
  // GitHub App のインストールを外す。GitHub の設定がないときは渡さない
  uninstallGithub?: (installationId: number) => Promise<void>;
  // 短縮リンクの利用者のドメインを Vercel から外す（D28）。Vercel の設定がないときは渡さない
  linkDomains?: LinkDomainDeps;
  // 退会する人のいまのログインのアクセストークン。渡すと、利用者を消す前に、すべての端末のログインを切る（signOut の global）
  accessToken?: string;
};

export type WithdrawReport = {
  sns: { sns: string; revoke: RevokeResult }[];
  github: { installationId: number; result: "uninstalled" | "shared" | "failed" | "skipped" }[];
};

// 退会の本体（docs/architecture.md の 4.14）。本人の確認（パスワード）は呼ぶ側で済ませておく。RLS を通らないクライアントで呼ぶ。
// 1. SNS 側の連携を、解除できるもの（X）は解除する  2. GitHub App のインストールを外す（ほかの yabumi の利用者が使っていなければ）
// 3. 利用者を消す。auth.users からのカスケードで本人のデータがすべて消え、費用の記録（ai_usage、sns_api_usage）は紐づけが空になって残る。
// 4. 短縮リンクの利用者のドメインを Vercel から外す（3 のカスケードで DB のトリガーが外す列に積む。外せなければ次の機会にやり直す）
// 1・2・4 は失敗しても続ける（yabumi の側のトークンは 3 で消えるので、それ以上は使われない）。
// 3 の前に、すべての端末のログインを切る（signOut の global。セキュリティ確認 2026-11-13 の 2 回目の参考）。消したあとは利用者が見つからず切れないので、前にする。
// 利用者を消すとログインの記録（auth.sessions・refresh_tokens）も消えるので、どちらでもほかの端末は取り直せなくなる。
// 出したアクセストークン（JWT）は期限（ふつう 1 時間）まで署名だけで通る（getClaims）が、本人の行は消え、費用のかかる呼び出しは予約（reserve_*）が外部キーで断る
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

  if (deps.accessToken) {
    const { error: signOutError } = await admin.auth.admin.signOut(deps.accessToken, "global");
    if (signOutError) console.error("[withdraw] すべての端末のログインを切れませんでした（利用者を消すと切れる）", signOutError.message);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
  if (deps.linkDomains) {
    await drainLinkDomainRemovals(admin, deps.linkDomains).catch((e) => console.error("[withdraw] 利用者のドメインを Vercel から外せませんでした", e instanceof Error ? e.message : e));
  }
  return report;
}
