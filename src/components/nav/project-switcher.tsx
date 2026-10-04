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
  variant: "sidebar" | "header";
}) {
  const summary =
    variant === "sidebar"
      ? "flex items-center justify-between gap-2 rounded-md border border-nav-active px-3 py-2.5 text-sm text-nav-strong hover:bg-nav-active"
      : "flex items-center gap-1 text-sm text-nav-fg hover:text-nav-strong";

  return (
    <DismissableDetails className="group relative">
      <summary className={`cursor-pointer list-none [&::-webkit-details-marker]:hidden ${summary}`}>
        <span className="truncate">{current.name}</span>
        <span aria-hidden className="text-xs transition-transform group-open:rotate-180">
          ▾
        </span>
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
                className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-primary-soft hover:no-underline aria-[current=page]:font-bold"
              >
                <span className="truncate">{p.name}</span>
                {p.id === current.id && <span className="text-primary">✓</span>}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-line pt-1">
          <Link href="/projects" className="block px-4 py-2.5 text-primary hover:bg-primary-soft">
            すべてのプロジェクト
          </Link>
          <Link href="/projects/new" className="block px-4 py-2.5 text-primary hover:bg-primary-soft">
            ＋ 新しいプロジェクト
          </Link>
        </div>
      </div>
    </DismissableDetails>
  );
}
