import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const firstSteps = ["アプリを登録して、アカウントを設計する", "投稿先の SNS をつなぐ", "最初の投稿を予約する"];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid flex-1 grid-cols-2 max-md:grid-cols-1">
      <aside className="flex flex-col justify-between bg-nav px-16 py-12 text-nav-fg max-lg:px-10 max-md:hidden">
        <Brand tone="nav" size="lg" />
        <div className="flex flex-col gap-5">
          <p className="font-heading text-[34px] leading-[1.5] font-bold text-nav-strong">
            登録したら、
            <br />
            最初にやることは 3 つだけ。
          </p>
          <ol className="border-t border-nav-active text-base">
            {firstSteps.map((s, i) => (
              <li key={s} className="flex gap-3.5 border-b border-nav-active py-3.5 last:border-b-0">
                <span className="font-bold text-nav-strong">{i + 1}</span>
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
          <div className="md:hidden">
            <Brand size="sm" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
