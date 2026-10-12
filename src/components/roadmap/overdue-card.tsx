import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { dayOfMonth, monthOf, weekdayLabel } from "@/lib/time";

// 予定日を過ぎたのに、まだ投稿を予約・送信していないロードマップのやること（伴走の声かけ。docs/architecture.md の 4.23・4.27）
export function OverdueTodosCard({ projectId, items }: { projectId: string; items: RoadmapItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="予定日を過ぎたやること"
        action={
          <Link href={`/projects/${projectId}/calendar`} className="text-[14px] font-semibold text-primary hover:underline">
            カレンダーで見る
          </Link>
        }
      />
      <ul>
        {items.slice(0, 5).map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3 text-[14px] last:border-b-0 max-sm:px-4">
            <span className="text-xs font-bold text-signal">
              {monthOf(i.plannedOn!)}/{dayOfMonth(i.plannedOn!)}（{weekdayLabel(i.plannedOn!)}）の予定
            </span>
            <span className="min-w-0 flex-1 font-bold">{i.title}</span>
            <Link href={`/projects/${projectId}/compose?item=${i.id}`} className="shrink-0 text-sm font-semibold text-primary hover:underline">
              この内容で投稿をつくる
            </Link>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-2.5 text-xs text-muted max-sm:px-4">
        予定を変えるときは、ロードマップかカレンダーで予定日を選び直してください。やらないことにしたら、ロードマップの「やらない」で消えます。
      </p>
    </Card>
  );
}
