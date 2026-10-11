import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { GitHubUser, Installation } from "./api";

type Db = SupabaseClient<Database>;

// 利用者の認可で確かめた、本人が使えるインストールと、その中で本人が読めるリポジトリ。
// repoIds が null なのは、インストール先が本人の個人アカウントのとき（インストールの範囲すべて。範囲は本人がインストールのときに選んだもの）
export type VerifiedInstallation = Installation & { repoIds: number[] | null };

// /user/installations は、本人がインストールのリポジトリのどれか 1 つにでも権限があれば返す。
// 組織のインストールや、他人の個人リポジトリの共同作業者として見えるインストールでは、インストールのトークンで読める範囲が
// 本人の権限より広いので、本人が読めるリポジトリ（/user/installations/{id}/repositories）に絞って記録する
export async function verifyInstallations(
  appId: string,
  user: GitHubUser,
  installations: Installation[],
  listUserRepoIds: (installationId: number) => Promise<number[]>,
): Promise<VerifiedInstallation[]> {
  const mine = installations.filter((i) => String(i.app_id) === String(appId));
  return Promise.all(
    mine.map(async (i) => ({
      ...i,
      repoIds: i.account.type === "User" && i.account.id === user.id ? null : await listUserRepoIds(i.id),
    })),
  );
}

// 確かめたインストールを記録する。消えたインストールは外し（つないでいたリポジトリも外れる）、
// 本人が読めなくなったリポジトリのつなぎも外す。RLS を通らないクライアントで呼ぶ
export async function syncInstallations(admin: Db, ownerId: string, installations: VerifiedInstallation[]): Promise<number> {
  if (installations.length) {
    const { error } = await admin.from("github_installations").upsert(
      installations.map((i) => ({
        owner_id: ownerId,
        installation_id: i.id,
        account_login: i.account.login,
        account_type: i.account.type,
        repo_ids: i.repoIds,
      })),
      { onConflict: "owner_id,installation_id" },
    );
    if (error) throw error;
  }
  const keep = installations.map((i) => i.id);
  let del = admin.from("github_installations").delete().eq("owner_id", ownerId);
  if (keep.length) del = del.not("installation_id", "in", `(${keep.join(",")})`);
  const { error } = await del;
  if (error) throw error;

  for (const i of installations) {
    if (i.repoIds === null) continue;
    let unlink = admin.from("project_github_repos").delete().eq("owner_id", ownerId).eq("installation_id", i.id);
    if (i.repoIds.length) unlink = unlink.not("repo_id", "in", `(${i.repoIds.join(",")})`);
    const { error: e } = await unlink;
    if (e) throw e;
  }
  return installations.length;
}

type InstallationAccess = { installation_id: number; repo_ids: number[] | null };

// 記録したインストールで、本人がそのリポジトリを読めるか
export function canReadRepo(installation: InstallationAccess | null | undefined, repoId: number): boolean {
  if (!installation) return false;
  return installation.repo_ids === null || installation.repo_ids.includes(repoId);
}

// 本人が読めるリポジトリか（DB の記録で確かめる）。リポジトリをつなぐとき・読む直前に通す
export async function userCanReadRepo(db: Db, ownerId: string, installationId: number, repoId: number): Promise<boolean> {
  const { data, error } = await db
    .from("github_installations")
    .select("installation_id, repo_ids")
    .eq("owner_id", ownerId)
    .eq("installation_id", installationId)
    .maybeSingle();
  if (error) throw error;
  return canReadRepo(data, repoId);
}

export type ReadableRepoLink = { installationId: number; repoId: number; fullName: string; defaultBranch: string };

// プロジェクトにつないだリポジトリを、本人がいまも読めるときだけ返す。リポジトリを読む機能（紹介文の下書き、
// コミットからのネタ出しなど）は、読む直前にこれを通す。プロジェクトが他人のもの・つないでいない・読めないときは null
export async function readableRepoLink(db: Db, ownerId: string, projectId: string): Promise<ReadableRepoLink | null> {
  const { data: row, error } = await db
    .from("project_github_repos")
    .select("installation_id, repo_id, full_name, default_branch")
    .eq("project_id", projectId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!row || !(await userCanReadRepo(db, ownerId, row.installation_id, row.repo_id))) return null;
  return { installationId: row.installation_id, repoId: row.repo_id, fullName: row.full_name, defaultBranch: row.default_branch };
}
