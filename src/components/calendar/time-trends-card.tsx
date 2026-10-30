import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help";
import { BarRow } from "@/components/ui/metric";
import { BAND_INFO, MIN_CLICKS_PER_BAND, MIN_POSTS_PER_BAND, type TimeTrends, type TrendSide } from "@/lib/metrics/time-bands";

// 時間帯ごとの傾向（見本 C の右。数字の段 4）。矢書が数えた、直近 90 日のあなたの数字。少ない帯は比べない
export function TimeTrendsCard({ trends }: { trends: TimeTrends }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            時間帯の傾向
            <HelpTip label="時間帯の傾向">
              矢書が数えた、直近 90 日のあなたの数字です。よく見られるは、送った時間帯ごとの 1 本あたりの閲覧数（SNS から取り込めた投稿と、手で入れた note・Substack）。クリックされるは、短縮リンクが押された時間帯です。投稿が {MIN_POSTS_PER_BAND}{" "}
              本未満・クリックが {MIN_CLICKS_PER_BAND} 回未満の時間帯は比べません。傾向であって、その時間に送れば必ず見られるわけではありません。
            </HelpTip>
          </span>
        }
        action="直近 90 日"
      />
      <div className="grid grid-cols-2 gap-x-10 gap-y-5 px-6 pb-5 max-md:grid-cols-1 max-sm:px-4">
        <TrendBlock
          title="よく見られる"
          what="送った時間帯ごとの、1 本あたりの表示"
          side={trends.views}
          unit="本"
          display={(b) => (
            <>
              {Math.round(b.value).toLocaleString("ja-JP")} 回<span className="ml-1 text-[12px] font-normal text-faint">（{b.count} 本）</span>
            </>
          )}
        />
        <TrendBlock
          title="クリックされる"
          what="短縮リンクが押された時間帯ごとの回数（90 日の合計）"
          side={trends.clicks}
          unit="回"
          display={(b) => <>{b.value.toLocaleString("ja-JP")} 回</>}
        />
      </div>
    </Card>
  );
}

function TrendBlock({
  title,
  what,
  side,
  unit,
  display,
}: {
  title: string;
  what: string;
  side: TrendSide;
  unit: string;
  display: (b: { value: number; count: number }) => ReactNode;
}) {
  const head = (
    <div className="flex flex-col gap-0.5">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
        <b>{title}</b>
        {side.ready && (
          <span className="text-muted">
            {BAND_INFO[side.best].label}（{BAND_INFO[side.best].hours}）
          </span>
        )}
      </p>
      <p className="text-[13px] text-faint">{what}</p>
    </div>
  );
  if (!side.ready) {
    return (
      <div className="flex flex-col gap-1.5">
        {head}
        <p className="text-[14px] text-faint">まだ判断できる数がありません</p>
        <p className="num text-[13px] text-faint">
          あと {side.need} {unit}ほどで出ます
        </p>
      </div>
    );
  }
  const max = Math.max(...side.bands.map((b) => b.value));
  return (
    <div className="flex flex-col gap-2.5">
      {head}
      <div className="flex flex-col gap-2 [&>div]:grid-cols-[3rem_1fr_8.5rem] [&>div]:text-[14px]">
        {side.bands.map((b) => (
          <BarRow
            key={b.band}
            label={BAND_INFO[b.band].label}
            value={b.value}
            max={max}
            barClass={b.band === side.best ? "bg-info" : "bg-info/40"}
            display={<span className="text-[15px]">{display(b)}</span>}
          />
        ))}
      </div>
    </div>
  );
}
