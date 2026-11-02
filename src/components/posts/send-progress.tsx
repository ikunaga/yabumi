"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SNS, type SnsKey } from "@/lib/sns";

type Status = "pending" | "publishing" | "preparing" | "published" | "failed" | "deleted";

type Props = {
  // 保存できた投稿（保存している間は null）
  postId: string | null;
  sns: SnsKey[];
  hasImages: boolean;
};

// 今すぐ送るの進み具合（docs/architecture.md の 4.36）。押した瞬間から、投稿の画面に移るまで出し続ける。
// 送り先ごとの状態は、送っている間 1 秒ごとに読む（/api/posts/[postId]/progress。送るのはサーバーで続くので、読めなくても送信は止まらない）
export function SendProgress({ postId, sns, hasImages }: Props) {
  const [states, setStates] = useState<Partial<Record<SnsKey, Status>>>({});
  const box = useRef<HTMLDivElement>(null);

  // 出たら見える位置に（スマホで、押したボタンの上に出て見落とさないように）
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!postId) return;
    let stop = false;
    const read = async () => {
      try {
        const res = await fetch(`/api/posts/${postId}/progress`, {
          cache: "no-store",
        });
        if (!res.ok || stop) return;
        const { targets } = (await res.json()) as {
          targets: { sns: SnsKey; status: Status }[];
        };
        if (!stop) setStates(Object.fromEntries(targets.map((t) => [t.sns, t.status])));
      } catch {
        // 読めなくても送信は続く。次の回にもう一度読む
      }
    };
    read();
    const timer = setInterval(read, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [postId]);

  const names = sns.map((s) => SNS[s].label).join("・");
  const finished = postId !== null && sns.length > 0 && sns.every((s) => ["published", "failed", "preparing", "deleted"].includes(states[s] ?? ""));

  return (
    <div ref={box} role="status" aria-live="polite" className="flex flex-col gap-2.5 rounded-lg border border-primary bg-primary-soft px-4 py-3.5">
      <p className="flex items-start gap-2.5 text-[15px] font-bold text-fg">
        {!finished && <Spinner />}
        <span>{finished ? "送り終えました。結果の画面に移ります…" : postId ? `${names} に送っています` : "保存しています…"}</span>
      </p>
      {!finished && (
        <p className="text-[13px] leading-[1.7] text-muted">数秒〜数十秒かかります。このまま待ってください（画面を閉じても、送るのは続きます）。</p>
      )}
      <ul className="flex flex-col gap-1.5 text-[14px]">
        {sns.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <Row label={SNS[s].label} status={postId ? states[s] : undefined} hasImages={hasImages} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, status, hasImages }: { label: string; status?: Status; hasImages: boolean }) {
  switch (status) {
    case "published":
      return <span className="font-bold text-success">✓ {label} に送りました</span>;
    case "failed":
      return <span className="font-bold text-danger">! {label} に送れませんでした（理由は次の画面に出ます）</span>;
    case "preparing":
      return <span className="text-fg">● {label} が画像を受け取っています。このあと自動で投稿されます</span>;
    case "publishing":
      return (
        <>
          <Spinner small />
          <span className="text-fg">
            {label} に{hasImages ? "画像と本文を" : ""}送っています…
          </span>
        </>
      );
    default:
      return <span className="text-muted">○ {label}（順番を待っています）</span>;
  }
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent ${small ? "size-3.5" : "mt-0.5 size-4.5"}`}
    />
  );
}

// 送り終えて投稿の画面に移る間（その画面の loading.tsx の骨組みが出ている間）も、知らせを消さないための目印。
// 画面を移ると上の進み具合は消えるので、ブラウザのこのタブ（sessionStorage）に、送った投稿の id を短い間だけ置く
const SENT_KEY = "yabumi:send-now";
const SENT_TTL_MS = 2 * 60 * 1000;

export function markSending(postId: string) {
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify({ postId, at: Date.now() }));
  } catch {
    // 置けなくても、骨組みが出るだけ
  }
}

export function clearSending(postId: string) {
  try {
    if (sendingPostId() === postId) sessionStorage.removeItem(SENT_KEY);
  } catch {
    // 消せなくても、期限で使われなくなる
  }
}

function sendingPostId(): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? "null") as { postId?: string; at?: number } | null;
    return v?.postId && v.at && Date.now() - v.at < SENT_TTL_MS ? v.postId : null;
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

// 投稿の画面の loading.tsx に置く。今すぐ送ったあとに移ってきたときだけ、骨組みの上に「結果を読み込んでいます」を出す
export function SentLoadingNotice() {
  const params = useParams<{ postId?: string }>();
  const postId = useSyncExternalStore(noopSubscribe, sendingPostId, () => null);
  if (!postId || postId !== params.postId) return null;
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-2.5 rounded-lg border border-primary bg-primary-soft px-4 py-3.5 text-[15px] font-bold text-fg">
      <Spinner />
      <span>送信の結果を読み込んでいます…</span>
    </div>
  );
}
