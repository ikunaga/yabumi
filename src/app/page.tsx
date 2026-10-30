import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Shot } from "@/components/lp/shot";
import { WaitlistForm } from "@/components/lp/waitlist-form";
import { buttonClass } from "@/components/ui/button";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { SnsTag } from "@/components/ui/marks";
import { Metric } from "@/components/ui/metric";
import type { SnsKey } from "@/lib/sns";
import { SuccessBanner } from "@/components/ui/feedback";
import { Term } from "@/components/ui/term";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { createClient } from "@/lib/supabase/server";

// 矢書の LP（ログイン前のトップ。F19、決定 D30。docs/architecture.md の 4.29）。
// 新規登録は閉じている（D24 の ①）ので、興味を持った人は招待を申し込む（いまは招待制の無料の試用。D24 の ②）。
// ログイン済みの人はプロジェクトへ移る

// short は見出しの下の 1 行。body は「くわしく」に畳む（2026-10-30 オーナーの決定）
const pains = [
  {
    pain: "ネタがない",
    short: "思いついたらメモ。AI がメモや更新から案を出します",
    answer: "思いついたらネタ帳へ。AI と一緒に投稿にする",
    body: "生活の中で思いついたことや、あったことを、どの画面からでも「＋ メモ」でさっと残せます。あとで AI が、メモやアプリの更新（GitHub）から投稿の案を出します。",
  },
  {
    pain: "時間がない",
    short: "X・Threads・Instagram・Facebook ページに一度に予約",
    answer: "一度書けば、複数の SNS にまとめて予約",
    body: "1 つの文面を X・Threads・Instagram・Facebook ページに一度に予約。SNS ごとの字数や画像の決まりも確かめます。いつ何を出すかはカレンダーで一目でわかります。",
  },
  {
    pain: "何を見ればいいかわからない",
    short: "閲覧からダウンロード・課金までを 1 枚で",
    answer: "追いかける数字を決めて、週ごとに振り返る",
    body: "投稿の閲覧から、ストアページ、ダウンロード、課金までをつなげて見られます。どの投稿から何人来たかは、SNS ごとの短縮リンクで数えます。",
  },
  {
    pain: "続かない",
    short: "遅れそうなときと毎週の振り返りでお知らせ",
    answer: "矢書が伴走して、遅れそうなら声をかける",
    body: "最初の 1 か月の目標を SNS ごとの週の回数にし、毎日ペースを見ます。遅れそうなときと毎週の振り返りを、画面・メール・スマホの通知でお知らせします。",
  },
];

const steps = [
  { title: "設計する", short: "AI と話して、誰に・何を発信するか決める", body: "AI と話しながら、誰に・何のために・どんな名前で・どんな投稿をするかを決めます。マーケティングの用語は、出てきたときに解説します。" },
  { title: "つなぐ", short: "使う SNS のアカウントをつなぐ", body: "使う SNS のアカウントをつなぎます。note・Substack は、文面を用意して手で投稿する形で使えます。" },
  { title: "投稿する", short: "下書きをつくり、まとめて予約", body: "ネタ帳や AI の案から下書きをつくり、AI っぽさをチェックして、まとめて予約します。" },
  { title: "振り返る", short: "数字を見て、次の週のやることを決める", body: "数字を見ながら AI と相談し、ロードマップと次の週のやることを決めます。" },
];

type Feature = { name: string; title: string; body: string; shot?: { name: string; alt: string } };

const features: Feature[] = [
  { name: "compose", title: "投稿をつくる・まとめて予約", body: "1 つの文面を、選んだ SNS にまとめて予約。SNS ごとの字数・画像の数を確かめ、文面を SNS ごとに少し変えることもできます。", shot: { name: "compose", alt: "投稿をつくる画面。下書きと、送り先の SNS ごとの字数と状態" } },
  { name: "calendar", title: "カレンダー", body: "週と月の表示で、予約・投稿済み・下書きを一目で。空いている日から投稿をつくれます。", shot: { name: "calendar", alt: "カレンダーの週の表示。予約と投稿済みの印" } },
  { name: "notes", title: "ネタ帳と、AI とネタを出す", body: "思いついたことを写真 1 枚と一緒に残し、AI がメモやアプリの更新から投稿の案を出します。", shot: { name: "notes", alt: "ネタ帳の画面。まだ使っていないメモの一覧" } },
  { name: "metrics", title: "分析と振り返り", body: "閲覧からダウンロード・課金までを 1 枚で。数字の読み方と次の一手を、やさしい言葉で添えます。", shot: { name: "metrics", alt: "分析の画面。閲覧、ストアページ、ダウンロード、課金の数字" } },
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

const sns: { group: string; items: SnsKey[]; ready: boolean }[] = [
  { group: "矢書から自動で投稿", items: ["x", "threads", "instagram", "facebook"], ready: true },
  { group: "文面を用意して、手で投稿", items: ["note", "substack"], ready: true },
  { group: "準備中", items: ["tiktok", "youtube"], ready: false },
];

// 最初の画面の下の数字（見本 A の上の 4 つの形）。どれも、いまの矢書の決まりそのまま
const facts = [
  { label: "まとめて予約", value: "4", unit: "つの SNS", note: "X・Threads・Instagram・Facebook ページ" },
  { label: "手で投稿", value: "2", unit: "つの SNS", note: "note・Substack（文面を用意）" },
  { label: "最初にやること", value: "4", unit: "段", note: "設計 → つなぐ → 投稿 → 振り返り" },
  { label: "いまの料金", value: "0", unit: "円", note: "招待制の試用。勝手に請求は始まりません" },
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
        <Link href="/privacy" className="underline">
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
    a: "いまは 10 人ほどで試していただいていて、申し込みの順にご案内します（時期は決まっていません。お断りすることもあります）。申し込みは、確認のメールのリンクからいつでも取り消せます。",
  },
  {
    q: "マーケティングの知識がなくても使えますか？",
    a: "はい。矢書は、マーケティングがはじめての個人開発者を前提にしています。空欄を自分で埋めるのではなく、AI が質問しながら一緒に整理し、案と理由を出すので、選んでいけば進みます。",
  },
];

const section = "w-full px-12 max-lg:px-8 max-sm:px-4";
// 日本語を文節で折る（対応していないブラウザでは、ふつうの折り方になる）
const h2 = "text-[28px] leading-[1.4] font-bold [word-break:auto-phrase] max-sm:text-[22px]";
const card = "rounded-lg border border-border bg-surface";

export default async function Home(props: PageProps<"/">) {
  const { done } = await props.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/projects");

  return (
    <div className="flex flex-1 flex-col bg-bg">
      {/* 上の灰の帯（ログイン後の上の帯と同じ形） */}
      <header className="sticky top-0 z-20 border-b border-border bg-nav">
        <div className={`${section} flex h-[68px] items-center gap-7 max-sm:h-14 max-sm:gap-3`}>
          <span className="flex max-sm:hidden">
            <Brand href="/" />
          </span>
          <span className="flex sm:hidden">
            <Brand href="/" size="sm" />
          </span>
          <nav aria-label="ページの中" className="flex items-center gap-6 text-[17px] font-bold text-muted max-md:hidden">
            <a href="#features" className="hover:text-fg">
              できること
            </a>
            <a href="#price" className="hover:text-fg">
              料金
            </a>
            <a href="#faq" className="hover:text-fg">
              よくある質問
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-4 max-sm:gap-3">
            <ThemeToggle />
            <Link href="/login" className="text-[15px] font-bold text-fg hover:underline">
              ログイン
            </Link>
            <a href="#apply" className={`${buttonClass({ size: "sm" })} max-sm:hidden`}>
              招待を申し込む
            </a>
          </div>
        </div>
      </header>

      {done === "withdrawn" && (
        <div className={`${section} pt-6`}>
          <SuccessBanner>退会しました。保存していたデータは消しました。ご利用ありがとうございました。</SuccessBanner>
        </div>
      )}

      <main className="flex flex-col gap-20 pt-14 pb-20 max-sm:gap-14 max-sm:pt-8 max-sm:pb-14">
        {/* 最初の画面 */}
        <section className={`${section} flex flex-col gap-10 max-sm:gap-8`}>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-center gap-12 max-lg:grid-cols-1 max-lg:gap-8">
            <div className="flex flex-col gap-6 max-sm:gap-5">
              <p className="flex flex-col gap-1">
                {/* ロゴに添える一言（ONE ARROW, EVERY FEED）。LP の最初と下の帯だけに出す（docs/design/new_design/README.md の「ロゴ」） */}
                <span className="text-[13px] font-bold tracking-[.25em] text-faint">ONE ARROW, EVERY FEED</span>
                <span className="text-[15px] font-bold text-muted">個人開発者のための SNS 運用ツール</span>
              </p>
              <h1 className="text-[48px] leading-[1.35] font-bold text-pretty max-lg:text-[40px] max-sm:text-[30px] max-sm:leading-[1.45]">
                {/* 行の途中で折れないように、1 行ずつまとめる */}
                <span className="inline-block">アプリは作れる。</span>
                <br />
                <span className="inline-block">でも、発信は苦手。</span>
              </h1>
              <div className="flex items-center gap-2 text-[17px] leading-[1.8] text-muted max-sm:text-[15px]">
                <p>何を・いつ・どこに出すかを AI と決めて、複数の SNS にまとめて予約。</p>
                <HelpTip label="矢書でできること">
                  何を・いつ・どこに出すかを AI と一緒に決めて、複数の SNS にまとめて予約。数字を見て振り返り、続かないときは矢書が声をかけます。アプリづくりの時間を守りながら、届けたい人へ。
                </HelpTip>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:flex-col max-sm:items-stretch">
                <a href="#apply" className={buttonClass({ size: "lg", className: "px-8" })}>
                  招待を申し込む（無料）
                </a>
                <span className="text-[14px] text-faint">いまは 10 人ほどの招待制です</span>
              </div>
            </div>
            <Shot name="compose" alt="投稿をつくる画面。1 つの文面を、X・Threads・Instagram・Facebook ページにまとめて予約する" priority sizes="(max-width: 1024px) 100vw, 720px" />
          </div>
          <ul className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-2.5">
            {facts.map((f) => (
              <li key={f.label}>
                <Metric label={f.label} value={f.value} unit={f.unit} note={f.note} className="h-full" />
              </li>
            ))}
          </ul>
        </section>

        {/* 悩みと解決 */}
        <section className={`${section} flex flex-col gap-6`} aria-labelledby="pains">
          <h2 id="pains" className={h2}>
            こんなことで、止まっていませんか
          </h2>
          <ul className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
            {pains.map((p) => (
              <li key={p.pain} className={`${card} flex flex-col gap-3 px-6 py-5 max-sm:px-4`}>
                <span className="w-fit rounded-full bg-subtle px-2.5 py-0.5 text-[13px] font-bold text-muted">「{p.pain}」</span>
                <p className="text-[18px] leading-[1.5] font-bold [word-break:auto-phrase]">{p.answer}</p>
                <p className="text-[14px] leading-[1.7] text-faint">{p.short}</p>
                <Disclosure className="mt-auto">{p.body}</Disclosure>
              </li>
            ))}
          </ul>
        </section>

        {/* 使い方の流れ */}
        <section className={`${section} flex flex-col gap-6`} aria-labelledby="flow">
          <div className="flex items-center gap-2.5">
            <h2 id="flow" className={h2}>
              使い方は 4 つの段階
            </h2>
            <HelpTip label="目標の決め方">
              目標は、最終的な目標（<Term k="kgi" />）と、日々追いかける数字（<Term k="kpi" />）に分けて決めます。数字の意味は、出てきたところで解説します。
            </HelpTip>
          </div>
          <ol className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {steps.map((s, i) => (
              <li key={s.title} className={`${card} flex flex-col gap-2 px-6 py-5 max-sm:px-4`}>
                <span className="num text-metric leading-none font-bold max-sm:text-[30px]">{i + 1}</span>
                <b className="text-[18px]">{s.title}</b>
                <p className="text-[14px] leading-[1.7] text-faint">{s.short}</p>
                <Disclosure className="mt-auto">{s.body}</Disclosure>
              </li>
            ))}
          </ol>
        </section>

        {/* 機能の一覧 */}
        <section id="features" className={`${section} flex scroll-mt-20 flex-col gap-6`} aria-labelledby="features-title">
          <div className="flex items-center gap-2.5">
            <h2 id="features-title" className={h2}>
              できること
            </h2>
            <HelpTip label="短縮リンク">
              どの SNS から何人来たかは、<Term k="shortLink" />で数えます。
            </HelpTip>
          </div>
          <ul className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
            {features.map((f) => (
              <li key={f.name} className={`${card} flex flex-col overflow-hidden`}>
                {f.shot && (
                  <div className="border-b border-line bg-surface2 p-3 [&>div]:rounded-md">
                    <Shot name={f.shot.name} alt={f.shot.alt} sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw" />
                  </div>
                )}
                <div className="flex flex-col gap-1.5 px-6 py-5 max-sm:px-4">
                  <h3 className="text-[18px] font-bold">{f.title}</h3>
                  <p className="text-[14px] leading-[1.7] text-muted">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <ul className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {moreFeatures.map((f) => (
              <li key={f.title} className={`${card} flex flex-col gap-1 px-6 py-4 max-sm:px-4`}>
                <b className="text-[16px]">{f.title}</b>
                <p className="text-[14px] leading-[1.7] text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 対応 SNS */}
        <section className={`${section} flex flex-col gap-6`} aria-labelledby="sns">
          <h2 id="sns" className={h2}>
            対応している SNS
          </h2>
          <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
            {sns.map((g) => (
              <div key={g.group} className={`${card} flex flex-col gap-3 px-6 py-5 max-sm:px-4`}>
                <b className="text-[16px]">{g.group}</b>
                <ul className={`flex flex-wrap gap-2 ${g.ready ? "" : "opacity-60"}`}>
                  {g.items.map((k) => (
                    <li key={k}>
                      <SnsTag sns={k} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* 料金 */}
        <section id="price" className={`${section} flex scroll-mt-20 flex-col gap-6`} aria-labelledby="price-title">
          <h2 id="price-title" className={h2}>
            料金
          </h2>
          <div className={`${card} grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-8 px-8 py-7 max-md:grid-cols-1 max-md:gap-4 max-sm:px-5 max-sm:py-5`}>
            <div className="flex flex-col gap-1.5">
              <p className="text-[16px] text-muted">いまは招待制の試用</p>
              <p className="num text-[64px] leading-none font-bold max-sm:text-[44px]">
                0<span className="ml-1.5 text-[20px] font-bold text-muted">円</span>
              </p>
            </div>
            <ul className="flex list-disc flex-col gap-1.5 self-center pl-5 text-[15px] leading-[1.8]">
              <li>すべての機能を使えます（AI などには 1 人あたりの月の上限があります）</li>
              <li>10 人ほどの招待制で、申し込みの順にご案内します（時期は決まっていません。お断りすることもあります）</li>
              <li>有料のプランを始めるときは、前もってお知らせします。勝手に請求が始まることはありません</li>
            </ul>
          </div>
        </section>

        {/* よくある質問 */}
        <section id="faq" className={`${section} flex scroll-mt-20 flex-col gap-6`} aria-labelledby="faq-title">
          <h2 id="faq-title" className={h2}>
            よくある質問
          </h2>
          <div className={`${card} flex flex-col overflow-hidden`}>
            {faqs.map((f) => (
              <details key={f.q} className="group border-line [&:not(:first-child)]:border-t">
                <summary className="flex cursor-pointer items-center justify-between gap-4 px-6 py-4 text-[16px] font-bold max-sm:px-4 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="text-muted transition-transform group-open:rotate-45">
                    ＋
                  </span>
                </summary>
                <p className="px-6 pb-5 text-[15px] leading-[1.8] text-muted max-sm:px-4">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 招待の申し込み */}
        <section id="apply" className={`${section} scroll-mt-20`} aria-labelledby="apply-title">
          <div className={`${card} grid grid-cols-[minmax(0,1fr)_440px] gap-12 px-10 py-9 max-lg:grid-cols-1 max-lg:gap-6 max-sm:px-5 max-sm:py-6`}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <h2 id="apply-title" className={h2}>
                  招待を申し込む
                </h2>
                <HelpTip label="招待のしくみ">
                  いまは 10 人ほどの招待制で、無料で試していただいています。申し込みの順にご案内します（時期は決まっていません。お断りすることもあります）。招待が届いたら、メールのボタンからパスワードを決めるだけで使い始められます。
                </HelpTip>
              </div>
              <p className="text-[15px] leading-[1.8] text-muted">メールアドレスを入れていただくと、申し込みの順にご案内します。</p>
            </div>
            <WaitlistForm />
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-nav">
        <div className={`${section} flex flex-wrap items-center gap-x-6 gap-y-3 py-6 text-[14px] text-muted max-sm:text-[13px]`}>
          <span className="flex items-center gap-3">
            <Brand href="/" size="sm" />
            <span className="text-[12px] font-bold tracking-[.2em] text-faint max-sm:hidden">ONE ARROW, EVERY FEED</span>
          </span>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 sm:ml-auto">
            <Link href="/terms" className="hover:text-fg">
              利用規約
            </Link>
            <Link href="/privacy" className="hover:text-fg">
              プライバシーポリシー
            </Link>
            <Link href="/login" className="hover:text-fg">
              ログイン
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
