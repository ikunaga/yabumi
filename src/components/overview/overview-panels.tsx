import Link from "next/link";
import type { ReactNode } from "react";
import { BarRow } from "@/components/ui/metric";
import { SNS_COLOR, SnsMark } from "@/components/ui/marks";
import { Disclosure } from "@/components/ui/help";
import type { ClicksBySns } from "@/lib/metrics/queries";
import { slotLabel } from "@/lib/overview/numbers";
import { postTitle, type PostRow } from "@/lib/posts/queries";
import { projectSettingsHref } from "@/lib/projects/paths";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { isManualSns, SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { ProjectSnsAccount } from "@/lib/sns/queries";
import { dayOfMonth, formatShort, monthOf, weekdayLabel } from "@/lib/time";

// 概要の右の列などの箱（見本 A の .box。見出しと右に小さな添え書き）
export function Panel({ title, aside, children, className = "" }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-surface px-5 py-4 max-sm:px-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-bold max-sm:text-[15px]">{title}</h2>
        {aside && <span className="num shrink-0 text-sm text-faint">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

// SNS ごとのストアへのクリック（見本 A の「媒体別」。30 日）
export function SnsClicks({ rows }: { rows: ClicksBySns[] }) {
  const max = Math.max(1, ...rows.map((r) => r.last30d));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <BarRow key={r.label} label={r.sns ? SNS[r.sns].label : "SNS なし"} value={r.last30d} max={max} barClass={r.sns ? SNS_COLOR[r.sns].bg : "bg-faint"} />
      ))}
    </div>
  );
}

// 次の予約（見本 A。時刻・SNS の印・本文の 1 行目）
export function NextScheduled({ projectId, posts, now }: { projectId: string; posts: PostRow[]; now: Date }) {
  return (
    <ul>
      {posts.map((p) => {
        const sns = [...new Set(p.targets.filter((t) => t.status !== "deleted").map((t) => t.sns))];
        return (
          <li key={p.id} className="border-t border-dashed border-line first:border-t-0">
            <Link href={`/projects/${projectId}/posts/${p.id}`} className="flex items-center gap-2 py-2 text-[14px] text-fg hover:no-underline hover:opacity-80">
              <span className="num w-[5.5rem] shrink-0 text-muted">{p.planned_at ? slotLabel(p.planned_at, now) : ""}</span>
              <span className="flex shrink-0 gap-1">
                {sns.length >= 4 ? (
                  <span className="inline-flex h-5 items-center rounded-sm border border-input px-1.5 text-[11px] font-bold text-muted">{sns.length} つの SNS</span>
                ) : (
                  sns.map((s) => <SnsMark key={s} sns={s} />)
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{postTitle(p.body, 40)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// つないだ SNS の札の並びと「つなぐ・外す」（設定の画面へ）。1 つもなければ出さない（「いまやること」が SNS をつなぐになる）
export function ConnectedSnsLine({
  projectId,
  accounts,
  manualChannels,
}: {
  projectId: string;
  accounts: ProjectSnsAccount[];
  manualChannels: { sns: string }[];
}) {
  const active = new Set<SnsKey>(accounts.filter((a) => a.status === "active").map((a) => a.sns));
  const broken = new Set<SnsKey>(accounts.filter((a) => a.status !== "active" && !active.has(a.sns)).map((a) => a.sns));
  for (const m of manualChannels) if (SNS_KEYS.includes(m.sns as SnsKey) && isManualSns(m.sns as SnsKey)) active.add(m.sns as SnsKey);
  const shown = SNS_KEYS.filter((s) => active.has(s) || broken.has(s));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
      <span>つないだ SNS</span>
      <span className="flex flex-wrap gap-1">
        {shown.map((s) => (
          <span key={s} className={broken.has(s) ? "opacity-50" : ""}>
            <SnsMark sns={s} />
          </span>
        ))}
      </span>
      {broken.size > 0 && <span className="font-bold text-signal">● つなぎ直しが要る SNS があります</span>}
      <Link href={projectSettingsHref(projectId, "sns")} className="text-muted underline hover:text-fg">
        つなぐ・外す
      </Link>
    </div>
  );
}

// 要確認（送れなかった投稿・予約を過ぎた投稿・手で投稿する番・予定日を過ぎたやること）。あるときだけ、開くと一覧
export function AttentionStrip({
  projectId,
  failed,
  overdue,
  manualDue,
  overdueTodos,
}: {
  projectId: string;
  failed: PostRow[];
  overdue: PostRow[];
  manualDue: PostRow[];
  overdueTodos: RoadmapItem[];
}) {
  const parts = [
    failed.length && `送れなかった投稿 ${failed.length}`,
    overdue.length && `予約を過ぎた投稿 ${overdue.length}`,
    manualDue.length && `手で投稿する番 ${manualDue.length}`,
    overdueTodos.length && `予定日を過ぎたやること ${overdueTodos.length}`,
  ].filter(Boolean);
  const total = failed.length + overdue.length + manualDue.length + overdueTodos.length;
  if (total === 0) return null;
  const base = `/projects/${projectId}`;
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-3 max-sm:px-4">
      <Disclosure
        summary={
          <span className="flex flex-wrap items-baseline gap-x-2">
            <b className="text-signal">● 要確認 {total}</b>
            <span>{parts.join("・")}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-3 text-fg">
          {failed.length > 0 && (
            <Group title="送れなかった投稿">
              {failed.map((p) => {
                const f = p.targets.find((t) => t.status === "failed");
                return (
                  <li key={p.id}>
                    <Link href={`${base}/posts/${p.id}`} className="font-bold hover:underline">
                      {postTitle(p.body, 30)}
                    </Link>
                    {f && (
                      <span className="ml-2 text-muted">
                        {SNS[f.sns].label}: {f.error_message ?? "理由はわかりません"}
                      </span>
                    )}
                  </li>
                );
              })}
            </Group>
          )}
          {overdue.length > 0 && (
            <Group title="予約時刻を過ぎても送られていない投稿" note="矢書の側で送信が遅れています。動き出せば、自動で送られます。">
              {overdue.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}/posts/${p.id}`} className="hover:underline">
                    <span className="num text-muted">{p.planned_at ? formatShort(p.planned_at) : ""}</span> {postTitle(p.body, 30)}
                  </Link>
                </li>
              ))}
            </Group>
          )}
          {manualDue.length > 0 && (
            <Group title="手で投稿する番です" note="note・Substack は自動では送られません。投稿の画面で本文をコピーして投稿し、「投稿した」を押してください。">
              {manualDue.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}/posts/${p.id}`} className="hover:underline">
                    {postTitle(p.body, 30)}
                  </Link>
                  <span className="ml-2 text-muted">
                    {p.targets
                      .filter((t) => isManualSns(t.sns) && t.status === "pending")
                      .map((t) => SNS[t.sns].label)
                      .join("・")}
                  </span>
                </li>
              ))}
            </Group>
          )}
          {overdueTodos.length > 0 && (
            <Group title="予定日を過ぎたやること" note="やらないことにしたら、ロードマップの「やらない」で消えます。">
              {overdueTodos.slice(0, 5).map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="num text-xs font-bold text-signal">
                    {monthOf(i.plannedOn!)}/{dayOfMonth(i.plannedOn!)}（{weekdayLabel(i.plannedOn!)}）
                  </span>
                  <b>{i.title}</b>
                  <Link href={`${base}/compose?item=${i.id}`} className="text-sm underline">
                    この内容で投稿をつくる
                  </Link>
                </li>
              ))}
            </Group>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-bold">{title}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
      <ul className="mt-1 flex flex-col gap-1 text-sm">{children}</ul>
    </div>
  );
}
