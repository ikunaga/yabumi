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
  const [accounts, links, registered] = await Promise.all([listProjectSnsAccounts(id), listLinks(id), listDestinations(await createClient(), id)]);
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
        help="投稿を始める前に、誰に・何のために・どんな名前で・どんな投稿をするかを決めます。AI が 1 つずつ質問し、長所・短所とおすすめの理由をつけた案を出すので、選ぶだけで進められます。AI と決めた内容は下の欄に入り、あとからいつでも手で直せます。"
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
