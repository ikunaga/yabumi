import Link from "next/link";
import { SuccessBanner } from "@/components/ui/feedback";
import { CONSULT_CLOSED_DONE, consultClosedText, type GoalNotice, type ReviewedNotice } from "@/lib/ai/consult-closed";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// 相談を終えて戻ってきたときの知らせ（分析・概要・ロードマップ・相談の一覧）
// roadmapLink: 振り返りのやることを済みにできなかったときの、ロードマップへのリンク（ロードマップの画面では出さない）
export async function ConsultClosedBanner({
  projectId,
  done,
  items,
  reviewed,
  goal = null,
  roadmapLink = true,
}: {
  projectId: string;
  done: unknown;
  items: unknown;
  reviewed: unknown;
  // 目標の振り返りを終えたとき（started|kept。概要）
  goal?: unknown;
  roadmapLink?: boolean;
}) {
  if (done !== CONSULT_CLOSED_DONE) return null;
  const [notice, goalNote] = await Promise.all([reviewedNotice(projectId, reviewed), goalNotice(projectId, goal)]);
  const text = consultClosedText(done, items, notice, goalNote);
  if (!text) return null;
  return (
    <SuccessBanner>
      {text}
      {notice === "many" && roadmapLink && (
        <>
          {" "}
          <Link href={`/projects/${projectId}/roadmap`} className="underline">
            ロードマップを開く
          </Link>
        </>
      )}
    </SuccessBanner>
  );
}

// 始めた目標の名前を DB から読む（RLS で本人のものだけ。いまの目標の文）
async function goalNotice(projectId: string, goal: unknown): Promise<GoalNotice> {
  if (goal === "kept") return "kept";
  if (goal !== "started") return null;
  const supabase = await createClient();
  const { data } = await supabase.from("goals").select("statement").eq("project_id", projectId).eq("status", "active").maybeSingle();
  return data?.statement ? { started: data.statement } : null;
}

// 済みにしたやることの名前を DB から読む（RLS で本人のものだけ。済みでなければ出さない）
async function reviewedNotice(projectId: string, reviewed: unknown): Promise<ReviewedNotice> {
  if (reviewed === "many") return "many";
  if (typeof reviewed !== "string" || !isUuid(reviewed)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("roadmap_items").select("title").eq("id", reviewed).eq("project_id", projectId).eq("status", "done").maybeSingle();
  return data ? { title: data.title } : null;
}
