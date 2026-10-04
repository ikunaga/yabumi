import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountPlanEditor } from "@/components/plan/account-plan-editor";
import { Button, ButtonLink } from "@/components/ui/button";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getAccountPlan } from "@/lib/plan/queries";

export const metadata: Metadata = { title: "アカウント設計" };

// アカウント設計（要求 F15）。セクションごとに保存でき、どれも任意
export default async function PlanPage(props: PageProps<"/projects/[id]/plan">) {
  const { id } = await props.params;
  const plan = await getAccountPlan(id);
  if (!plan) notFound();

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
            <>
              <Button variant="inverse" className="px-6 max-sm:h-12" disabled>
                AI と考える
              </Button>
              <span className="text-xs text-on-primary-muted">準備中</span>
            </>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">中身を確かめて、手で直す</h2>
        <p className="text-sm text-muted">AI と決めた内容もここに入ります。記入例を見ながら自分で書くこともできます。</p>
      </div>
      <AccountPlanEditor projectId={id} plan={plan.plan} sources={plan.sources} aiEnabled={aiEnabled} />
    </div>
  );
}
