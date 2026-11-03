"use client";

import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { activeNavKey, GLOSSARY_NAV, type NavActive, type ProjectNavItem, type ProjectNavKey, projectNavItems } from "./project-nav-items";

// プロジェクト内のメニュー。開いている画面を URL から判定して選択中にする。
// bar: PC の上の横並び（5 つ ＋「…」その他）。tabs: スマホの下のタブ（5 つ）
// glossary: 用語集を開いている（プロジェクトの中から開いた用語集。More の中の Glossary を選んだ印にし、ほかは選ばない）
export function ProjectNavLinks({ projectId, variant, glossary = false }: { projectId: string; variant: "bar" | "tabs"; glossary?: boolean }) {
  const segment = useSelectedLayoutSegment();
  const current: NavActive = glossary ? "glossary" : activeNavKey(segment);
  // 押した瞬間に選んでいる印を移す（次の画面ができるのを待たない。押した感覚を返すため）。URL が変わったら URL のほうに戻す
  const pathname = usePathname();
  const [pending, setPending] = useState<{ key: NavActive; from: string } | null>(null);
  const active = pending && pending.from === pathname ? pending.key : current;
  const press = (key: NavActive) => (e: MouseEvent) => {
    // 新しいタブで開く押し方（⌘・Ctrl・Shift・中ボタン）では、この画面は変わらないので印も動かさない
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    setPending({ key, from: pathname });
  };
  const items = projectNavItems(projectId);
  const main = items.filter((i) => i.main);

  if (variant === "bar") {
    return (
      <ul className="flex items-center gap-1.5 text-[16px] font-semibold max-xl:text-[15px] max-lg:text-[14px]">
        {main.map((item) => (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                onClick={press(item.key)}
                aria-current={item.key === active ? "page" : undefined}
                title={item.label}
                className="block rounded-md px-3 py-1.5 whitespace-nowrap text-muted hover:bg-nav-active hover:text-fg hover:no-underline aria-[current=page]:font-bold aria-[current=page]:text-fg max-lg:px-2"
              >
                {item.barLabel}
              </Link>
            ) : (
              <span className="block px-3 py-1.5 whitespace-nowrap text-faint" aria-disabled="true" title="準備中">
                {item.barLabel}
              </span>
            )}
          </li>
        ))}
        <li>
          <MoreMenu items={items.filter((i) => !i.main)} active={active} onPress={press} />
        </li>
      </ul>
    );
  }

  return (
    <ul className="grid h-[72px] grid-cols-5 text-[11px] text-muted">
      {main.map((item) => (
        <li key={item.key} className="flex">
          {item.href ? (
            <Link
              href={item.href}
              onClick={press(item.key)}
              aria-current={item.key === active ? "page" : undefined}
              className="flex flex-1 flex-col items-center justify-center gap-1 leading-none hover:no-underline aria-[current=page]:font-bold aria-[current=page]:text-fg"
            >
              <NavIcon k={item.key} />
              {item.tabLabel}
            </Link>
          ) : (
            <span className="flex flex-1 flex-col items-center justify-center gap-1 leading-none text-faint" aria-disabled="true">
              <NavIcon k={item.key} />
              準備中
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// 「…」（その他）。5 つに入らない画面（アカウント設計・ネタ帳・短縮リンク・ロードマップ）
function MoreMenu({ items, active, onPress }: { items: ProjectNavItem[]; active: NavActive; onPress: (key: NavActive) => (e: MouseEvent) => void }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // 画面を移ったら閉じる（上の帯は画面をまたいで残るため）
  useEffect(() => {
    const details = ref.current?.closest("details");
    if (details) details.open = false;
  }, [pathname]);

  // その他の画面を開いているときは、「…」の代わりにその名前を出す（どこにいるか分かるように）
  const current = active === "glossary" ? GLOSSARY_NAV : items.find((i) => i.key === active);
  return (
    <DismissableDetails className="group relative">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-1.5 whitespace-nowrap hover:bg-nav-active hover:text-fg max-lg:px-2 [&::-webkit-details-marker]:hidden ${current ? "font-bold text-fg" : "text-muted"}`}
      >
        {current ? current.barLabel : <span aria-hidden>More</span>}
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
        <span className="sr-only">（そのほかの画面）</span>
      </summary>
      <div ref={ref} className="absolute left-0 z-20 mt-1.5 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm text-fg shadow-pop">
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              {item.href ? (
                <Link
                  href={item.href}
                  onClick={onPress(item.key)}
                  aria-current={item.key === active ? "page" : undefined}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-subtle hover:no-underline aria-[current=page]:font-bold"
                >
                  {item.barLabel}
                  <span className="text-[12px] font-normal text-muted">{item.label}</span>
                </Link>
              ) : (
                <span className="flex items-center justify-between px-4 py-2.5 text-faint" aria-disabled="true">
                  {item.barLabel}
                  <span className="text-[11px]">準備中</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {/* プロジェクトの外の画面（用語集）。区切ってから置く */}
        <div className="mt-1 border-t border-line pt-1">
          <Link
            href={GLOSSARY_NAV.href}
            onClick={onPress("glossary")}
            aria-current={active === "glossary" ? "page" : undefined}
            className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-subtle hover:no-underline aria-[current=page]:font-bold"
          >
            {GLOSSARY_NAV.barLabel}
            <span className="text-[12px] font-normal text-muted">{GLOSSARY_NAV.label}</span>
          </Link>
        </div>
      </div>
    </DismissableDetails>
  );
}

// 下のタブの印。線だけの簡単な形（文字が主で、印は補い）
function NavIcon({ k }: { k: ProjectNavKey }) {
  const common = {
    "aria-hidden": true,
    viewBox: "0 0 20 20",
    className: "size-5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  switch (k) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="6" height="6" rx="1.5" />
          <rect x="11" y="3" width="6" height="6" rx="1.5" />
          <rect x="3" y="11" width="6" height="6" rx="1.5" />
          <rect x="11" y="11" width="6" height="6" rx="1.5" />
        </svg>
      );
    case "compose":
      return (
        <svg {...common}>
          <path d="M4 16h3l8.5-8.5a2.1 2.1 0 0 0-3-3L4 13v3Z" />
          <path d="M11 6l3 3" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
          <path d="M3 8.5h14M7 2.5v4M13 2.5v4" />
        </svg>
      );
    case "metrics":
      return (
        <svg {...common}>
          <path d="M4.5 15.5V10M10 15.5V5M15.5 15.5v-7.5" />
        </svg>
      );
    case "consult":
      return (
        <svg {...common}>
          <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z" />
        </svg>
      );
    default:
      return null;
  }
}
