import type { Metadata } from "next";
import { PublicCard, PublicFrame } from "@/components/public/public-frame";
import Link from "next/link";
import { unsubscribeAction } from "./actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = { title: "お知らせのメールを止める", robots: { index: false } };

// メールの「このお知らせのメールを止める」のリンクの先（docs/architecture.md の 4.27）。ログインしなくても止められる。
// メールのリンクを開いただけでは止めない（メールの安全確認の仕組みがリンクを先に開くことがあるため）。ボタンを押すと止める。
// メールソフトの「配信停止」のボタンは /api/unsubscribe に POST して、すぐに止まる
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const sp = await props.searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const settings = (
    <Link href="/settings/notifications" className="font-semibold text-fg underline">
      お知らせの設定
    </Link>
  );
  return (
    <PublicFrame>
      {sp.done === "1" ? (
        <PublicCard title="お知らせのメールを止めました">
          <p>伴走のお知らせのメール（遅れそうなとき・毎週の振り返り）は、もう届きません。</p>
          <p className="text-muted">スマホの通知と、yabumi の画面の声かけはそのままです。また受け取りたくなったら、ログインして{settings}から戻せます。</p>
        </PublicCard>
      ) : sp.done === "0" || !token ? (
        <PublicCard title="リンクが正しくないか、古くなっています">
          <p>ログインして{settings}から止めてください。</p>
        </PublicCard>
      ) : (
        <form action={unsubscribeAction} className="flex w-full justify-center">
          <input type="hidden" name="t" value={token} />
          <PublicCard title="yabumi のお知らせのメールを止める" actions={<SubmitButton variant="primary" pendingText="止めています…">メールを止める</SubmitButton>}>
            <p>伴走のお知らせのメール（遅れそうなとき・毎週の振り返り）を止めます。</p>
            <p className="text-muted">スマホの通知と、yabumi の画面の声かけはそのままです。</p>
          </PublicCard>
        </form>
      )}
    </PublicFrame>
  );
}
