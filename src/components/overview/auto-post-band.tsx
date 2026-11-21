import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import type { OverviewAutoBand } from "@/lib/auto-post/entry";
import { HOLD_TITLE } from "@/lib/auto-post/holds";
import { SNS } from "@/lib/sns";

// 概要の自動の投稿の 1 行の帯（docs/design/auto-post.md の 1.2）。
// 「↻ 自動の投稿 2 件が動いています ・ 次は 明日 09:00（Threads・X）」→ 一覧。確かめ待ちがあれば、その画面への入口を並べる。
// yabumi が止めた回し方は、同じ帯の中に「● 要確認」として出す（新しいコメントの帯と同じ作り）
export function AutoPostBand({ projectId, band }: { projectId: string; band: OverviewAutoBand | null }) {
  if (!band) return null;
  const base = `/projects/${projectId}/auto`;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-5 py-3 max-sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex flex-wrap items-baseline gap-x-2">
          {band.held ? (
            // 運営者が止めている間は回を作らないので、「動いています」「次は…」は出さない
            <b>
              <span className="text-signal">● 要確認</span> {HOLD_TITLE}
            </b>
          ) : band.active > 0 ? (
            <b>
              <span className="text-primary">↻</span> 自動投稿を <span className="num">{band.active}</span> 件運用中です
            </b>
          ) : (
            <b className="text-muted">‖ 自動投稿は止めています</b>
          )}
          {band.next && !band.held && (
            <span className="text-sm text-muted">
              次は <span className="num">{band.next.label}</span>
              {band.next.sns.length > 0 && `（${band.next.sns.map((s) => SNS[s].label).join("・")}）`}
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-2">
          {band.review > 0 && (
            <ButtonLink href={`${base}/review`} size="sm">
              確認待ちの投稿 {band.review} 本
            </ButtonLink>
          )}
          <ButtonLink href={base} variant="secondary" size="sm">
            自動投稿を見る
          </ButtonLink>
        </span>
      </div>
      {band.stopped.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {band.stopped.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
              <b className="text-signal">● 要確認</b>
              <Link href={`${base}/${p.id}`} className="font-bold text-fg underline">
                {p.name}
              </Link>
              <span className="text-muted">が止まりました。{p.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
