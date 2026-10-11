import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FacebookPagePicker } from "@/components/projects/facebook-page-picker";
import { Card } from "@/components/ui/card";
import { getProject } from "@/lib/projects/queries";
import type { PageSummary } from "@/lib/sns/facebook/pages";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "つなぐページを選ぶ" };

// Facebook から戻ったあと、つなぐページを選ぶ（投稿を作れるページが 2 つ以上のとき）。一覧は 15 分だけ使える
export default async function SelectFacebookPagesPage(props: PageProps<"/projects/[id]/connect/facebook/select">) {
  const [{ id }, { choice }] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const supabase = await createClient();
  // RLS で本人の・期限内のものだけ。トークンの列は読めない（4.17 の列ごとの権限）
  const { data } =
    typeof choice === "string" && isUuid(choice)
      ? await supabase.from("pending_page_choices").select("id, project_id, pages").eq("id", choice).eq("project_id", id).maybeSingle()
      : { data: null };

  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">つなぐページを選ぶ</h1>
      <Card className="flex flex-col gap-4 p-5 text-[14px] leading-7">
        {data ? (
          <FacebookPagePicker projectId={id} choiceId={data.id} pages={data.pages as PageSummary[]} />
        ) : (
          <>
            <p>選ぶ時間（15 分）が過ぎたか、すでにつなぎました。</p>
            <Link href={`/projects/${id}/connect/facebook`} className="font-semibold text-primary hover:underline">
              もう一度「つなぐ」から始める
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}
