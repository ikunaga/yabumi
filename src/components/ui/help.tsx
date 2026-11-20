"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "./term";

const noopSubscribe = () => () => {};

// 「?」を押すと出る短い説明（説明を画面に並べずに畳む。2026-10-30 オーナーの決定）。
// 用語の解説は <Term />（点線）、長い説明や手順は <DisclosureBox />（ui/disclosure.tsx の開く欄）を使う。
// 見出し（h2）や段落（p）の中にも置けるよう、押すところは button、説明は body 直下に出す（Term と同じ。
// details や div を見出し・段落の中に入れると HTML の入れ子の決まりに反し、hydration のエラーになる）。
// PC は「?」のそばに暗いポップアップ、スマホは下からシート。Esc と外側のクリックで閉じる（ブラウザ標準の popover）
export function HelpTip({ label = "説明", children }: { label?: string; children: ReactNode; align?: "left" | "right" }) {
  const id = `help-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    const pop = popRef.current;
    const button = buttonRef.current;
    if (!pop || !button) return;
    const place = () => placePopover(pop, button);
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) place();
    };
    pop.addEventListener("toggle", onToggle);
    window.addEventListener("resize", place);
    return () => {
      pop.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", place);
    };
  }, [mounted]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={id}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-input align-middle text-[11px] leading-none font-bold text-muted hover:border-muted hover:text-fg"
      >
        <span aria-hidden>?</span>
        <span className="sr-only">{label}を見る</span>
      </button>
      {mounted &&
        createPortal(
          <div
            ref={popRef}
            id={id}
            popover="auto"
            role="dialog"
            aria-label={label}
            className={[
              "m-0 text-left font-normal",
              // PC: 「?」のそばに出る暗いポップアップ
              "sm:fixed sm:w-80 sm:rounded-lg sm:bg-pop sm:px-[18px] sm:py-4 sm:text-[13px] sm:leading-[1.75] sm:text-on-pop sm:shadow-pop sm:backdrop:bg-transparent",
              // スマホ: 下から出るシート
              "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-t-sheet max-sm:bg-surface max-sm:px-5 max-sm:pt-3 max-sm:pb-8 max-sm:text-[15px] max-sm:leading-[1.8] max-sm:text-fg",
              "max-sm:backdrop:bg-scrim max-sm:transition-[translate,display,overlay] max-sm:transition-discrete max-sm:duration-200 max-sm:ease-out max-sm:starting:open:translate-y-full",
            ].join(" ")}
          >
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border sm:hidden" />
            {children}
            <button
              type="button"
              popoverTarget={id}
              popoverTargetAction="hide"
              className="mt-4 hidden h-12 w-full items-center justify-center rounded-md border border-input text-base font-semibold max-sm:flex"
            >
              閉じる
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
