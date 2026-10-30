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
      <div className="flex flex-col gap-4 px-6 pb-5 max-sm:px-4">
        <TrendBlock title="よく見られる" side={trends.views} unit="本" format={(v) => `${Math.round(v).toLocaleString("ja-JP")} 回`} />
        <TrendBlock title="クリックされる" side={trends.clicks} unit="回" format={(v) => `${v.toLocaleString("ja-JP")} 回`} />
      </div>
    </Card>
  );
}

function TrendBlock({ title, side, unit, format }: { title: string; side: TrendSide; unit: string; format: (v: number) => string }) {
  if (!side.ready) {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="text-[14px] font-bold">{title}</p>
        <p className="text-[14px] text-faint">まだ判断できる数がありません</p>
        <p className="num text-[13px] text-faint">
          あと {side.need} {unit}ほどで出ます
        </p>
      </div>
    );
  }
  const max = Math.max(...side.bands.map((b) => b.value));
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline gap-2 text-[14px]">
        <b>{title}</b>
        <span className="text-muted">
          {BAND_INFO[side.best].label}（{BAND_INFO[side.best].hours}）
        </span>
      </p>
      <div className="flex flex-col gap-2 [&>div]:grid-cols-[3.5rem_1fr_4.5rem] [&>div]:text-[14px]">
        {side.bands.map((b) => (
          <BarRow key={b.band} label={BAND_INFO[b.band].label} value={b.value} max={max} barClass={b.band === side.best ? "bg-info" : "bg-info/40"} display={<span className="text-[14px]">{format(b.value)}</span>} />
        ))}
      </div>
    </div>
  );
}
