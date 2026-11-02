import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help";
import { SnsMark } from "@/components/ui/marks";
import type { WeekPace } from "@/lib/coach/pace";

// 今週の投稿のあと何本（見本 C の「投稿の空き枠」。オーナーの指摘で「空き枠」はやめた 2026-11-02）: 設計の週の回数に対し、今週まだ予約・投稿していない数（伴走と同じ計算。src/lib/coach/pace.ts）
export function WeekSlotsCard({ week, base }: { week: WeekPace | null; base: string }) {
  const open = week ? week.rows.reduce((n, r) => n + r.remaining, 0) : 0;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            今週の投稿
            <HelpTip label="今週の投稿">アカウント設計で決めた週の回数まで、あと何本かです。予約した分も出したものとして数えます。</HelpTip>
          </span>
        }
      />
      {!week ? (
        <div className="flex flex-col items-start gap-2 px-6 pb-5 max-sm:px-4">
          <p className="text-[15px] text-faint">週の回数を決めると出ます</p>
          <Link href={`${base}/plan`} className="text-[14px] text-muted underline hover:text-fg">
            アカウント設計で決める
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-6 pb-5 max-sm:px-4">
          <p className={`num text-metric leading-none font-bold max-sm:text-[30px] ${open > 0 ? "text-signal" : ""}`}>
            {open > 0 ? (
              <>
                <span className="mr-1 text-sm font-bold text-muted">あと</span>
                {open}
                <span className="ml-1 text-sm font-bold text-muted">本</span>
              </>
            ) : (
              <span className="text-[20px] text-success">✓ 今週の分はそろいました</span>
            )}
          </p>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {week.rows.map((r) => (
              <li key={r.sns} className="flex items-center gap-2">
                <SnsMark sns={r.sns} />
                <span className="num text-muted">
                  {r.published + r.scheduled} / {r.target} 本
                </span>
                <span className={`num ml-auto ${r.remaining > 0 ? "font-bold text-signal" : "text-success"}`}>{r.remaining > 0 ? `あと ${r.remaining}` : "✓"}</span>
              </li>
            ))}
          </ul>
          {open > 0 && (
            <Link href={`${base}/compose`} className="self-start text-[14px] text-muted underline hover:text-fg">
              投稿をつくる
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
