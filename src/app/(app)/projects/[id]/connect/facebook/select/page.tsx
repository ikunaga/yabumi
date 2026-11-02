import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FacebookPagePicker } from "@/components/projects/facebook-page-picker";
import { Card } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <SnsMark sns="facebook" />
            つなぐページを選ぶ
          </span>
        }
        help="選べる時間は 15 分です。過ぎたら、もう一度つなぎ直してください。"
      />
      <Columns
        main={
          <Card className="flex flex-col gap-4 px-6 py-5 text-[15px] leading-7 max-sm:px-4">
            {data ? (
              <FacebookPagePicker projectId={id} choiceId={data.id} pages={data.pages as PageSummary[]} />
            ) : (
              <>
                <p>選ぶ時間（15 分）が過ぎたか、すでにつなぎました。</p>
                <Link href={`/projects/${id}/connect/facebook`} className="font-semibold underline">
                  もう一度「つなぐ」から始める
                </Link>
              </>
            )}
          </Card>
        }
        side={null}
      />
    </div>
  );
}
