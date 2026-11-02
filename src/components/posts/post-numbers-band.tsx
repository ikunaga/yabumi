import Link from "next/link";
import { HelpTip } from "@/components/ui/help";
import { SnsMark } from "@/components/ui/marks";
import type { PostNumbers } from "@/lib/posts/numbers";
import { formatShort } from "@/lib/time";

// 投稿をつくる画面の下の数字の帯（見本 B）。出せる数字だけを並べる。呼ぶ側で、数字がなければ出さない
export function PostNumbersBand({ projectId, numbers }: { projectId: string; numbers: PostNumbers }) {
  const cells = [
    numbers.views !== null && { label: "見られた数", value: numbers.views },
    numbers.likes !== null && { label: "いいね", value: numbers.likes },
    numbers.clicks !== null && { label: "短縮リンクのクリック", value: numbers.clicks },
  ].filter((c): c is { label: string; value: number } => Boolean(c));

  return (
    <section aria-labelledby="post-numbers" className="grid grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] gap-6 rounded-lg border border-border bg-surface2 px-6 py-4 max-md:grid-cols-2 max-sm:gap-4 max-sm:px-4">
      <div className="flex min-w-0 flex-col gap-1.5 max-md:col-span-2">
        <h2 id="post-numbers" className="flex items-center gap-1.5 text-[15px] text-muted">
          {numbers.kind === "this" ? "この投稿の数字" : "前回の投稿の数字"}
          <HelpTip label="数字">
            SNS から取り込めた数字と、短縮リンクが押された回数です。取り込めていない数字は出しません。
          </HelpTip>
        </h2>
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-faint">
          {numbers.kind === "last" ? (
            <Link href={`/projects/${projectId}/posts/${numbers.postId}`} className="num underline">
              {formatShort(numbers.publishedAt)}
            </Link>
          ) : (
            <span className="num">{formatShort(numbers.publishedAt)}</span>
          )}
          {numbers.sns.map((s) => (
            <SnsMark key={s} sns={s} />
          ))}
        </p>
      </div>
      {cells.map((c) => (
        <div key={c.label} className="min-w-0">
          <p className="truncate text-[15px] text-muted">{c.label}</p>
          <p className="num mt-0.5 text-[26px] leading-tight font-bold">{c.value.toLocaleString("ja-JP")}</p>
        </div>
      ))}
    </section>
  );
}
