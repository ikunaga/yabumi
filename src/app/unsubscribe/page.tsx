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
  // k=auto は自動投稿の知らせのメール（src/lib/auto-post/mail.ts）。止めるのはその種類のメールだけ
  const auto = sp.k === "auto";
  const what = auto ? "自動投稿のメール" : "投稿のペースを知らせるメール";
  const detail = auto ? "確認が要るとき・下書きに残したとき・止まったときのメールです。" : "遅れそうなときと、毎週の振り返りのメールです。";
  const settings = (
    <Link href="/settings/notifications" className="font-semibold text-fg underline">
      お知らせの設定
    </Link>
  );
  return (
    <PublicFrame>
      {sp.done === "1" ? (
        <PublicCard title={auto ? "自動投稿のメールを止めました" : "お知らせのメールを止めました"}>
          <p>
            {what}は、もう届きません。{detail}
          </p>
          <p className="text-muted">スマホの通知と、yabumi の画面に出るお知らせはそのままです。また受け取るときは、ログインして「{settings}」で戻せます。</p>
        </PublicCard>
      ) : sp.done === "0" || !token ? (
        <PublicCard title="リンクが正しくないか、古くなっています">
          <p>ログインして{settings}から止めてください。</p>
        </PublicCard>
      ) : (
        <form action={unsubscribeAction} className="flex w-full justify-center">
          <input type="hidden" name="t" value={token} />
          {auto && <input type="hidden" name="k" value="auto" />}
          <PublicCard title={auto ? "自動投稿のメールを止める" : "yabumi のお知らせのメールを止める"} actions={<SubmitButton variant="primary" pendingText="止めています…">{auto ? "自動投稿のメールを止める" : "メールを止める"}</SubmitButton>}>
            <p>
              {what}を止めます。{detail}
            </p>
            <p className="text-muted">スマホの通知と、yabumi の画面に出るお知らせはそのままです。</p>
          </PublicCard>
        </form>
      )}
    </PublicFrame>
  );
}
