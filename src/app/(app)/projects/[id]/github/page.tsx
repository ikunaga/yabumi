import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DescriptionDrafter } from "@/components/github/description-drafter";
import { RepoPicker, type PickableRepo } from "@/components/github/repo-picker";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { aiConfigured } from "@/lib/ai/anthropic";
import { disconnectRepo } from "@/lib/github/actions";
import { githubConfig, githubConfigured } from "@/lib/github/config";
import { reposForInstallation } from "@/lib/github/service";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "GitHub をつなぐ" };

const ERRORS: Record<string, string> = {
  not_configured: "GitHub との連携は準備中です。",
  state: "接続の確認に失敗しました。もう一度「GitHub をつなぐ」から始めてください。",
  denied: "GitHub の画面でキャンセルされたため、つなぎませんでした。",
  pending_approval: "オーガニゼーションの管理者の承認待ちです。承認されたら「連携を読み込み直す」を押してください。",
  no_installation: "矢書の GitHub App がインストールされていませんでした。「GitHub をつなぐ」からインストールしてください。",
  failed: "GitHub とつなげませんでした。時間をおいてもう一度お試しください。",
};

// GitHub のリポジトリをつなぎ、AI がアプリの紹介文（どんなアプリか）を下書きする（要求 F16、決定 D14）
export default async function GithubPage(props: PageProps<"/projects/[id]/github">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const installHref = `/github/install?project=${id}`;

  const intro = (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">GitHub をつなぐ（任意）</h1>
      <p className="text-base leading-[1.8] text-muted max-sm:text-[14px]">
        アプリのリポジトリをつなぐと、AI がファイルを読んで、アプリの紹介文（どんなアプリか）を下書きします。紹介文は、アカウント設計の相談や投稿のネタを考えるときの材料になります。非公開のリポジトリも読めます。つながなくても、手で書けば先へ進めます。
      </p>
    </div>
  );

  if (!githubConfigured()) {
    return (
      <div className="flex max-w-[760px] flex-col gap-5">
        {intro}
        <p className="flex items-center gap-3">
          <Button disabled>GitHub をつなぐ</Button>
          <span className="text-xs text-muted">準備中</span>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: installations }, { data: link }] = await Promise.all([
    supabase.from("github_installations").select("installation_id, account_login, account_type").order("account_login"),
    supabase.from("project_github_repos").select("full_name, is_private, last_read_at").eq("project_id", id).maybeSingle(),
  ]);

  // まだリポジトリを選んでいなければ、インストールで読めるリポジトリを並べる
  let repos: PickableRepo[] = [];
  let repoError = false;
  if (!link && installations?.length) {
    const cfg = githubConfig();
    const lists = await Promise.allSettled(installations.map((i) => reposForInstallation(cfg, i.installation_id)));
    lists.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        repos.push(...r.value.map((repo) => ({ installationId: installations[idx].installation_id, id: repo.id, fullName: repo.full_name, isPrivate: repo.private, description: repo.description })));
      } else {
        repoError = true;
      }
    });
    repos = repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;

  return (
    <div className="flex max-w-[760px] flex-col gap-6 max-sm:gap-4">
      {intro}
      {sp.connected === "1" && <SuccessBanner>GitHub とつなぎました。</SuccessBanner>}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Card>
        <CardHeader title="矢書が読むもの・読まないもの" />
        <div className="grid grid-cols-2 gap-5 px-5 py-4 text-sm leading-[1.8] max-sm:grid-cols-1 max-sm:px-4">
          <div>
            <p className="font-bold">読むもの</p>
            <ul>
              <li>・あなたがインストールのときに選んだリポジトリだけ</li>
              <li>・ファイルの一覧を見て、AI が選んだファイル（README、資料、設定ファイル、画面の文言のファイルなど。15 件まで）</li>
              <li>・読むだけで、書き込みはしません（権限は「中身の読み取り」のみ）</li>
            </ul>
          </div>
          <div>
            <p className="font-bold">読まないもの・残さないもの</p>
            <ul>
              <li>・.env、鍵、証明書など、秘密が入りがちなファイル</li>
              <li>・読んだ中身は AI に渡すだけで、矢書には残しません。残すのは、あなたが採用した紹介文だけ</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="1. GitHub とつなぐ" />
        <div className="flex flex-col gap-3 px-5 py-4 text-[14px] max-sm:px-4">
          {installations?.length ? (
            <>
              <p>
                <span className="font-bold text-success">✓ </span>
                つないでいる GitHub: {installations.map((i) => i.account_login).join("、")}
              </p>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a href={installHref} className="font-semibold text-primary hover:underline">
                  読ませるリポジトリを追加・変更する
                </a>
                <a href={`${installHref}&mode=sync`} className="font-semibold text-primary hover:underline">
                  連携を読み込み直す
                </a>
              </p>
            </>
          ) : (
            <>
              <p className="leading-[1.8] text-muted">
                GitHub の画面で矢書の App をインストールし、読ませるリポジトリを選びます（「Only select repositories」で、このアプリのリポジトリだけを選ぶのがおすすめです）。
              </p>
              <div>
                <a href={installHref} className={buttonClass()}>
                  GitHub をつなぐ
                </a>
              </div>
            </>
          )}
        </div>
      </Card>

      {installations?.length ? (
        <Card>
          <CardHeader title="2. リポジトリを選んで、紹介文を下書きする" />
          <div className="flex flex-col gap-4 px-5 py-4 max-sm:px-4">
            {link ? (
              <>
                <div className="flex flex-wrap items-center gap-3 text-[14px]">
                  <span className="font-bold break-all">{link.full_name}</span>
                  {link.is_private && <span className="text-xs text-muted">非公開</span>}
                  <form action={disconnectRepo.bind(null, id)} className="ml-auto">
                    <button type="submit" className="text-sm text-muted hover:text-fg hover:underline">
                      外す
                    </button>
                  </form>
                </div>
                <DescriptionDrafter projectId={id} aiEnabled={aiConfigured()} hasAudience={Boolean(project.target_audience.trim())} />
              </>
            ) : repos.length ? (
              <RepoPicker projectId={id} repos={repos} />
            ) : (
              <p className="text-sm leading-[1.8] text-muted">
                {repoError ? "リポジトリの一覧を読めませんでした。「連携を読み込み直す」を試してください。" : "読ませているリポジトリがありません。「読ませるリポジトリを追加・変更する」から選んでください。"}
              </p>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
