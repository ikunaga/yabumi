import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SNS_COLOR, SnsMark } from "@/components/ui/marks";
import { BarRow } from "@/components/ui/metric";
import type { CalendarStats } from "@/lib/calendar/stats";
import { postTitle, type PostRow } from "@/lib/posts/queries";
import { SNS } from "@/lib/sns";
import { formatShort } from "@/lib/time";
import type { WeekPace } from "@/lib/coach/pace";
import { WeekSlotsCard } from "./week-slots-card";

// カレンダーの右の列（見本 C の右）。今週の空き枠・SNS ごとの本数・次の予約（数字の段 4。時間帯の傾向は左の列のマス目の下。DL・相関は出さない）
export function CalendarSide({ stats, month, upcoming, base, week }: { stats: CalendarStats; month: number; upcoming: PostRow[]; base: string; week: WeekPace | null }) {
  const max = Math.max(0, ...stats.bySns.map((s) => s.count));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <WeekSlotsCard week={week} base={base} />
      <Card>
        <CardHeader title="SNS ごと" action={`${month} 月の予約と投稿済み`} />
        {stats.bySns.length ? (
          <div className="flex flex-col gap-3 px-6 pt-2 pb-5 [&>div]:grid-cols-[5.5rem_1fr_2.5rem] [&>div]:text-[15px]">
            {stats.bySns.map((s) => (
              <BarRow key={s.sns} label={SNS[s.sns].label} value={s.count} max={max} barClass={SNS_COLOR[s.sns].bg} />
            ))}
          </div>
        ) : (
          <p className="px-6 pt-1 pb-5 text-[15px] text-faint">まだありません</p>
        )}
      </Card>
      <Card>
        <CardHeader title="次の予約" />
        {upcoming.length ? (
          <ul className="px-6 pb-3">
            {upcoming.map((p) => (
              <li key={p.id} className="border-t border-line first:border-t-0">
                <Link href={`${base}/posts/${p.id}`} className="flex flex-col gap-1 py-2.5 hover:no-underline">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="num text-[13px] text-faint">{formatShort(p.planned_at!)}</span>
                    {p.targets.map((t) => (
                      <SnsMark key={t.id} sns={t.sns} />
                    ))}
                  </span>
                  <span className="truncate text-[15px] hover:underline">{postTitle(p.body, 24)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-3 px-6 pt-1 pb-5">
            <p className="text-[15px] text-faint">予約はまだありません</p>
            <ButtonLink href={`${base}/compose`} size="sm">
              ＋ 投稿をつくる
            </ButtonLink>
          </div>
        )}
      </Card>
    </div>
  );
}
