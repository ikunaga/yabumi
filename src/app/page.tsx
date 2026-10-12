import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Shot } from "@/components/lp/shot";
import { WaitlistForm } from "@/components/lp/waitlist-form";
import { buttonClass } from "@/components/ui/button";
import { SuccessBanner } from "@/components/ui/feedback";
import { Term } from "@/components/ui/term";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { createClient } from "@/lib/supabase/server";

// 矢書の LP（ログイン前のトップ。F19、決定 D30。docs/architecture.md の 4.29）。
// 新規登録は閉じている（D24 の ①）ので、興味を持った人は招待を申し込む（いまは招待制の無料の試用。D24 の ②）。
// ログイン済みの人はプロジェクトへ移る

const pains = [
  {
    pain: "ネタがない",
    answer: "思いついたらネタ帳へ。AI と一緒に投稿にする",
    body: "生活の中で思いついたことや、あったことを、どの画面からでも「＋ メモ」でさっと残せます。あとで AI が、メモやアプリの更新（GitHub）から投稿の案を出します。",
  },
  {
    pain: "時間がない",
    answer: "一度書けば、複数の SNS にまとめて予約",
    body: "1 つの文面を X・Threads・Instagram・Facebook ページに一度に予約。SNS ごとの字数や画像の決まりも確かめます。いつ何を出すかはカレンダーで一目でわかります。",
  },
  {
    pain: "何を見ればいいかわからない",
    answer: "追いかける数字を決めて、週ごとに振り返る",
    body: "投稿の閲覧から、ストアページ、ダウンロード、課金までをつなげて見られます。どの投稿から何人来たかは、SNS ごとの短縮リンクで数えます。",
  },
  {
    pain: "続かない",
    answer: "矢書が伴走して、遅れそうなら声をかける",
    body: "最初の 1 か月の目標を SNS ごとの週の回数にし、毎日ペースを見ます。遅れそうなときと毎週の振り返りを、画面・メール・スマホの通知でお知らせします。",
  },
];

const steps = [
  { title: "設計する", body: "AI と話しながら、誰に・何のために・どんな名前で・どんな投稿をするかを決めます。マーケティングの用語は、出てきたときに解説します。" },
  { title: "つなぐ", body: "使う SNS のアカウントをつなぎます。note・Substack は、文面を用意して手で投稿する形で使えます。" },
  { title: "投稿する", body: "ネタ帳や AI の案から下書きをつくり、AI っぽさをチェックして、まとめて予約します。" },
  { title: "振り返る", body: "数字を見ながら AI と相談し、ロードマップと次の週のやることを決めます。" },
];

type Feature = { name: string; title: string; body: string; shot?: { name: string; alt: string } };

const features: Feature[] = [
  { name: "compose", title: "投稿をつくる・まとめて予約", body: "1 つの文面を、選んだ SNS にまとめて予約。SNS ごとの字数・画像の数を確かめ、文面を SNS ごとに少し変えることもできます。", shot: { name: "compose", alt: "投稿をつくる画面。下書きと、送り先の SNS ごとの字数と状態" } },
  { name: "calendar", title: "カレンダー", body: "週と月の表示で、予約・投稿済み・下書きを一目で。空いている日から投稿をつくれます。", shot: { name: "calendar", alt: "カレンダーの週の表示。予約と投稿済みの印" } },
  { name: "notes", title: "ネタ帳と、AI とネタを出す", body: "思いついたことを写真 1 枚と一緒に残し、AI がメモやアプリの更新から投稿の案を出します。", shot: { name: "notes", alt: "ネタ帳の画面。まだ使っていないメモの一覧" } },
  { name: "metrics", title: "指標と振り返り", body: "閲覧からダウンロード・課金までを 1 枚で。数字の読み方と次の一手を、やさしい言葉で添えます。", shot: { name: "metrics", alt: "指標の画面。閲覧、ストアページ、ダウンロード、課金の数字" } },
  { name: "plan", title: "アカウント設計と AI と相談", body: "誰に向けて何を発信するかを、AI が質問しながら一緒に整理します。決めたことはロードマップの目標になります。", shot: { name: "plan", alt: "アカウント設計の画面。項目ごとの決めたこと" } },
  { name: "coach", title: "伴走", body: "今週あと何本出せば目標に届くかを、毎日見て声をかけます。", shot: { name: "coach", alt: "概要の画面。今週のペースと声かけ" } },
];

const moreFeatures = [
  { title: "AI っぽさチェック", body: "AI が書いたような言い回しを見つけ、理由と直し方を出します。" },
  { title: "画像をつくる", body: "文字のカード、図解、アプリの画面を使った画像を、テンプレートでつくれます。" },
  { title: "短縮リンク", body: "SNS ごとのリンクで、どこから何人来たかを数えます。自分のドメインでも作れます。" },
  { title: "ロードマップ", body: "目標と、週ごとにやることを並べて、進み具合を見られます。" },
  { title: "GitHub からの下書き", body: "リポジトリをつなぐと、アプリの紹介文や、更新を伝える投稿の案をつくります。" },
  { title: "ストアの数字", body: "App Store・Google Play・RevenueCat の数字を取り込み、投稿の効果と並べて見られます。" },
];

const sns = [
  { group: "矢書から自動で投稿", items: ["X", "Threads", "Instagram", "Facebook ページ"] },
  { group: "文面を用意して、手で投稿", items: ["note", "Substack"] },
  { group: "準備中", items: ["TikTok", "YouTube"] },
];

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: "費用はかかりますか？",
    a: "いまは招待制の試用で、無料です。AI などには 1 人あたりの月の上限があります。有料のプランを始めるときは、前もってお知らせします（無料のまま使える範囲も残す予定です）。",
  },
  {
    q: "AI には何を送りますか？",
    a: (
      <>
        AI（Anthropic の Claude）には、案や下書きをつくるのに要るものだけを送ります。たとえば、アプリの説明、アカウント設計の内容、投稿の下書き、ネタ帳で選んだメモの本文です。パスワードや SNS の鍵は送りません。Anthropic は、送られた内容を既定ではモデルの学習に使いません。くわしくは
        <Link href="/privacy" className="text-primary underline">
          プライバシーポリシー
        </Link>
        に書いています。
      </>
    ),
  },
  {
    q: "データはどう扱われますか？",
    a: "預かったデータは、矢書の機能のためだけに使い、広告に使ったり売ったりしません。データは自分で消せて、退会するとすぐに消えます。AI との会話は最後のやり取りから 1 年で自動で消します。",
  },
  {
    q: "どの SNS に対応していますか？",
    a: "X・Threads・Instagram（プロアカウント）・Facebook ページに、矢書から投稿・予約できます。note・Substack は文面を用意して、手で投稿する形です。TikTok・YouTube は準備中です。",
  },
  {
    q: "招待はいつ届きますか？",
    a: "いまは 10 人ほどで試していただいていて、申し込みの順に、少しずつ招待のメールをお送りします。時期はまだ決まっていません。申し込みは、確認のメールのリンクからいつでも取り消せます。",
  },
  {
    q: "マーケティングの知識がなくても使えますか？",
    a: "はい。矢書は、マーケティングがはじめての個人開発者を前提にしています。空欄を自分で埋めるのではなく、AI が質問しながら一緒に整理し、案と理由を出すので、選んでいけば進みます。",
  },
];

const section = "mx-auto w-full max-w-[1120px] px-10 max-lg:px-6 max-sm:px-4";
// 日本語を文節で折る（対応していないブラウザでは、ふつうの折り方になる）
const h2 = "font-heading text-[32px] leading-[1.4] font-bold [word-break:auto-phrase] max-sm:text-[24px]";

export default async function Home(props: PageProps<"/">) {
  const { done } = await props.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/projects");

  return (
    <div className="flex flex-1 flex-col">
      <header className={`${section} flex items-center gap-3 py-6 max-sm:py-4`}>
        <span className="flex max-sm:hidden">
          <Brand />
        </span>
        <span className="flex sm:hidden">
          <Brand size="sm" />
        </span>
        <nav className="ml-auto flex items-center gap-6 text-[14px] text-muted max-sm:gap-4">
          <a href="#features" className="hover:text-fg max-md:hidden">
            できること
          </a>
          <a href="#price" className="hover:text-fg max-md:hidden">
            料金
          </a>
          <a href="#faq" className="hover:text-fg max-md:hidden">
            よくある質問
          </a>
          <ThemeToggle />
          <Link href="/login" className="font-semibold text-primary hover:underline">
            ログイン
          </Link>
          <a href="#apply" className={`${buttonClass({ size: "sm" })} max-sm:hidden`}>
            招待を申し込む
          </a>
        </nav>
      </header>

      {done === "withdrawn" && (
        <div className={section}>
          <SuccessBanner>退会しました。保存していたデータは消しました。ご利用ありがとうございました。</SuccessBanner>
        </div>
      )}

      <main className="flex flex-col gap-24 pb-24 max-sm:gap-16 max-sm:pb-16">
        {/* 最初の画面 */}
        <section className={`${section} grid grid-cols-[minmax(0,1fr)_minmax(0,500px)] items-center gap-12 pt-8 max-lg:grid-cols-1 max-lg:gap-10 max-sm:pt-2`}>
          <div className="flex flex-col gap-6">
            <p className="text-[14px] font-bold tracking-[.15em] text-primary">個人開発者のための SNS 運用ツール</p>
            <h1 className="font-heading text-[48px] leading-[1.4] font-bold text-pretty max-lg:text-[40px] max-sm:text-[30px] max-sm:leading-[1.45]">
              {/* 行の途中で折れないように、1 行ずつまとめる */}
              <span className="inline-block">アプリは作れる。</span>
              <br />
              <span className="inline-block">でも、発信は苦手。</span>
            </h1>
            <p className="text-lg leading-[1.8] text-muted max-sm:text-base">
              何を・いつ・どこに出すかを AI と一緒に決めて、複数の SNS にまとめて予約。数字を見て振り返り、続かないときは矢書が声をかけます。アプリづくりの時間を守りながら、届けたい人へ。
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:flex-col max-sm:items-stretch">
              <a href="#apply" className={`${buttonClass()} h-[54px] px-7 text-[16px] max-sm:h-13`}>
                招待を申し込む（無料）
              </a>
              <span className="text-[14px] text-muted">いまは 10 人ほどの招待制で、無料で試せます</span>
            </div>
          </div>
          <Shot name="compose" alt="投稿をつくる画面。1 つの文面を、X・Threads・Instagram・Facebook ページにまとめて予約する" priority sizes="(max-width: 1024px) 100vw, 500px" />
        </section>

        {/* 悩みと解決 */}
        <section className={`${section} flex flex-col gap-8`} aria-labelledby="pains">
          <h2 id="pains" className={h2}>
            こんなことで、止まっていませんか
          </h2>
          <ul className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            {pains.map((p) => (
              <li key={p.pain} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 max-sm:p-5">
                <p className="text-[15px] text-muted">「{p.pain}」</p>
                <p className="font-heading text-[22px] leading-[1.5] font-bold [word-break:auto-phrase] max-sm:text-[19px]">{p.answer}</p>
                <p className="text-[15px] leading-[1.8] text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 使い方の流れ */}
        <section className={`${section} flex flex-col gap-8`} aria-labelledby="flow">
          <h2 id="flow" className={h2}>
            使い方は 4 つの段階
          </h2>
          <ol className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {steps.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-6 max-sm:p-5">
                <span className="text-[13px] font-bold tracking-[.15em] text-primary">{`STEP ${i + 1}`}</span>
                <b className="text-[17px]">{s.title}</b>
                <p className="text-[14px] leading-[1.8] text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="text-[14px] leading-[1.8] text-muted">
            目標は、最終的な目標（<Term k="kgi" />）と、日々追いかける数字（<Term k="kpi" />）に分けて決めます。数字の意味は、出てきたところで解説します。
          </p>
        </section>

        {/* 機能の一覧 */}
        <section id="features" className={`${section} flex scroll-mt-6 flex-col gap-10`} aria-labelledby="features-title">
          <h2 id="features-title" className={h2}>
            できること
          </h2>
          <div className="flex flex-col gap-16 max-sm:gap-12">
            {features.map((f, i) => (
              <article key={f.name} className={`grid items-center gap-10 max-lg:grid-cols-1 max-lg:gap-5 ${i % 2 ? "grid-cols-[1fr_380px]" : "grid-cols-[380px_1fr]"}`}>
                <div className={`flex flex-col gap-3 ${i % 2 ? "lg:order-last" : ""}`}>
                  <h3 className="font-heading text-[22px] leading-[1.5] font-bold">{f.title}</h3>
                  <p className="text-[15px] leading-[1.8] text-muted">{f.body}</p>
                </div>
                {f.shot && <Shot name={f.shot.name} alt={f.shot.alt} />}
              </article>
            ))}
          </div>
          <ul className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {moreFeatures.map((f) => (
              <li key={f.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
                <b className="text-[15px]">{f.title}</b>
                <p className="text-[14px] leading-[1.8] text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
          <p className="text-[14px] leading-[1.8] text-muted">
            どの SNS から何人来たかは、<Term k="shortLink" />で数えます。
          </p>
        </section>

        {/* 対応 SNS */}
        <section className={`${section} flex flex-col gap-8`} aria-labelledby="sns">
          <h2 id="sns" className={h2}>
            対応している SNS
          </h2>
          <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
            {sns.map((g) => (
              <div key={g.group} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
                <b className="text-[15px]">{g.group}</b>
                <ul className="flex flex-wrap gap-2">
                  {g.items.map((s) => (
                    <li key={s} className={`rounded-full px-3 py-1 text-xs font-bold ${g.group === "準備中" ? "border border-line text-muted" : "bg-primary-soft text-primary"}`}>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* 料金 */}
        <section id="price" className={`${section} flex scroll-mt-6 flex-col gap-8`} aria-labelledby="price-title">
          <h2 id="price-title" className={h2}>
            料金
          </h2>
          <div className="flex flex-col gap-4 rounded-lg border-2 border-primary bg-surface p-8 max-sm:p-5">
            <p className="text-[15px] font-bold text-primary">いまは招待制の試用</p>
            <p className="font-heading text-[48px] leading-none font-bold max-sm:text-[36px]">
              0 円<span className="ml-2 text-[17px] font-normal text-muted">試用の間</span>
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] leading-[1.8]">
              <li>すべての機能を使えます（AI などには 1 人あたりの月の上限があります）</li>
              <li>10 人ほどに、申し込みの順で招待のメールをお送りします</li>
              <li>有料のプランを始めるときは、前もってお知らせします。勝手に請求が始まることはありません</li>
            </ul>
          </div>
        </section>

        {/* よくある質問 */}
        <section id="faq" className={`${section} flex scroll-mt-6 flex-col gap-8`} aria-labelledby="faq-title">
          <h2 id="faq-title" className={h2}>
            よくある質問
          </h2>
          <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
            {faqs.map((f) => (
              <details key={f.q} className="group border-line [&:not(:first-child)]:border-t">
                <summary className="flex cursor-pointer items-center justify-between gap-4 px-6 py-4 text-[15px] font-bold max-sm:px-5 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="text-primary transition-transform group-open:rotate-45">
                    ＋
                  </span>
                </summary>
                <p className="px-6 pb-5 text-[15px] leading-[1.8] text-muted max-sm:px-5">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 招待の申し込み */}
        <section id="apply" className={`${section} scroll-mt-6`} aria-labelledby="apply-title">
          <div className="grid grid-cols-[1fr_440px] gap-12 rounded-lg border border-border bg-surface p-10 max-lg:grid-cols-1 max-lg:gap-6 max-sm:p-5">
            <div className="flex flex-col gap-4">
              <h2 id="apply-title" className={h2}>
                招待を申し込む
              </h2>
              <p className="text-[15px] leading-[1.8] text-muted">
                いまは 10 人ほどの招待制で、無料で試していただいています。メールアドレスを入れていただくと、申し込みの順に招待のメールをお送りします。
              </p>
              <p className="text-[15px] leading-[1.8] text-muted">招待が届いたら、メールのボタンからパスワードを決めるだけで使い始められます。</p>
            </div>
            <WaitlistForm />
          </div>
        </section>
      </main>

      <footer className={`${section} flex flex-wrap gap-x-6 gap-y-2 border-t border-line py-6 text-[14px] text-muted max-sm:text-xs`}>
        <Link href="/terms" className="hover:text-fg">
          利用規約
        </Link>
        <Link href="/privacy" className="hover:text-fg">
          プライバシーポリシー
        </Link>
        <Link href="/login" className="hover:text-fg">
          ログイン
        </Link>
      </footer>
    </div>
  );
}
