import Link from "next/link";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { logout } from "@/lib/auth/actions";

// PC の上の帯の右端の「アカウント」。メールアドレスの頭文字の丸を押すと、ダークの切り替え・ログインと退会・ログアウトが開く
export function AccountMenu({ email }: { email: string }) {
  const initial = (email.trim()[0] ?? "?").toUpperCase();
  return (
    <DismissableDetails className="group relative shrink-0">
      <summary
        className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-surface text-[14px] font-bold text-fg hover:border-input [&::-webkit-details-marker]:hidden"
        title={email}
      >
        <span aria-hidden>{initial}</span>
        <span className="sr-only">アカウント（{email}）</span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm text-fg shadow-pop">
        <p className="truncate border-b border-line px-4 pt-2 pb-2.5 text-xs text-muted">{email}</p>
        <ThemeToggle tone="menu" />
        <Link href="/settings" className="block px-4 py-3 hover:bg-subtle hover:no-underline">
          ログインと退会
        </Link>
        <form action={logout}>
          <button type="submit" className="block w-full px-4 py-3 text-left hover:bg-subtle">
            ログアウト
          </button>
        </form>
      </div>
    </DismissableDetails>
  );
}
