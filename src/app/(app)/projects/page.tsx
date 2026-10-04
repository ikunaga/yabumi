import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { SnsResultBanner } from "@/components/projects/sns-result-banner";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/user";
import { STEPS, currentStepIndex } from "@/lib/projects/next-step";
import { listProjects } from "@/lib/projects/queries";
import { SNS } from "@/lib/sns";
import { activeSnsByProject } from "@/lib/sns/queries";
import { planProgressByProject } from "@/lib/plan/queries";

export const metadata: Metadata = { title: "プロジェクト" };

function storeLabel(p: { app_store_url: string | null; play_store_url: string | null }) {
  const stores = [p.app_store_url && "App Store", p.play_store_url && "Google Play"].filter(Boolean);
  return stores.length ? stores.join(" / ") : null;
}

export default async function ProjectsPage(props: PageProps<"/projects">) {
  const { sns_error } = await props.searchParams;
  const [user, projects, snsByProject] = await Promise.all([requireUser(), listProjects(), activeSnsByProject()]);
  const planByProject = await planProgressByProject(projects);

  return (
    <>
      <TopBar email={user.email} />
      <main className="flex flex-col gap-7 px-12 py-12 max-lg:px-6 max-sm:gap-5 max-sm:px-5 max-sm:py-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">プロジェクト</h1>
            <p className="text-base text-muted max-sm:hidden">広めたいアプリごとに 1 つ作ります。</p>
          </div>
          {projects.length > 0 && <ButtonLink href="/projects/new">＋ 新しいプロジェクト</ButtonLink>}
        </div>

        <SnsResultBanner error={sns_error} />

        {projects.length === 0 ? (
          <Card className="max-w-xl overflow-hidden">
            <EmptyState
              title="まだプロジェクトがありません"
              description="広めたいアプリごとに 1 つ作ります。アプリ名だけで始められます。"
              action={
                <ButtonLink href="/projects/new" className="max-sm:h-13 max-sm:w-full">
                  プロジェクトを作る
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <Card>
            <div
              role="row"
              className="grid grid-cols-[1.1fr_2fr_1fr_1fr_1fr] gap-4 border-b border-border px-6 py-3 text-xs text-muted max-md:hidden"
            >
              <span>アプリ</span>
              <span>どんなアプリか</span>
              <span>ストアページ</span>
              <span>つないだ SNS</span>
              <span>次にやること</span>
            </div>
            <ul>
              {projects.map((p) => {
                const sns = snsByProject[p.id] ?? [];
                const step = STEPS[currentStepIndex({ planDone: planByProject[p.id] ?? false, connectedSnsCount: sns.length })];
                const store = storeLabel(p);
                return (
                  <li
                    key={p.id}
                    className="grid grid-cols-[1.1fr_2fr_1fr_1fr_1fr] items-center gap-4 border-b border-line px-6 py-5 text-[14px] last:border-b-0 max-md:grid-cols-1 max-md:gap-1.5 max-md:px-4 max-md:py-4"
                  >
                    <Link href={`/projects/${p.id}`} className="text-[16px] font-bold hover:underline">
                      {p.name}
                    </Link>
                    <span className="line-clamp-2 text-muted">{p.description || "説明はまだありません"}</span>
                    <span className={store ? "" : "text-muted"}>
                      <span className="text-xs text-muted md:hidden">ストアページ: </span>
                      {store ?? "未登録"}
                    </span>
                    <span className={sns.length ? "" : "text-muted"}>
                      <span className="text-xs text-muted md:hidden">つないだ SNS: </span>
                      {sns.length ? sns.map((k) => SNS[k].label).join("・") : "なし"}
                    </span>
                    <Link href={`/projects/${p.id}`} className="font-bold text-primary hover:underline">
                      {step.shortTitle} →
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </main>
    </>
  );
}
