"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { sharedText } from "@/lib/notes/rules";
import { mergeShared, readDraft, writeDraft } from "@/lib/notes/draft";
import { SHARE_CACHE, SHARE_CACHE_IMAGE, SHARE_CACHE_TEXT, textFromHash, type SharedPayload } from "@/lib/notes/share";
import { NoteForm } from "./note-form";

// 前にメモを残したプロジェクト（次に共有したときの最初の選択）
const LAST_PROJECT_KEY = "yabumi-note-project";

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

// ログインしていないとき: # のあとの本文を書きかけの控え（localStorage）に足してから、ログインへ送る。
// sessionStorage はタブごとなので、メールのリンクでログインして別のタブで開くと消える。service worker が置いたものはブラウザに残っている
export function ShareStash() {
  useEffect(() => {
    const text = window.location.hash ? textFromHash(window.location.hash) : "";
    if (text) {
      const draft = readDraft();
      writeDraft(mergeShared(draft?.body ?? "", text), draft?.projectId ?? null);
    }
    window.location.replace("/login?next=/share");
  }, []);
  return <p className="p-6 text-sm text-muted">ログインの画面に移ります…</p>;
}

type Received = { text: string; projectId: string | null; file: File | null; notice: string | null; restored: boolean };

// 受け取ったものを集める: service worker が置いたもの → # のあと（ショートカット・ブックマークレット）→ サーバーが受けたもの（cookie）。
// 本文は書きかけの控え（src/lib/notes/draft.ts）に足してから、受け取った場所から消す（保存しないまま閉じても、次に開いたときに戻る）。
// 画像は控えに入らないので、保存するか捨てるまで Cache Storage に残す（discardSharedImage）
async function collect(fromServer: SharedPayload | null): Promise<Received> {
  let text = "";
  let file: File | null = null;
  let notice: string | null = null;
  if ("caches" in window) {
    try {
      const cache = await caches.open(SHARE_CACHE);
      // 1 日より前に受けて残したままのものは使わずに消す
      const fresh = (at: number | undefined) => Boolean(at && Date.now() - at < 86_400_000);
      const t = await cache.match(SHARE_CACHE_TEXT);
      let textAt: number | undefined;
      if (t) {
        const v = (await t.json()) as { title?: string; text?: string; url?: string; at?: number };
        textAt = v.at;
        if (fresh(v.at)) text = sharedText(v);
      }
      const img = await cache.match(SHARE_CACHE_IMAGE);
      if (img) {
        // 受けた時刻は画像にも付ける（本文を控えに移して消したあとも、保存するまで画像を戻せるように）。付いていない古い形は本文の時刻で見る
        const imgAt = Number(img.headers.get("X-At")) || textAt;
        if (fresh(imgAt)) {
          const blob = await img.blob();
          const name = decodeURIComponent(img.headers.get("X-File-Name") ?? "image");
          // 大きい画像は、上げる前に JPEG に縮める（4.18）。service worker が 20MB を超えるものは受けない
          file = new File([blob], name, { type: blob.type });
        } else {
          await cache.delete(SHARE_CACHE_IMAGE);
        }
      }
      if (text) {
        const draft = readDraft();
        writeDraft(mergeShared(draft?.body ?? "", text), draft?.projectId ?? null);
      }
      await cache.delete(SHARE_CACHE_TEXT);
    } catch {
      // 読めなければ、ほかの受け取り方を見る
    }
  }
  if (window.location.hash) {
    const fromHash = textFromHash(window.location.hash);
    history.replaceState(null, "", window.location.pathname);
    if (!text && fromHash) {
      text = fromHash;
      const draft = readDraft();
      writeDraft(mergeShared(draft?.body ?? "", text), draft?.projectId ?? null);
    }
  }
  if (!text && !file && fromServer) {
    text = fromServer.text;
    const draft = readDraft();
    if (text) writeDraft(mergeShared(draft?.body ?? "", text), draft?.projectId ?? null);
    if (fromServer.hadFile) notice = "画像は受け取れませんでした。画像も残すときは、下の「写真・スクリーンショットを添える」から選んでください。";
  }
  // 前に保存しないまま閉じたもの（と、いま受け取ったもの）
  const draft = readDraft();
  if (draft && draft.body !== text) {
    notice = text ? "保存していないメモがあります。前に書きかけたものに、いま受け取ったものを足しました。" : "保存していないメモがあります。前に書きかけたものを戻しました。";
  }
  return { text: draft?.body ?? text, projectId: draft?.projectId ?? null, file, notice, restored: Boolean(draft && draft.body !== text) };
}

// 共有で受け取った画像を、保存したか捨てたあとに消す
async function discardSharedImage() {
  try {
    if ("caches" in window) await (await caches.open(SHARE_CACHE)).delete(SHARE_CACHE_IMAGE);
  } catch {
    // 消せなくても、1 日たてば使わない
  }
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
      const last = r.projectId ?? storage("local")?.getItem(LAST_PROJECT_KEY) ?? undefined;
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
        <Link href="/projects/new" className="font-semibold underline">
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
        notice={received.notice ?? "思いついたことを書き足してから保存できます。保存するまでは、この端末にだけ残っています。あとで AI が投稿のネタにします。"}
        noticeRestored={received.restored}
        onSaved={(projectId, { imageSkipped }) => {
          storage("local")?.setItem(LAST_PROJECT_KEY, projectId);
          void discardSharedImage();
          router.push(`/projects/${projectId}/notes?done=${imageSkipped ? "saved_no_image" : "saved"}`);
        }}
        onCancel={() => {
          void discardSharedImage();
          router.push("/projects");
        }}
      />
    </div>
  );
}
