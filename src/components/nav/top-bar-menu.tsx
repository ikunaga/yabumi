import Link from "next/link";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { logout } from "@/lib/auth/actions";

// プロジェクトの外の上部バー（TopBar）の、スマホの「メニュー」。ログインと退会・ログアウトをまとめる
// （320px の幅で、ロゴ・ダーク・メニューを 1 行に収めるため。PC ではメールアドレスとログアウトを並べる）
export function TopBarMenu({ email }: { email: string }) {
  return (
    <DismissableDetails className="group relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm whitespace-nowrap text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <span aria-hidden>≡</span>
        メニュー
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm text-fg shadow-pop">
        <Link href="/settings" className="block px-4 py-3 hover:bg-primary-soft hover:no-underline">
          ログインと退会
          <span className="block truncate text-xs text-muted">{email}</span>
        </Link>
        <form action={logout}>
          <button type="submit" className="block w-full px-4 py-3 text-left hover:bg-primary-soft">
            ログアウト
          </button>
        </form>
      </div>
    </DismissableDetails>
  );
}
