import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/anthropic";
import { PostComposer } from "@/components/posts/post-composer";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { canPublish } from "@/lib/sns/adapters";
import { getPlanHints } from "@/lib/plan/queries";
import { snsNeedingImageReconnect } from "@/lib/media/queries";
import { createClient } from "@/lib/supabase/server";
import { isSnsKey } from "@/lib/sns";
import { isYmd } from "@/lib/time";

export const metadata: Metadata = { title: "投稿をつくる" };

// 新しい投稿。カレンダーで日付を押して来たときは ?date=YYYY-MM-DD がつく。
// ロードマップのやることから来たときは ?item=<id>: SNS（決めていれば）・予定日（あれば）・やることの題と説明（手がかり）を入れて開き、保存した投稿をやることに結びつける（4.23）
export default async function ComposePage(props: PageProps<"/projects/[id]/compose">) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const [accounts, planHints] = await Promise.all([connectedAccounts(project.id), getPlanHints(project.id)]);
  const item = typeof searchParams.item === "string" && /^[0-9a-f-]{36}$/.test(searchParams.item) ? await loadItem(project.id, searchParams.item) : null;
  const date = isYmd(searchParams.date) ? searchParams.date : (item?.planned_on ?? null);
  const needImageReconnect = await snsNeedingImageReconnect(accounts);
  // 送り先の最初の印は、つないで送れる SNS だけに付ける（つないでいなければ印なし。作成画面で「先に SNS をつなぐ」を出す）
  const connected = (Object.keys(accounts) as SnsKey[]).filter(canPublish);

  return (
    <PostComposer
      projectId={project.id}
      projectName={project.name}
      postId={null}
      connected={connected}
      planHints={planHints}
      needImageReconnect={needImageReconnect}
      aiCheckEnabled={aiConfigured()}
      initial={{
        body: "",
        targets: (item?.sns && isSnsKey(item.sns) ? [item.sns] : SNS_KEYS.filter((s) => connected.includes(s))).map((sns) => ({ sns, bodyOverride: null })),
        plannedAt: date ? `${date}T12:00` : "",
        roadmapItem: item ? { id: item.id, title: item.title, detail: item.detail } : null,
      }}
    />
  );
}

// やること（RLS で本人のものだけ。同じプロジェクトのものだけ）
async function loadItem(projectId: string, itemId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("roadmap_items").select("id, title, detail, sns, planned_on").eq("id", itemId).eq("project_id", projectId).maybeSingle();
  return data;
}
