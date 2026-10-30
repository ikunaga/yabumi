import Link from "next/link";
import { DismissableDetails } from "@/components/ui/dismissable-details";

// プロジェクト切替。details で開閉し、外側クリックと Esc で閉じる
export function ProjectSwitcher({
  current,
  projects,
  variant,
}: {
  current: { id: string; name: string };
  projects: { id: string; name: string }[];
  variant: "bar" | "header";
}) {
  const summary =
    variant === "bar"
      ? "flex h-10 max-w-[15rem] min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-[15px] font-semibold text-fg hover:border-input max-lg:max-w-[9rem]"
      : "flex max-w-[12rem] min-w-0 items-center gap-1 text-sm text-nav-fg hover:text-nav-strong";

  return (
    <DismissableDetails className="group relative min-w-0">
      <summary className={`cursor-pointer list-none [&::-webkit-details-marker]:hidden ${summary}`}>
        <span className="truncate">{current.name}</span>
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
        <span className="sr-only">プロジェクトを切り替える</span>
      </summary>
      <div
        className={`absolute z-20 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm text-fg shadow-pop ${variant === "header" ? "right-0" : "left-0"}`}
      >
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                aria-current={p.id === current.id ? "page" : undefined}
                className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-subtle hover:no-underline aria-[current=page]:font-bold"
              >
                <span className="truncate">{p.name}</span>
                {p.id === current.id && <span>✓</span>}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-line pt-1">
          <Link href="/projects" className="block px-4 py-2.5 hover:bg-subtle">
            すべてのプロジェクト
          </Link>
          <Link href="/projects/new" className="block px-4 py-2.5 hover:bg-subtle">
            ＋ 新しいプロジェクト
          </Link>
        </div>
      </div>
    </DismissableDetails>
  );
}
