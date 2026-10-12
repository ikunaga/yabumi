import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cancelAction } from "@/lib/waitlist/actions";

export const metadata: Metadata = { title: "招待の申し込みを取り消す", robots: { index: false } };

// 確認のメールの「申し込みを取り消す」のリンクの先（docs/architecture.md の 4.29）。ログインしなくても取り消せる。
// メールのリンクを開いただけでは消さない（メールの安全確認の仕組みがリンクを先に開くことがあるため）。ボタンを押すと消す
export default async function WaitlistCancelPage(props: PageProps<"/waitlist/cancel">) {
  const sp = await props.searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-5 bg-bg px-4 py-12">
      <h1 className="font-heading text-2xl font-bold">矢書の招待の申し込みを取り消す</h1>
      {sp.done === "1" ? (
        <p className="text-[14px] leading-[1.8]">取り消しました。お預かりしたメールアドレスと一言は消しました。招待のメールは届きません。</p>
      ) : sp.done === "0" || !token ? (
        <p className="text-[14px] leading-[1.8]">
          リンクが正しくないか、すでに取り消し済み・招待済みです。わからないことがあれば、
          <Link href="/privacy" className="font-semibold text-primary hover:underline">
            プライバシーポリシー
          </Link>
          の問い合わせ先にご連絡ください。
        </p>
      ) : (
        <form action={cancelAction} className="flex flex-col items-start gap-4">
          <input type="hidden" name="t" value={token} />
          <p className="text-[14px] leading-[1.8]">招待の申し込みを取り消します。お預かりしたメールアドレスと一言をすぐに消し、招待のメールは届かなくなります。</p>
          <Button type="submit">申し込みを取り消す</Button>
        </form>
      )}
      <Link href="/" className="text-[14px] font-semibold text-primary hover:underline">
        矢書のトップへ
      </Link>
    </main>
  );
}
