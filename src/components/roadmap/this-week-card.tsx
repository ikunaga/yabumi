import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { KPIS } from "@/lib/metrics/kpis";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { formatValue } from "@/lib/roadmap/schema";

// 概要の「今週のやること」（「いまやること」の 4 段階が済んだあと。docs/architecture.md の 4.23）
export function ThisWeekCard({
  projectId,
  todos,
  progress,
  doneCount,
}: {
  projectId: string;
  todos: RoadmapItem[];
  progress: Record<string, { actual: number; target: number } | null>;
  doneCount: number;
}) {
  const href = `/projects/${projectId}/roadmap`;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="今週のやること"
        action={
          <Link href={href} className="text-[14px] font-semibold text-primary hover:underline">
            ロードマップを見る
          </Link>
        }
      />
      {todos.length === 0 ? (
        <p className="px-5 py-4 text-[14px] leading-7 text-muted max-sm:px-4">
          {doneCount > 0 ? `今週のやることは済みました（${doneCount} 件）。おつかれさまでした。` : "今週のやることはまだありません。"}
          <Link href={href} className="ml-2 font-semibold text-primary hover:underline">
            {doneCount > 0 ? "来週のことを見る" : "やることを決める"}
          </Link>
        </p>
      ) : (
        <ul>
          {todos.map((t) => {
            const p = progress[t.id];
            return (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-5 py-3 text-[14px] last:border-b-0 max-sm:px-4">
                <b>{t.title}</b>
                {t.kpi && p && (
                  <span className="text-xs text-muted">
                    {KPIS[t.kpi].label} {formatValue(t.kpi, p.actual)} / {formatValue(t.kpi, p.target)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
