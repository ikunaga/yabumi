import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { unsubscribeAction } from "./actions";

export const metadata: Metadata = { title: "お知らせのメールを止める", robots: { index: false } };

// メールの「このお知らせのメールを止める」のリンクの先（docs/architecture.md の 4.27）。ログインしなくても止められる。
// メールのリンクを開いただけでは止めない（メールの安全確認の仕組みがリンクを先に開くことがあるため）。ボタンを押すと止める。
// メールソフトの「配信停止」のボタンは /api/unsubscribe に POST して、すぐに止まる
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const sp = await props.searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-5 bg-bg px-4 py-12">
      <h1 className="font-heading text-2xl font-bold">矢書のお知らせのメールを止める</h1>
      {sp.done === "1" ? (
        <>
          <p className="text-[14px] leading-[1.8]">止めました。伴走のお知らせのメール（遅れそうなとき・毎週の振り返り）は、もう届きません。</p>
          <p className="text-[14px] leading-[1.8] text-muted">
            スマホの通知と、矢書の画面の声かけはそのままです。また受け取りたくなったら、ログインして
            <Link href="/settings/notifications" className="font-semibold text-primary hover:underline">
              お知らせの設定
            </Link>
            から戻せます。
          </p>
        </>
      ) : sp.done === "0" || !token ? (
        <p className="text-[14px] leading-[1.8]">
          リンクが正しくないか、古くなっています。ログインして
          <Link href="/settings/notifications" className="font-semibold text-primary hover:underline">
            お知らせの設定
          </Link>
          から止めてください。
        </p>
      ) : (
        <form action={unsubscribeAction} className="flex flex-col items-start gap-4">
          <input type="hidden" name="t" value={token} />
          <p className="text-[14px] leading-[1.8]">伴走のお知らせのメール（遅れそうなとき・毎週の振り返り）を止めます。スマホの通知と、矢書の画面の声かけはそのままです。</p>
          <Button type="submit">メールを止める</Button>
        </form>
      )}
    </main>
  );
}
