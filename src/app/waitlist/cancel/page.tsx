import type { Metadata } from "next";
import { PublicCard, PublicFrame } from "@/components/public/public-frame";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cancelAction } from "@/lib/waitlist/actions";

export const metadata: Metadata = { title: "招待の申し込みを取り消す", robots: { index: false } };

// 確認のメールの「申し込みを取り消す」のリンクの先（docs/architecture.md の 4.29）。ログインしなくても取り消せる。
// メールのリンクを開いただけでは消さない（メールの安全確認の仕組みがリンクを先に開くことがあるため）。ボタンを押すと消す
export default async function WaitlistCancelPage(props: PageProps<"/waitlist/cancel">) {
  const sp = await props.searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const top = (
    <Link href="/" className="text-[14px] text-muted underline hover:text-fg">
      矢書のトップへ
    </Link>
  );
  return (
    <PublicFrame>
      {sp.done === "1" ? (
        <PublicCard title="招待の申し込みを取り消しました" actions={top}>
          <p>お預かりしたメールアドレスと一言は消しました。招待のメールは届きません。</p>
        </PublicCard>
      ) : sp.done === "0" || !token ? (
        <PublicCard title="リンクが正しくないか、すでに取り消し済み・招待済みです" actions={top}>
          <p>
            わからないことがあれば、
            <Link href="/privacy" className="font-semibold text-fg underline">
              プライバシーポリシー
            </Link>
            の問い合わせ先にご連絡ください。
          </p>
        </PublicCard>
      ) : (
        <form action={cancelAction} className="flex w-full justify-center">
          <input type="hidden" name="t" value={token} />
          <PublicCard
            title="矢書の招待の申し込みを取り消す"
            actions={
              <>
                <Button type="submit">申し込みを取り消す</Button>
                {top}
              </>
            }
          >
            <p>お預かりしたメールアドレスと一言をすぐに消し、招待のメールは届かなくなります。</p>
          </PublicCard>
        </form>
      )}
    </PublicFrame>
  );
}
