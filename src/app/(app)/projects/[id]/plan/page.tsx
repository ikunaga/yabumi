import { createClient } from "@/lib/supabase/server";
import { destinationCandidates, listDestinations } from "@/lib/projects/destinations";
import { isProductType } from "@/lib/projects/product-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountPlanEditor, PlanProgressCard } from "@/components/plan/account-plan-editor";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Columns } from "@/components/ui/columns";
import { PageHeader } from "@/components/ui/page-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { listLinks } from "@/lib/links/queries";
import { getAccountPlan } from "@/lib/plan/queries";
import { isSectionKey } from "@/lib/plan/schema";
import { cycleFromMilestones } from "@/lib/coach/pace";
import { loadGoals } from "@/lib/goals/load";
import { withGoalWeekly } from "@/lib/goals/view";
import { countSelfWrittenPosts, loadVoiceExampleHeads } from "@/lib/plan/voice";
import { getProject } from "@/lib/projects/queries";
import type { SnsKey } from "@/lib/sns";
import { listProjectSnsAccounts } from "@/lib/sns/queries";

export const metadata: Metadata = { title: "アカウント設計" };

// アカウント設計（要求 F15）。セクションごとに保存でき、どれも任意
export default async function PlanPage(props: PageProps<"/projects/[id]/plan">) {
  const { id } = await props.params;
  // ?open=profile のように、開いておくセクションを指定できる（作成画面の短縮リンクの案内から「名前とプロフィール」へ）
  const { open } = await props.searchParams;
  // id だけで読めるので、まとめて並べて読む（待ち時間を縮める）
  const supabase = await createClient();
  const [stored, project, accounts, links, registered, goals, selfWritten] = await Promise.all([
    getAccountPlan(id),
    getProject(id),
    listProjectSnsAccounts(id),
    listLinks(id),
    listDestinations(supabase, id),
    loadGoals(supabase, id),
    countSelfWrittenPosts(supabase, id),
  ]);
  if (!stored || !project) notFound();
  const voiceExampleHeads = await loadVoiceExampleHeads(supabase, id, stored.plan.voice.examples);
  // 週の回数と 1 か月の区切りは、いまの目標（goals）が正（JSON の first_month には持たない）
  const cycle = cycleFromMilestones(goals.active?.milestones ?? [], goals.today);
  const plan = { ...stored, plan: { ...stored.plan, first_month: withGoalWeekly(stored.plan.first_month, goals.active?.actions ?? []) } };
  const profileLinks: Partial<Record<SnsKey, string>> = {};
  for (const l of links) if (l.kind === "profile" && !l.disabled && l.sns && !profileLinks[l.sns]) profileLinks[l.sns] = l.url;

  const aiEnabled = aiConfigured();

  const editor = (
    <AccountPlanEditor
      projectId={id}
      plan={plan.plan}
      sources={plan.sources}
      aiEnabled={aiEnabled}
      initialOpen={isSectionKey(open) ? open : null}
      cycle={cycle}
      selfWritten={selfWritten}
      voiceExampleHeads={voiceExampleHeads}
      profileCtx={{
        projectId: id,
        accounts: accounts.map((a) => ({ sns: a.sns, handle: a.handle })),
        profileLinks,
        destination: destinationCandidates(project, registered)[0]?.url ?? null,
        productType: isProductType(project.product_type) ? project.product_type : "app",
      }}
    />
  );

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      {/* 主な入口は AI との会話。空欄を自分で埋めるのは、中身を確かめて直すとき */}
      <PageHeader
        title="アカウント設計"
        help="「AI と考える」では、AI が 1 つずつ質問し、長所・短所とおすすめの理由をつけた案を出します。選んだ案は下の欄に入り、あとからいつでも手で直せます。"
        actions={
          aiEnabled ? (
            <ButtonLink href={`/projects/${id}/plan/chat`} className="max-sm:w-full">
              AI と考える
            </ButtonLink>
          ) : (
            <NotReadyButton>AI と考える</NotReadyButton>
          )
        }
      />
      <Columns main={editor} side={<PlanProgressCard plan={plan.plan} />} sideFirst />
    </div>
  );
}
