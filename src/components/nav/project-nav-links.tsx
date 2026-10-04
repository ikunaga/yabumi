"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { activeNavKey, projectNavItems } from "./project-nav-items";

// プロジェクト内のメニュー。開いている画面を URL から判定して選択中にする
export function ProjectNavLinks({ projectId, variant }: { projectId: string; variant: "sidebar" | "tabs" }) {
  const active = activeNavKey(useSelectedLayoutSegment());
  const items = projectNavItems(projectId);

  if (variant === "sidebar") {
    return (
      <ul className="flex flex-col gap-0.5 text-[14px]">
        {items.map((item) => (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                aria-current={item.key === active ? "page" : undefined}
                className="block rounded-md px-3 py-2.5 hover:bg-nav-active hover:text-nav-strong hover:no-underline aria-[current=page]:bg-nav-active aria-[current=page]:font-bold aria-[current=page]:text-nav-strong"
              >
                {item.label}
              </Link>
            ) : (
              <span className="flex items-center justify-between px-3 py-2.5 opacity-55" aria-disabled="true">
                {item.label}
                <span className="text-[11px]">準備中</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid h-[72px] grid-cols-5 text-[11px] text-muted">
      {items
        .filter((i) => i.tab)
        .map((item) => (
          <li key={item.key} className="flex">
            {item.href ? (
              <Link
                href={item.href}
                aria-current={item.key === active ? "page" : undefined}
                className="flex flex-1 items-center justify-center border-t-2 border-transparent aria-[current=page]:border-primary aria-[current=page]:font-bold aria-[current=page]:text-primary"
              >
                {item.tabLabel}
              </Link>
            ) : (
              <span className="flex flex-1 flex-col items-center justify-center leading-tight opacity-55" aria-disabled="true">
                {item.tabLabel}
                <span className="text-[9px]">準備中</span>
              </span>
            )}
          </li>
        ))}
    </ul>
  );
}
