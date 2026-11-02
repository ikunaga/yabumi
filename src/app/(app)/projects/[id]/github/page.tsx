import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DescriptionDrafter } from "@/components/github/description-drafter";
import { RepoPicker, type PickableRepo } from "@/components/github/repo-picker";
import { ButtonLink, buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { disconnectRepo } from "@/lib/github/actions";
import { githubConfig, githubConfigured } from "@/lib/github/config";
import { accessIsStale, canReadRepo } from "@/lib/github/installations";
import { reposForInstallation } from "@/lib/github/service";
import { projectSettingsHref } from "@/lib/projects/paths";
import { PRODUCT_TYPE_DEFS, isDevProject, isProductType } from "@/lib/projects/product-types";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = { title: "GitHub をつなぐ" };

const ERRORS: Record<string, string> = {
  not_configured: "GitHub をつなぐ機能は準備中です。",
  state: "つなぐときの確認に失敗しました。もう一度「GitHub をつなぐ」から始めてください。",
  denied: "GitHub の画面でキャンセルされたため、つなぎませんでした。",
  pending_approval: "組織（Organization）の管理者の承認待ちです。承認されたら「GitHub をつなぎ直す」を押してください。",
  no_installation: "yabumi の GitHub App がインストールされていませんでした。「GitHub をつなぐ」からインストールしてください。",
  failed: "GitHub とつなげませんでした。時間をおいてもう一度お試しください。",
};

// GitHub のリポジトリをつなぎ、AI がアプリ・Web のサービスの紹介文を下書きする（要求 F16、決定 D14）
export default async function GithubPage(props: PageProps<"/projects/[id]/github">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const installHref = `/github/install?project=${id}`;

  const intro = (
    <PageHeader
      title="GitHub をつなぐ"
      sub="任意"
      help="作っているアプリや Web のサービスのリポジトリをつなぐと、AI がファイルを読んで紹介文を下書きし、最近の開発（コミット）から投稿のネタを出せます。紹介文は、アカウント設計の相談や投稿のネタを考えるときの材料になります。非公開のリポジトリも読めます。つながなくても、手で書けば先へ進めます。"
    />
  );

  // GitHub は開発しているもの（アプリ・Web のサービス）のときだけ（isDevProject）
  if (!isDevProject(project)) {
    return (
      <div className="flex flex-col gap-5">
        {intro}
        <Card>
          <EmptyState
            title={`「${PRODUCT_TYPE_DEFS[isProductType(project.product_type) ? project.product_type : "app"].label}」では使いません`}
            description="GitHub をつなぐのは、宣伝するものがアプリか Web のサービスのときです。種類が違っていたら、プロジェクトの設定で直せます。"
            action={
              <ButtonLink href={projectSettingsHref(id)} variant="secondary">
                プロジェクトの設定へ
              </ButtonLink>
            }
          />
        </Card>
      </div>
    );
  }

  if (!githubConfigured()) {
    return (
      <div className="flex flex-col gap-5">
        {intro}
        <p>
          <NotReadyButton>GitHub をつなぐ</NotReadyButton>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: installations }, { data: link }] = await Promise.all([
    supabase.from("github_installations").select("installation_id, account_login, account_type, repo_ids, updated_at").order("account_login"),
    supabase.from("project_github_repos").select("full_name, is_private, last_read_at").eq("project_id", id).maybeSingle(),
  ]);

  // まだリポジトリを選んでいなければ、インストールで読めるリポジトリのうち、本人が読めるものを並べる
  let repos: PickableRepo[] = [];
  let repoError = false;
  if (!link && installations?.length) {
    const cfg = githubConfig();
    const lists = await Promise.allSettled(installations.map((i) => reposForInstallation(cfg, i.installation_id)));
    lists.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        repos.push(...r.value.filter((repo) => canReadRepo(installations[idx], repo.id)).map((repo) => ({ installationId: installations[idx].installation_id, id: repo.id, fullName: repo.full_name, isPrivate: repo.private, description: repo.description })));
      } else {
        repoError = true;
      }
    });
    repos = repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  // 組織や共同作業者のインストールは、7 日ごとに本人の権限を確かめ直す
  const stale = installations?.filter((i) => accessIsStale(i)) ?? [];

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      {intro}
      {sp.connected === "1" && <SuccessBanner>GitHub とつなぎました。</SuccessBanner>}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Columns
        main={
          <>
            <Card>
              <CardHeader title="1. GitHub とつなぐ" />
              <div className="flex flex-col gap-3 px-6 pt-1 pb-5 text-[14px] max-sm:px-4">
                {installations?.length ? (
                  <>
                    <p>
                      <span className="font-bold text-success">✓ </span>
                      つないでいる GitHub: {installations.map((i) => i.account_login).join("、")}
                    </p>
                    {stale.length > 0 && (
                      <p className="leading-[1.8] text-muted">
                        {stale.map((i) => i.account_login).join("、")} のリポジトリは、あなたが今も読めるかを確かめ直す必要があります（組織や共同作業のリポジトリは 7 日ごとに確かめます）。「GitHub をつなぎ直す」を押してください。
                      </p>
                    )}
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <a href={installHref} className="font-semibold text-primary hover:underline">
                        読ませるリポジトリを追加・変更する
                      </a>
                      <a href={`${installHref}&mode=sync`} className="font-semibold text-primary hover:underline">
                        GitHub をつなぎ直す
                      </a>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="leading-[1.8] text-muted">
                      GitHub の画面で yabumi の App をインストールし、読ませるリポジトリを選びます（「Only select repositories」で、このプロジェクトのリポジトリだけを選ぶのがおすすめです）。
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
                <div className="flex flex-col gap-4 px-6 pt-1 pb-5 max-sm:px-4">
                  {link ? (
                    <>
                      <div className="flex flex-wrap items-center gap-3 text-[14px]">
                        <span className="font-bold break-all">{link.full_name}</span>
                        {link.is_private && <span className="text-xs text-muted">非公開</span>}
                        <form action={disconnectRepo.bind(null, id)} className="ml-auto">
                          <SubmitButton pendingText="外しています…" className="text-sm text-muted hover:text-fg hover:underline">
                            外す
                          </SubmitButton>
                        </form>
                      </div>
                      <DescriptionDrafter projectId={id} aiEnabled={aiConfigured()} hasAudience={Boolean(project.target_audience.trim())} />
                    </>
                  ) : repos.length ? (
                    <RepoPicker projectId={id} repos={repos} />
                  ) : (
                    <p className="text-sm leading-[1.8] text-muted">
                      {repoError ? "リポジトリの一覧を読めませんでした。「GitHub をつなぎ直す」を試してください。" : "読ませているリポジトリがありません。「読ませるリポジトリを追加・変更する」から選んでください。"}
                    </p>
                  )}
                </div>
              </Card>
            ) : null}
          </>
        }
        side={
          <Card>
            <CardHeader title="yabumi が読むもの・読まないもの" />
            <div className="flex flex-col gap-4 px-6 pt-1 pb-5 text-sm leading-[1.8] max-sm:px-4">
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
                  <li>・読んだ中身は AI に渡すだけで、yabumi には残しません。残すのは、あなたが採用した紹介文だけ</li>
                </ul>
              </div>
            </div>
          </Card>
        }
      />
    </div>
  );
}
