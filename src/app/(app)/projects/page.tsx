import { isAppProject, isProductType, PRODUCT_TYPE_DEFS } from "@/lib/projects/product-types";
import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { SnsResultBanner } from "@/components/projects/sns-result-banner";
import { Button, ButtonLink } from "@/components/ui/button";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { Card, EmptyState } from "@/components/ui/card";
import { SuccessBanner } from "@/components/ui/feedback";
import { requireUser } from "@/lib/auth/user";
import { listNextStep } from "@/lib/projects/next-step";
import { PROJECT_LIMIT_TEXT, projectLimitReached } from "@/lib/projects/limits";
import { listProjects } from "@/lib/projects/queries";
import { loadStepStates } from "@/lib/projects/step-state";

export const metadata: Metadata = { title: "プロジェクト" };

// 一覧の添え書き: アプリならストアの名前、ほかは宣伝するものの種類（決定 D34）
function storeLabel(p: { product_type?: string | null; app_store_url: string | null; play_store_url: string | null }) {
  if (!isAppProject(p)) return isProductType(p.product_type) ? PRODUCT_TYPE_DEFS[p.product_type].label : null;
  const stores = [p.app_store_url && "App Store", p.play_store_url && "Google Play"].filter(Boolean);
  return stores.length ? stores.join(" / ") : null;
}

export default async function ProjectsPage(props: PageProps<"/projects">) {
  const { sns_error, done } = await props.searchParams;
  const [user, projects] = await Promise.all([requireUser(), listProjects()]);
  // 次にやることの判定は概要と同じ値で（まとめて取る。src/lib/projects/step-state.ts）
  const states = await loadStepStates(projects);

  return (
    <>
      <TopBar email={user.email} />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader
          title="プロジェクト"
          sub={projects.length > 0 ? `${projects.length} 件` : undefined}
          actions={
            projects.length > 0 &&
            (projectLimitReached(projects.length) ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm text-muted">{PROJECT_LIMIT_TEXT}</span>
                <Button disabled>＋ 新しいプロジェクト</Button>
              </span>
            ) : (
              <ButtonLink href="/projects/new">＋ 新しいプロジェクト</ButtonLink>
            ))
          }
        />

        <SnsResultBanner error={sns_error} />
        {done === "password_updated" && <SuccessBanner>パスワードを変えました。</SuccessBanner>}

        {projects.length === 0 ? (
          <Card className="overflow-hidden">
            <EmptyState
              title="まだプロジェクトがありません"
              description="宣伝したいもの（お店・商品・サービス・作品・アプリなど）ごとに 1 つ作ります。名前だけで始められます。"
              action={
                <ButtonLink href="/projects/new" className="max-sm:h-13 max-sm:w-full">
                  プロジェクトを作る
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <ul className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
            {projects.map((p) => {
              const state = states[p.id];
              const sns = state?.connectedSns ?? [];
              const next = listNextStep(state ?? { planDone: false, connectedSnsCount: 0, hasPublished: false, hasRoadmap: false, thisWeek: { open: 0, finished: 0 } });
              const store = storeLabel(p);
              return (
                <li key={p.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
                  <Link href={`/projects/${p.id}`} className="flex flex-1 flex-col gap-2 px-6 pt-5 pb-4 hover:no-underline max-sm:px-4">
                    <span className="truncate text-[20px] font-bold hover:underline">{p.name}</span>
                    <span className="line-clamp-2 text-[14px] leading-[1.7] text-muted">{p.description || "説明はまだありません"}</span>
                    <dl className="mt-auto grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2 pt-2 text-[14px]">
                      <dt className="text-faint">つないだ SNS</dt>
                      <dd className="flex flex-wrap gap-1">{sns.length ? sns.map((k) => <SnsMark key={k} sns={k} />) : <span className="text-faint">なし</span>}</dd>
                      {isAppProject(p) ? (
                        <>
                          <dt className="text-faint">ストアページ</dt>
                          <dd className={store ? "" : "text-faint"}>{store ?? "未登録"}</dd>
                        </>
                      ) : (
                        <>
                          <dt className="text-faint">種類</dt>
                          <dd>{PRODUCT_TYPE_DEFS[isProductType(p.product_type) ? p.product_type : "app"].label}</dd>
                        </>
                      )}
                    </dl>
                  </Link>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-2 border-t border-line px-6 py-3 text-[15px] hover:bg-surface2 hover:no-underline max-sm:px-4"
                  >
                    <span className="shrink-0 rounded-full bg-subtle px-2.5 py-0.5 text-xs font-bold text-muted">次にやること</span>
                    <b className="line-clamp-2 min-w-0 break-words [word-break:auto-phrase]">{next.label}</b>
                    <span aria-hidden className="ml-auto text-faint">
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
