"use client";

import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useRef } from "react";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { activeNavKey, type ProjectNavItem, type ProjectNavKey, projectNavItems } from "./project-nav-items";

// プロジェクト内のメニュー。開いている画面を URL から判定して選択中にする。
// bar: PC の上の横並び（5 つ ＋「…」その他）。tabs: スマホの下のタブ（5 つ）
export function ProjectNavLinks({ projectId, variant }: { projectId: string; variant: "bar" | "tabs" }) {
  const active = activeNavKey(useSelectedLayoutSegment());
  const items = projectNavItems(projectId);
  const main = items.filter((i) => i.main);

  if (variant === "bar") {
    return (
      <ul className="flex items-center gap-1.5 text-[18px] font-semibold max-xl:text-[16px] max-lg:text-[15px]">
        {main.map((item) => (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                aria-current={item.key === active ? "page" : undefined}
                className="block rounded-md px-3 py-1.5 whitespace-nowrap text-muted hover:bg-nav-active hover:text-fg hover:no-underline aria-[current=page]:font-bold aria-[current=page]:text-fg max-lg:px-2"
              >
                {item.label}
              </Link>
            ) : (
              <span className="block px-3 py-1.5 whitespace-nowrap text-faint" aria-disabled="true" title="準備中">
                {item.label}
              </span>
            )}
          </li>
        ))}
        <li>
          <MoreMenu items={items.filter((i) => !i.main)} active={active} />
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
function MoreMenu({ items, active }: { items: ProjectNavItem[]; active: ProjectNavKey }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // 画面を移ったら閉じる（上の帯は画面をまたいで残るため）
  useEffect(() => {
    const details = ref.current?.closest("details");
    if (details) details.open = false;
  }, [pathname]);

  // その他の画面を開いているときは、「…」の代わりにその名前を出す（どこにいるか分かるように）
  const current = items.find((i) => i.key === active);
  return (
    <DismissableDetails className="group relative">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-1.5 whitespace-nowrap hover:bg-nav-active hover:text-fg max-lg:px-2 [&::-webkit-details-marker]:hidden ${current ? "font-bold text-fg" : "text-muted"}`}
      >
        {current ? current.label : <span aria-hidden>その他</span>}
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
        <span className="sr-only">（そのほかの画面）</span>
      </summary>
      <div ref={ref} className="absolute left-0 z-20 mt-1.5 w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm text-fg shadow-pop">
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              {item.href ? (
                <Link
                  href={item.href}
                  aria-current={item.key === active ? "page" : undefined}
                  className="block px-4 py-2.5 hover:bg-subtle hover:no-underline aria-[current=page]:font-bold"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="flex items-center justify-between px-4 py-2.5 text-faint" aria-disabled="true">
                  {item.label}
                  <span className="text-[11px]">準備中</span>
                </span>
              )}
            </li>
          ))}
        </ul>
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
