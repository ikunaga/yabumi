import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { STEPS } from "@/lib/projects/next-step";

// 概要の「いまやること」と同じ 4 段（src/lib/projects/next-step.ts）。最初の段の前に、宣伝したいもの（プロジェクト）を登録する
const firstSteps = STEPS.map((s, i) => (i === 0 ? `宣伝したいものを登録して、${s.title}` : s.title));

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid flex-1 grid-cols-2 max-md:grid-cols-1">
      <aside className="flex flex-col justify-between border-r border-border bg-surface px-16 py-12 text-muted max-lg:px-10 max-md:hidden">
        <Brand size="lg" />
        <div className="flex flex-col gap-5">
          <p className="font-heading text-[34px] leading-[1.5] font-bold text-fg">
            登録したら、
            <br />
            最初にやることは {firstSteps.length} つだけ。
          </p>
          <ol className="border-t border-border text-base">
            {firstSteps.map((s, i) => (
              <li key={s} className="flex items-center gap-3.5 border-b border-border py-3.5 last:border-b-0">
                <span className="num inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <p className="text-sm">あとからいつでも変えられます。</p>
      </aside>
      <main className="relative flex items-center justify-center px-5 py-12 max-md:items-start max-md:py-6">
        <div className="absolute top-6 right-6 max-md:top-6 max-md:right-5">
          <ThemeToggle />
        </div>
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <div className="flex md:hidden">
            <Brand size="sm" />
          </div>
          {children}
          <p className="mt-2 flex justify-center gap-5 text-xs text-muted">
            <Link href="/terms" className="hover:text-fg">
              利用規約
            </Link>
            <Link href="/privacy" className="hover:text-fg">
              プライバシーポリシー
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
