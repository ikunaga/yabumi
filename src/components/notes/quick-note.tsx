"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { type MouseEvent, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { IMAGE_SKIPPED_MESSAGE, NOTE_DRAFT_EVENT, readDraft } from "@/lib/notes/draft";
import { NoteForm } from "./note-form";

type Project = { id: string; name: string };

const TRIGGER: Record<"topbar" | "fab" | "fabFree" | "menu", string> = {
  // PC の上の帯（プロジェクトの中と外）。スマホは上の帯が狭いので、右下に浮かせる（fab・fabFree）
  topbar: "inline-flex h-10 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-4 text-[15px] font-semibold whitespace-nowrap text-fg hover:border-input max-sm:hidden",
  fabFree: "fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+20px)] z-10 inline-flex h-12 items-center gap-1 rounded-full bg-primary px-5 text-base font-bold text-on-primary shadow-pop hover:bg-primary-hover sm:hidden",
  // スマホ: 下のタブの上に浮かぶボタン（親指で届く右下）
  fab: "fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom)+14px)] z-10 inline-flex h-12 items-center gap-1 rounded-full bg-primary px-5 text-base font-bold text-on-primary shadow-pop hover:bg-primary-hover sm:hidden",
  // スマホの ≡ メニューの中
  menu: "block w-full px-4 py-3 text-left font-semibold hover:bg-subtle",
};

// どの画面からでも押せる「＋ メモ」（ネタ帳。docs/architecture.md の 4.26）。押すと書く欄が開き、保存したらすぐ閉じて知らせる
export function QuickNote({ projects, projectId, variant }: { projects: Project[]; projectId?: string; variant: keyof typeof TRIGGER }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  // 開くたびに書く欄を作り直す
  const [round, setRound] = useState(0);
  // 保存したプロジェクトと、知らせの文
  const [saved, setSaved] = useState<{ projectId: string; message: string } | null>(null);
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

  // 保存できたら、必ず「ネタ帳に残しました」を出す（画像を添えられなかったときは、そのことも。少し長く出す）
  function done(savedProjectId: string, { imageSkipped }: { imageSkipped: boolean }) {
    close();
    setSaved({ projectId: savedProjectId, message: imageSkipped ? IMAGE_SKIPPED_MESSAGE : "ネタ帳に残しました" });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(null), imageSkipped ? 10000 : 5000);
  }

  // 書く欄と知らせは body 直下に出す（≡ メニューの中から開いても、メニューが閉じて隠れないように）
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // 保存していない書きかけがあるか（ボタンに印を出す）
  const hasDraft = useSyncExternalStore(subscribeDraft, () => readDraft() !== null, () => false);

  if (projects.length === 0) return null;

  return (
    <>
      <button type="button" onClick={show} className={variant === "topbar" ? `${TRIGGER[variant]} relative` : TRIGGER[variant]} aria-haspopup="dialog">
        <span aria-hidden>＋</span> メモ
        {hasDraft && (
          <>
            <span aria-hidden className={`size-2 rounded-full bg-signal ${variant === "menu" ? "ml-1.5 inline-block align-middle" : "absolute -top-0.5 -right-0.5 ring-2 ring-surface"}`} />
            <span className="sr-only">（保存していないメモがあります）</span>
          </>
        )}
      </button>

      {mounted &&
        createPortal(
          <>
            <dialog
              ref={dialogRef}
              aria-labelledby={titleId}
              onClose={() => {
                // close の知らせは後から届く。閉じてすぐ開き直したときに、開いている書く欄を消さない
                if (!dialogRef.current?.open) setOpen(false);
              }}
              onClick={(e) => {
                // 外側（背景）を押したら閉じる。書きかけがあるときは閉じない（スマホでキーボードを閉じようと外側を押して、閉じてしまわないように）
                if (e.target === e.currentTarget && !readDraft()) close();
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
                <span className="font-semibold">{saved.message}</span>
                <Link href={`/projects/${saved.projectId}/notes`} className="shrink-0 font-semibold text-pop-link underline" onClick={() => setSaved(null)}>
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

// 控えが変わったとき（同じ画面の書く欄・ほかのタブ）
function subscribeDraft(onChange: () => void) {
  window.addEventListener(NOTE_DRAFT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NOTE_DRAFT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// スマホの浮かぶ「＋ メモ」。下に操作の帯がある画面（投稿をつくる・AI と相談・AI と考える）では、帯のボタンと重なるので出さない（≡ メニューから開ける）
export function QuickNoteFab({ projects, projectId }: { projects: Project[]; projectId: string }) {
  const segments = useSelectedLayoutSegments();
  const [first, second] = segments;
  if (first === "compose" || first === "posts" || first === "consult" || (first === "plan" && second === "chat")) return null;
  return <QuickNote projects={projects} projectId={projectId} variant="fab" />;
}
