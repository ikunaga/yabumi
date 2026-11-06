"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { callAction } from "@/lib/client-errors";
import { searchXBuzz } from "@/lib/sns/x/search-actions";
import { xSearchQuotaText, type XBuzzPost, type XSearchQuota } from "@/lib/sns/x/search";
import { formatShort } from "@/lib/time";

// X の人気の投稿を yabumi の中で探す（A 案。docs/architecture.md の 4.52）。材料「X で人気の投稿から」の中に置く。
// 結果はこの画面を開いている間だけ持つ（保存しない）。「この投稿を元にする」で、URL と本文を B 案の欄に渡す
export function XBuzzSearch({
  projectId,
  query,
  quota: initialQuota,
  onPick,
}: {
  projectId: string;
  // いま選んでいる検索の言葉（演算子なし）
  query: string;
  quota: XSearchQuota;
  onPick: (pick: { url: string; text: string }) => void;
}) {
  const [quota, setQuota] = useState(initialQuota);
  const [posts, setPosts] = useState<XBuzzPost[] | null>(null);
  const [searched, setSearched] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const word = query.trim();
  const canSearch = quota.reason === "ok" && quota.remaining > 0 && word !== "" && !pending;

  function search() {
    setError(null);
    startTransition(async () => {
      const r = await callAction(() => searchXBuzz(projectId, word));
      if (!r.ok) {
        setError(r.failure.message);
        return;
      }
      // 残りの回数を読めなかったとき（not_ready）は、前の表示のまま
      if (r.value.quota.reason !== "not_ready") setQuota(r.value.quota);
      if (r.value.ok) {
        setPosts(r.value.posts);
        setSearched(word);
        setPicked(null);
      } else if (r.value.message) setError(r.value.message);
    });
  }

  const limited = quota.reason !== "ok" || quota.remaining === 0;
  return (
    <section aria-label="yabumi の中で探す" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" variant="secondary" size="sm" onClick={search} disabled={!canSearch} aria-describedby="x-buzz-quota">
          {pending ? "探しています…" : "yabumi の中で探す"}
        </Button>
        <p id="x-buzz-quota" className={`text-sm ${limited ? "text-fg" : "text-muted"}`}>
          {xSearchQuotaText(quota)}
        </p>
      </div>
      {limited ? (
        <p className="text-sm text-muted">X の画面で探す方法（上の「X で開く」）は、そのまま使えます。</p>
      ) : (
        <p className="text-sm text-muted">「{word || "検索の言葉"}」で、直近 7 日の投稿を 10 件まで読み、反応の多い順に並べます。押すたびに 1 回と数えます。</p>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {posts && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            「{searched}」の結果 {posts.length} 件（反応の多い順。この画面を閉じると消えます）
          </p>
          {posts.length === 0 ? (
            <p className="text-sm text-muted">見つかりませんでした。言葉を変えるか、X の画面で探してください。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {posts.map((p) => (
                <XBuzzItem
                  key={p.id}
                  post={p}
                  picked={picked === p.id}
                  onPick={() => {
                    setPicked(p.id);
                    onPick({ url: p.url, text: p.text });
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// X の表示の決まり: アイコン（左）・名前・@ はプロフィールへのリンク、本文は名前の下にそのまま、日時は元の投稿へのリンク
function XBuzzItem({ post, picked, onPick }: { post: XBuzzPost; picked: boolean; onPick: () => void }) {
  const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
  return (
    <li className="flex gap-3 rounded-md border border-line p-3 max-sm:gap-2.5">
      <a href={post.author.profileUrl} {...ext} className="shrink-0" aria-hidden tabIndex={-1}>
        {post.author.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- X の画像のサーバーのアイコン。next/image の最適化を通さない（保存しない）
          <img src={post.author.imageUrl} alt="" width={40} height={40} className="size-10 rounded-full bg-subtle" referrerPolicy="no-referrer" />
        ) : (
          <span className="block size-10 rounded-full bg-subtle" />
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <a href={post.author.profileUrl} {...ext} className="font-bold text-fg">
            {post.author.name}
          </a>
          <a href={post.author.profileUrl} {...ext} className="text-muted">
            @{post.author.username}
          </a>
          <span className="text-faint" aria-hidden>
            ·
          </span>
          <a href={post.url} {...ext} className="text-muted">
            <time dateTime={post.createdAt}>{formatShort(post.createdAt)}</time>
          </a>
        </p>
        <p className="whitespace-pre-wrap break-words text-[15px] text-fg">{post.text}</p>
        <p className="flex flex-wrap gap-x-3 text-sm text-muted">
          <span>いいね {post.likes.toLocaleString("ja-JP")}</span>
          <span>リポスト {post.reposts.toLocaleString("ja-JP")}</span>
          {post.quotes > 0 && <span>引用 {post.quotes.toLocaleString("ja-JP")}</span>}
          {post.replies > 0 && <span>返信 {post.replies.toLocaleString("ja-JP")}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button type="button" size="sm" variant="secondary" onClick={onPick} aria-pressed={picked}>
            {picked ? "元にしました" : "この投稿を元にする"}
          </Button>
          <a href={post.url} {...ext} className="text-sm text-muted underline">
            X で見る
          </a>
        </div>
      </div>
    </li>
  );
}
