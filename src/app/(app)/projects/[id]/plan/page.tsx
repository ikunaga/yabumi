import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountPlanEditor } from "@/components/plan/account-plan-editor";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { aiConfigured } from "@/lib/ai/anthropic";
import { listLinks } from "@/lib/links/queries";
import { getAccountPlan } from "@/lib/plan/queries";
import { isSectionKey } from "@/lib/plan/schema";
import { getProject } from "@/lib/projects/queries";
import type { SnsKey } from "@/lib/sns";
import { listProjectSnsAccounts } from "@/lib/sns/queries";

export const metadata: Metadata = { title: "アカウント設計" };

// アカウント設計（要求 F15）。セクションごとに保存でき、どれも任意
export default async function PlanPage(props: PageProps<"/projects/[id]/plan">) {
  const { id } = await props.params;
  // ?open=profile のように、開いておくセクションを指定できる（作成画面の短縮リンクの案内から「名前とプロフィール」へ）
  const { open } = await props.searchParams;
  const [plan, project] = await Promise.all([getAccountPlan(id), getProject(id)]);
  if (!plan || !project) notFound();
  const [accounts, links] = await Promise.all([listProjectSnsAccounts(id), listLinks(id)]);
  const profileLinks: Partial<Record<SnsKey, string>> = {};
  for (const l of links) if (l.kind === "profile" && !l.disabled && l.sns && !profileLinks[l.sns]) profileLinks[l.sns] = l.url;

  const aiEnabled = aiConfigured();

  return (
    <div className="flex max-w-[820px] flex-col gap-6 max-sm:gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">アカウント設計</h1>
        <p className="text-base leading-[1.8] text-muted max-sm:text-[14px]">
          投稿を始める前に、誰に・何のために・どんな名前で・どんな投稿をするかを決めます。マーケティングを知らなくても大丈夫です。あとからいつでも直せます。
        </p>
      </div>

      {/* 主な入口は AI との会話。空欄を自分で埋めるのは、中身を確かめて直すとき */}
      <section className="flex items-center gap-6 rounded-lg bg-primary px-7 py-6 text-on-primary max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:p-5">
        <div className="flex flex-1 flex-col gap-1.5">
          <h2 className="text-xl font-bold max-sm:text-[19px]">AI と話しながら決める（おすすめ）</h2>
          <p className="text-[14px] leading-[1.7] text-on-primary-muted">
            AI が 1 つずつ質問し、答えにあわせて案を出します。案には長所・短所とおすすめの理由が付くので、選ぶだけで進められます。
          </p>
        </div>
        <div className="flex flex-col items-center gap-1 max-sm:items-stretch">
          {aiEnabled ? (
            <ButtonLink href={`/projects/${id}/plan/chat`} variant="inverse" className="px-6 max-sm:h-12">
              AI と考える
            </ButtonLink>
          ) : (
            <NotReadyButton variant="inverse" className="px-6 max-sm:h-12" stack>
              AI と考える
            </NotReadyButton>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">中身を確かめて、手で直す</h2>
        <p className="text-sm text-muted">AI と決めた内容もここに入ります。記入例を見ながら自分で書くこともできます。</p>
      </div>
      <AccountPlanEditor
        projectId={id}
        plan={plan.plan}
        sources={plan.sources}
        aiEnabled={aiEnabled}
        initialOpen={isSectionKey(open) ? open : null}
        profileCtx={{
          projectId: id,
          accounts: accounts.map((a) => ({ sns: a.sns, handle: a.handle })),
          profileLinks,
          destination: project.app_store_url ?? project.play_store_url ?? null,
        }}
      />
    </div>
  );
}
