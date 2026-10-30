import Link from "next/link";
import { consultTopicMeta } from "@/lib/ai/consult-topics";
import { ROADMAP_STEPS, type RoadmapStepState } from "@/lib/ai/consult-schema";
import { PageHeader } from "@/components/ui/page-header";
import { ThreadMenu } from "./thread-menu";

// AI と相談の会話の画面の見出し。入口（ロードマップ・分析など）から始めた相談は、その入口の見出しと戻り先にする
export function ConsultHeader({
  projectId,
  topic,
  threadId,
  roadmapSteps,
  firstText = null,
}: {
  projectId: string;
  // 入口を使わずに書いて始めた相談の、最初の発言（見出しにする）
  firstText?: string | null;
  topic: string | null;
  threadId: string | null;
  // ロードマップづくりの会話: どこまで決まったか（今のロードマップから）
  roadmapSteps: RoadmapStepState | null;
}) {
  const meta = consultTopicMeta(topic);
  const entry = meta?.entry ?? null;
  const base = `/projects/${projectId}`;
  const back = entry ? { href: entry.back.path ? `${base}/${entry.back.path}` : base, label: entry.back.label } : { href: `${base}/consult`, label: "相談の一覧へ" };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Link href={back.href} className="text-[15px] text-muted hover:text-fg hover:no-underline">
          ← {back.label}
        </Link>
        {entry && (
          <Link href={`${base}/consult`} className="text-[14px] text-muted hover:text-fg hover:no-underline">
            相談の一覧
          </Link>
        )}
      </div>
      <PageHeader
        title={entry?.title ?? meta?.listTitle ?? (firstText ? (firstText.length > 40 ? `${firstText.slice(0, 40)}…` : firstText) : threadId ? "相談" : "新しい相談")}
        help={entry?.lead ?? "AI はアカウント設計・最近の投稿・数字・ロードマップを見たうえで、案を 2〜3 個出します。選んだ案だけが、設計やロードマップに入ります。"}
        actions={
          threadId && (
            <ThreadMenu
              projectId={projectId}
              threadId={threadId}
              backPath={`${base}/consult`}
              keeps="採用した案（設計・ロードマップ・下書き）は残ります。会話は、最後のやり取りから 1 年たつと自動で消えます。"
            />
          )
        }
      />
      {roadmapSteps && (
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="ロードマップづくりの段取り">
          {ROADMAP_STEPS.map((s, i) => {
            const done = roadmapSteps.done[s.key];
            const current = roadmapSteps.next === s.key;
            return (
              <li key={s.key} className={done ? "text-success" : current ? "font-bold text-fg" : "text-muted"} aria-current={current ? "step" : undefined}>
                {done ? "✓" : `${i + 1}.`} {s.label}
                {current && "（いまここ）"}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
