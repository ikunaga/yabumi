"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { sharedText } from "@/lib/notes/rules";
import { SHARE_CACHE, SHARE_CACHE_IMAGE, SHARE_CACHE_TEXT, textFromHash, type SharedPayload } from "@/lib/notes/share";
import { NoteForm } from "./note-form";

// ログインの前に、# のあとに付いて届いた本文を控えておく場所（ログインのあとで /share が読む）
const HASH_KEY = "yabumi-share-hash";
// 前にメモを残したプロジェクト（次に共有したときの最初の選択）
const LAST_PROJECT_KEY = "yabumi-note-project";

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

// ログインしていないとき: # のあとの本文を控えてから、ログインへ送る（service worker が置いたものはブラウザに残っている）
export function ShareStash() {
  useEffect(() => {
    if (window.location.hash) storage("session")?.setItem(HASH_KEY, window.location.hash);
    window.location.replace("/login?next=/share");
  }, []);
  return <p className="p-6 text-sm text-muted">ログインの画面に移ります…</p>;
}

type Received = { text: string; file: File | null; notice: string | null };

// 受け取ったものを集める: service worker が置いたもの → # のあと（ショートカット・ブックマークレット）→ サーバーが受けたもの（cookie）
async function collect(fromServer: SharedPayload | null): Promise<Received> {
  let text = "";
  let file: File | null = null;
  let notice: string | null = null;
  if ("caches" in window) {
    try {
      const cache = await caches.open(SHARE_CACHE);
      const t = await cache.match(SHARE_CACHE_TEXT);
      if (t) {
        const v = (await t.json()) as { title?: string; text?: string; url?: string; at?: number };
        // 1 日より前に受けて残したままのものは使わない
        if (!v.at || Date.now() - v.at < 86_400_000) text = sharedText(v);
      }
      const img = await cache.match(SHARE_CACHE_IMAGE);
      if (img && t) {
        const blob = await img.blob();
        const name = decodeURIComponent(img.headers.get("X-File-Name") ?? "image");
        // 大きい画像は、上げる前に JPEG に縮める（4.18）。service worker が 20MB を超えるものは受けない
        file = new File([blob], name, { type: blob.type });
      }
      await cache.delete(SHARE_CACHE_TEXT);
      await cache.delete(SHARE_CACHE_IMAGE);
    } catch {
      // 読めなければ、ほかの受け取り方を見る
    }
  }
  const session = storage("session");
  const hash = window.location.hash || session?.getItem(HASH_KEY) || "";
  session?.removeItem(HASH_KEY);
  if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  if (!text && hash) text = textFromHash(hash);
  if (!text && !file && fromServer) {
    text = fromServer.text;
    if (fromServer.hadFile) notice = "画像は受け取れませんでした。画像も残すときは、下の「写真・スクリーンショットを添える」から選んでください。";
  }
  return { text, file, notice };
}

// 受け取ったものは読んだら消すので、画面を開いたときに 1 回だけ読む（開発中の React は effect を 2 回動かす）
let collecting: Promise<Received> | null = null;

export function ShareReceiver({ projects, fromServer }: { projects: { id: string; name: string }[]; fromServer: SharedPayload | null }) {
  const router = useRouter();
  const [received, setReceived] = useState<Received | null>(null);
  const [lastProject, setLastProject] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    collecting ??= collect(fromServer).finally(() => setTimeout(() => (collecting = null), 1000));
    void collecting.then((r) => {
      if (!alive) return;
      const last = storage("local")?.getItem(LAST_PROJECT_KEY) ?? undefined;
      setLastProject(projects.some((p) => p.id === last) ? last : undefined);
      setReceived(r);
    });
    return () => {
      alive = false;
    };
  }, [fromServer, projects]);

  if (projects.length === 0) {
    return (
      <p className="text-[14px] leading-[1.8]">
        メモはプロジェクトごとに残します。先に{" "}
        <Link href="/projects/new" className="font-semibold text-primary hover:underline">
          プロジェクトをつくる
        </Link>
        と、ここから残せます。
      </p>
    );
  }
  if (!received) return <p className="text-sm text-muted">受け取ったものを読んでいます…</p>;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 max-sm:p-4">
      <NoteForm
        projects={projects}
        // 前に残したプロジェクトを最初に選んでおく（変えられる）
        key={lastProject ?? "none"}
        projectId={undefined}
        initialProjectId={lastProject}
        initialBody={received.text}
        initialFile={received.file}
        notice={received.notice ?? "思いついたことを書き足してから保存できます。あとで AI が投稿のネタにします。"}
        onSaved={(projectId) => {
          storage("local")?.setItem(LAST_PROJECT_KEY, projectId);
          router.push(`/projects/${projectId}/notes?done=saved`);
        }}
        onCancel={() => router.push("/projects")}
      />
    </div>
  );
}
