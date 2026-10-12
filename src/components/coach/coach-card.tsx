import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import type { CoachView } from "@/lib/coach/load";
import { CYCLE_WEEKS, remainingText, type PaceStatus } from "@/lib/coach/pace";
import { SNS, SNS_KEYS } from "@/lib/sns";

// 伴走の声かけ（F18、決定 D29。docs/architecture.md の 4.27）。概要の一番上に、今週のペースと、次にすること
const STATUS: Record<PaceStatus, { text: string; className: string }> = {
  done: { text: "✓ 届きました", className: "font-bold text-success" },
  on_track: { text: "予約で届きます", className: "text-primary" },
  behind: { text: "● 遅れそう", className: "font-bold text-signal" },
  not_yet: { text: "これから", className: "text-muted" },
  missed: { text: "届かなかった", className: "text-muted" },
};

export function CoachCard({ projectId, view, aiEnabled }: { projectId: string; view: CoachView; aiEnabled: boolean }) {
  const base = `/projects/${projectId}`;
  const { week, streak, cycle } = view;
  const left = remainingText(week);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="今週の投稿のペース"
        action={
          <Link href={`${base}/plan?open=first_month`} className="text-[14px] font-semibold text-primary hover:underline">
            週の回数を変える
          </Link>
        }
      />
      <div className="flex flex-col gap-3 px-5 py-4 text-[14px] leading-7 max-sm:px-4">
        {cycle && !cycle.ended && (
          <p className="text-xs text-muted">
            最初の 1 か月の {cycle.weekIndex} 週目（{CYCLE_WEEKS} 週まで、{cycle.endsOn.slice(5).replace("-", "/")} まで）
          </p>
        )}
        {week.achieved ? (
          <p className="text-lg font-bold text-success">今週は目標達成です。よく続けましたね。</p>
        ) : week.covered ? (
          <p className="text-lg font-bold">予約した分で、今週の目標に届きます。あとは送られるのを待つだけです。</p>
        ) : (
          <p className="text-lg font-bold">今週あと {left}</p>
        )}
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {week.rows.map((r) => (
            <li key={r.sns} className="flex items-baseline gap-2">
              <b>{SNS[r.sns].label}</b>
              <span>
                {r.published} / {r.target} 本{r.scheduled > 0 && <span className="text-xs text-muted">（予約 {r.scheduled}）</span>}
              </span>
              <span className={`text-xs ${STATUS[r.status].className}`}>{STATUS[r.status].text}</span>
            </li>
          ))}
        </ul>
        {streak > 0 && (
          <p className="text-sm">
            続けた週: <b>{streak} 週</b>
            <span className="ml-2 text-xs text-muted">{week.achieved ? "（今週を含む）" : "（先週まで。今週も届けば 1 週増えます）"}</span>
          </p>
        )}
        {!week.achieved && !week.covered && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}/compose`} size="sm">
              投稿をつくる
            </ButtonLink>
            <ButtonLink href={`${base}/notes`} size="sm" variant="secondary">
              ネタ帳から作る
            </ButtonLink>
            {aiEnabled && (
              <ButtonLink href={`${base}/ideas`} size="sm" variant="secondary">
                AI とネタを出す
              </ButtonLink>
            )}
          </div>
        )}
        <p className="text-xs text-muted">
          送った投稿と、予約した投稿を数えます（週は月曜から）。遅れそうなときと毎週月曜に、メールでもお知らせします（
          <Link href="/settings/notifications" className="font-semibold text-primary hover:underline">
            お知らせの設定
          </Link>
          ）。
        </p>
      </div>
    </Card>
  );
}

// 1 か月（4 週）が終わったら: 結果のまとめと、AI と振り返る・次の 1 か月の目標を決める
export function CycleSummaryCard({ projectId, view, aiEnabled }: { projectId: string; view: CoachView; aiEnabled: boolean }) {
  const cycle = view.cycle!;
  const base = `/projects/${projectId}`;
  const achievedWeeks = cycle.weeks.filter((w) => w.achieved).length;
  const totals = SNS_KEYS.filter((s) => cycle.weeks.some((w) => (w.targets[s] ?? 0) > 0)).map((s) => ({
    sns: s,
    published: cycle.weeks.reduce((n, w) => n + (w.published[s] ?? 0), 0),
    target: cycle.weeks.reduce((n, w) => n + (w.targets[s] ?? 0), 0),
  }));
  return (
    <Card className="overflow-hidden">
      <CardHeader title="最初の 1 か月が終わりました" />
      <div className="flex flex-col gap-3 px-5 py-4 text-[14px] leading-7 max-sm:px-4">
        <p>
          {cycle.startedOn.slice(5).replace("-", "/")}〜{cycle.endsOn.slice(5).replace("-", "/")} の {CYCLE_WEEKS} 週のうち、<b>{achievedWeeks} 週</b>で目標に届きました。
          {achievedWeeks === CYCLE_WEEKS ? "全部の週で届きました。すばらしいです。" : achievedWeeks > 0 ? "続けられた週があることが、何よりの成果です。" : "最初の 1 か月は、続けること自体が難しいものです。回数を見直して、無理のない形で続けましょう。"}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {totals.map((t) => (
            <li key={t.sns}>
              <b>{SNS[t.sns].label}</b> {t.published} / {t.target} 本
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">AI と一緒に振り返って、次の 1 か月の週の回数を決めましょう。決めた日から、次の 1 か月を数え始めます。</p>
        <div className="flex flex-wrap gap-2">
          {aiEnabled && (
            <ButtonLink href={`${base}/consult/new?start=month_review`} size="sm">
              AI と振り返る
            </ButtonLink>
          )}
          <ButtonLink href={`${base}/plan?open=first_month`} size="sm" variant={aiEnabled ? "secondary" : "primary"}>
            次の 1 か月の目標を決める
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

// 週の回数をまだ決めていないとき（設計が済んだあと）
export function CoachSetupCard({ projectId }: { projectId: string }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[14px] leading-7 max-sm:px-4">
        <p className="min-w-0">
          <b>SNS ごとの週の投稿の回数</b>を決めると、矢書がペースを見守り、遅れそうなときに声をかけます。
        </p>
        <ButtonLink href={`/projects/${projectId}/plan?open=first_month`} size="sm" variant="secondary">
          週の回数を決める
        </ButtonLink>
      </div>
    </Card>
  );
}
