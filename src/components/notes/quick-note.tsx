"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { type MouseEvent, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { NoteForm } from "./note-form";

type Project = { id: string; name: string };

const TRIGGER: Record<"sidebar" | "topbar" | "fab" | "fabFree" | "menu", string> = {
  // PC のサイドバー（藍の地）
  sidebar: "flex w-full items-center justify-center gap-1.5 rounded-md border border-nav-active px-3 py-2 text-sm font-semibold text-nav-strong hover:bg-nav-active",
  // プロジェクトの外の上部バー（PC）。スマホは上部バーが狭いので、右下に浮かせる（fabFree）
  topbar: "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-primary px-3 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary-soft max-sm:hidden",
  fabFree: "fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+20px)] z-10 inline-flex h-12 items-center gap-1 rounded-full bg-primary px-5 text-base font-bold text-on-primary shadow-pop hover:bg-primary-hover sm:hidden",
  // スマホ: 下のタブの上に浮かぶボタン（親指で届く右下）
  fab: "fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom)+14px)] z-10 inline-flex h-12 items-center gap-1 rounded-full bg-primary px-5 text-base font-bold text-on-primary shadow-pop hover:bg-primary-hover sm:hidden",
  // スマホの ≡ メニューの中
  menu: "block w-full px-4 py-3 text-left font-semibold text-primary hover:bg-primary-soft",
};

// どの画面からでも押せる「＋ メモ」（ネタ帳。docs/architecture.md の 4.26）。押すと書く欄が開き、保存したらすぐ閉じて知らせる
export function QuickNote({ projects, projectId, variant }: { projects: Project[]; projectId?: string; variant: keyof typeof TRIGGER }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  // 開くたびに書く欄を作り直す
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function show(e: MouseEvent<HTMLButtonElement>) {
    // ≡ メニューの中から開いたら、メニューは閉じる
    e.currentTarget.closest("details")?.removeAttribute("open");
    setRound((r) => r + 1);
    setOpen(true);
    setSaved(null);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  function done(savedProjectId: string) {
    close();
    setSaved(savedProjectId);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(null), 5000);
  }

  // 書く欄と知らせは body 直下に出す（≡ メニューの中から開いても、メニューが閉じて隠れないように）
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  if (projects.length === 0) return null;

  return (
    <>
      <button type="button" onClick={show} className={TRIGGER[variant]} aria-haspopup="dialog">
        <span aria-hidden>＋</span> メモ
      </button>

      {mounted &&
        createPortal(
          <>
            <dialog
              ref={dialogRef}
              aria-labelledby={titleId}
              onClose={() => setOpen(false)}
              onClick={(e) => {
                // 外側（背景）を押したら閉じる
                if (e.target === e.currentTarget) close();
              }}
              className={[
                "m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-border bg-surface p-5 text-fg shadow-pop backdrop:bg-scrim",
                // スマホ: 上に寄せる（キーボードで隠れないように）
                "max-sm:mt-[max(1rem,env(safe-area-inset-top))] max-sm:mb-auto max-sm:p-4",
              ].join(" ")}
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id={titleId} className="text-base font-bold">
                  ネタ帳にメモを残す
                </h2>
                <span className="text-xs text-muted">あとで AI が投稿にします</span>
              </div>
              {open && <NoteForm key={round} projects={projects} projectId={projectId} onSaved={done} onCancel={close} />}
            </dialog>

            {saved && (
              <div
                role="status"
                className="fixed inset-x-4 bottom-[calc(72px+env(safe-area-inset-bottom)+14px)] z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-pop px-4 py-3 text-sm text-on-pop shadow-pop sm:bottom-6"
              >
                <span className="font-semibold">ネタ帳に残しました</span>
                <Link href={`/projects/${saved}/notes`} className="shrink-0 font-semibold text-pop-link underline" onClick={() => setSaved(null)}>
                  ネタ帳を開く
                </Link>
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}

const noopSubscribe = () => () => {};

// スマホの浮かぶ「＋ メモ」。下に操作の帯がある画面（投稿をつくる・AI と相談・AI と考える）では、帯のボタンと重なるので出さない（≡ メニューから開ける）
export function QuickNoteFab({ projects, projectId }: { projects: Project[]; projectId: string }) {
  const segments = useSelectedLayoutSegments();
  const [first, second] = segments;
  if (first === "compose" || first === "posts" || first === "consult" || (first === "plan" && second === "chat")) return null;
  return <QuickNote projects={projects} projectId={projectId} variant="fab" />;
}
