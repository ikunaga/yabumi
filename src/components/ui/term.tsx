"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { glossary, termTitle, type GlossaryKey, type GlossaryTerm } from "@/lib/glossary/terms";

const POP_WIDTH = 320;
const GAP = 8;
const MARGIN = 16;
const DESKTOP_QUERY = "(min-width: 640px)";

const noopSubscribe = () => () => {};

// PC では用語の下（入らなければ上）に置く。スマホは CSS でシートにするので位置は付けない
function placePopover(pop: HTMLElement, button: HTMLElement) {
  if (!window.matchMedia(DESKTOP_QUERY).matches) {
    pop.style.removeProperty("top");
    pop.style.removeProperty("left");
    return;
  }
  const r = button.getBoundingClientRect();
  const left = Math.min(Math.max(r.left, MARGIN), window.innerWidth - POP_WIDTH - MARGIN);
  const below = r.bottom + GAP;
  const top =
    below + pop.offsetHeight > window.innerHeight - MARGIN ? Math.max(MARGIN, r.top - GAP - pop.offsetHeight) : below;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

// 用語に解説を添える（要求 F12）。PC は用語のそばにポップアップ、スマホは下からシートで開く。
// ブラウザ標準の popover を使うので、Esc と外側のクリックで閉じる。
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const id = `term-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const term: GlossaryTerm = glossary[k];
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // 解説は body 直下に出す。用語は label や p の中に置かれるので、その中に入れると
  // HTML の入れ子の決まりに反し、解説のクリックが入力欄へのフォーカスに化けるため
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
        className="cursor-help border-b-[1.5px] border-dotted border-primary leading-[1.3] text-fg hover:text-primary"
      >
        {children ?? term.label}
      </button>
      {mounted &&
        createPortal(
      <div
        ref={popRef}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={`${term.label} の説明`}
        className={[
          "m-0 text-left font-normal",
          // PC: 用語のそばに出る暗いポップアップ
          "sm:fixed sm:w-80 sm:rounded-lg sm:bg-pop sm:px-[18px] sm:py-4 sm:text-on-pop sm:shadow-pop sm:backdrop:bg-transparent",
          // スマホ: 下から出るシート
          "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-t-sheet max-sm:bg-surface max-sm:px-5 max-sm:pt-3 max-sm:pb-8 max-sm:text-fg",
          "max-sm:backdrop:bg-[rgb(15_20_30/0.45)] max-sm:transition-[translate,display,overlay] max-sm:transition-discrete max-sm:duration-200 max-sm:ease-out max-sm:starting:open:translate-y-full",
        ].join(" ")}
      >
        <TermBody k={k} term={term} popoverId={id} />
      </div>,
          document.body,
        )}
    </>
  );
}

function TermBody({ k, term, popoverId }: { k: GlossaryKey; term: GlossaryTerm; popoverId: string }) {
  const body = term.example ? `${term.summary}${term.example}` : term.summary;
  return (
    <div className="flex flex-col gap-2 max-sm:gap-3">
      <span aria-hidden className="h-1 w-10 self-center rounded-full bg-border sm:hidden" />
      <span className="flex items-start justify-between gap-3">
        <span className="text-base font-bold max-sm:text-[18px]">{termTitle(term)}</span>
        <button
          type="button"
          popoverTarget={popoverId}
          popoverTargetAction="hide"
          aria-label="閉じる"
          className="-mt-0.5 -mr-1 px-1 text-xs opacity-80 hover:opacity-100 max-sm:hidden"
        >
          ✕
        </button>
      </span>
      <span className="text-sm leading-[1.8] max-sm:text-base">{body}</span>
      <Link
        href={`/glossary#${k}`}
        className="text-xs text-pop-link hover:underline max-sm:mt-1 max-sm:flex max-sm:h-12 max-sm:items-center max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-primary max-sm:text-base max-sm:font-semibold max-sm:text-primary max-sm:hover:no-underline"
      >
        用語集で見る<span className="max-sm:hidden"> →</span>
      </Link>
    </div>
  );
}
