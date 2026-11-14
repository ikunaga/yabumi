import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { SnsMark } from "@/components/ui/marks";
import { projectSettingsHref } from "@/lib/projects/paths";
import { SNS, type SnsKey } from "@/lib/sns";
import { agoLabel, type CommentView, type PostCommentsView } from "@/lib/sns/comments/view";
import { toYmd } from "@/lib/time";

// SNS のコメントの部品（docs/design/sns-comments.md の 6、docs/architecture.md の 4.70）。
// 本文と名前は文字のまま出す（リンクにしない。なりすましの URL に誘わないため）。朱は「●」の印だけに使う

const PREVIEW_CHARS = 140;

const sentLabel = (iso: string) => {
  const [, m, d] = toYmd(new Date(iso)).split("-");
  return `${Number(m)}/${Number(d)} 送信`;
};

function CommentRow({ c, now }: { c: CommentView; now: Date }) {
  const chars = [...c.body];
  const long = chars.length > PREVIEW_CHARS;
  return (
    <li className={`flex flex-col gap-1 border-t border-border py-3 first:border-t-0 ${c.isReply ? "ml-6 max-sm:ml-4" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-bold break-all">{c.authorName || "（名前なし）"}</span>
        {c.isOwn && <Badge>あなた</Badge>}
        <span className="num text-faint">{agoLabel(c.commentedAt, now)}</span>
        {c.isNew && (
          <span className="text-xs font-bold">
            <span className="text-signal">●</span> 新しい
          </span>
        )}
      </div>
      <p className="text-[15px] break-words whitespace-pre-wrap">{long ? `${chars.slice(0, PREVIEW_CHARS).join("")}…` : c.body}</p>
      {long && (
        <Disclosure summary="全文を見る">
          <p className="mt-1 text-[15px] break-words whitespace-pre-wrap">{c.body}</p>
        </Disclosure>
      )}
    </li>
  );
}

function OpenLink({ sns, url, reply = true }: { sns: SnsKey; url: string | null; reply?: boolean }) {
  if (!url) return <span className="text-sm text-faint">{SNS[sns].label} のリンクがありません</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-primary underline">
      {SNS[sns].label} で開{reply ? "いて返信する" : "く"} ↗
    </a>
  );
}

function counts(p: PostCommentsView) {
  const parts = [sentLabel(p.publishedAt)];
  if (p.likes !== null) parts.push(`いいね ${p.likes}`);
  parts.push(`${p.sns === "x" ? "返信" : "コメント"} ${p.count}`);
  return parts.join("・");
}

// コメントの画面の、投稿ごとのカード
export function PostCommentsCard({ projectId, p, now }: { projectId: string; p: PostCommentsView; now: Date }) {
  if (p.sns === "x") {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4 max-sm:px-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <SnsMark sns="x" />
              <Link href={`/projects/${projectId}/posts/${p.postId}`} className="min-w-0 truncate font-bold hover:underline">
                {p.title}
              </Link>
            </div>
            <p className="num text-sm text-muted">{counts(p)}</p>
          </div>
          <OpenLink sns="x" url={p.url} reply={false} />
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-col gap-1 px-6 pt-5 max-sm:px-4 max-sm:pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <SnsMark sns={p.sns} />
          <Link href={`/projects/${projectId}/posts/${p.postId}`} className="min-w-0 truncate font-bold hover:underline">
            {p.title}
          </Link>
        </div>
        <p className="num text-sm text-muted">{counts(p)}</p>
      </div>
      <ul className="px-6 max-sm:px-4">
        {p.comments.map((c) => (
          <CommentRow key={c.id} c={c} now={now} />
        ))}
      </ul>
      <div className="border-t border-border px-6 py-3 max-sm:px-4">
        <OpenLink sns={p.sns} url={p.url} />
      </div>
    </Card>
  );
}

// 投稿の画面の「コメント」（その投稿の分。SNS が複数なら SNS ごとに分ける）
export function PostCommentsSection({ posts, now }: { posts: PostCommentsView[]; now: Date }) {
  const withComments = posts.filter((p) => p.sns !== "x");
  if (!withComments.length) return null;
  const newCount = withComments.reduce((n, p) => n + p.newCount, 0);
  return (
    <Card>
      <CardHeader title="コメント" action={newCount > 0 ? <span className="num">新しい {newCount}</span> : undefined} />
      {withComments.map((p) => (
        <div key={p.targetId}>
          {withComments.length > 1 && (
            <div className="px-6 pt-1 max-sm:px-4">
              <SnsMark sns={p.sns} />
            </div>
          )}
          <ul className="px-6 max-sm:px-4">
            {p.comments.map((c) => (
              <CommentRow key={c.id} c={c} now={now} />
            ))}
          </ul>
          <div className="border-t border-border px-6 py-3 max-sm:px-4">
            <OpenLink sns={p.sns} url={p.url} />
          </div>
        </div>
      ))}
    </Card>
  );
}

// 概要の帯（新しいコメントがあるときだけ）
export function NewCommentsStrip({ projectId, total, bySns }: { projectId: string; total: number; bySns: Partial<Record<SnsKey, number>> }) {
  if (total === 0) return null;
  const parts = (Object.entries(bySns) as [SnsKey, number][]).map(([sns, n]) => `${SNS[sns].label} ${n}`);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-5 py-3 max-sm:px-4">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <b>
          <span className="text-signal">●</span> 新しいコメント <span className="num">{total}</span>
        </b>
        <span className="text-sm text-muted">{parts.join("・")}</span>
      </span>
      <ButtonLink href={`/projects/${projectId}/comments`} variant="secondary" size="sm">
        コメントを見る
      </ButtonLink>
    </div>
  );
}

// つなぎ直しの案内（コメントの権限なしでつないだ SNS があるとき）
export function CommentsReconnectNotice({ projectId, sns }: { projectId: string; sns: SnsKey[] }): ReactNode {
  if (!sns.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface px-5 py-3 text-sm max-sm:px-4">
      <b className="text-signal">● 要確認</b>
      {sns.map((s) => SNS[s].label).join("・")} のコメントを見るには、つなぎ直しが要ります。
      <Link href={projectSettingsHref(projectId, "sns")} className="ml-2 font-bold text-fg underline">
        つないだ SNS へ
      </Link>
      <HelpTip label="つなぎ直すと変わること">
        つなぎ直すと、SNS の画面で「コメントを読む権限」を許可できます。許可すると、yabumi から送った投稿のコメント（書いた人の名前・本文・日時）を、送ってから 7 日まで読みに行きます。コメントは yabumi に 30 日だけ置いて消し、AI には送りません。
      </HelpTip>
    </div>
  );
}
