import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/marks";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const pains = [
  {
    title: "SNS 運用に時間をかけたくない",
    short: "6 つの SNS へ一度に投稿・予約",
    body: "6 つの SNS へ一度に投稿・予約。カレンダーでいつ何を出すか一目でわかる。",
  },
  {
    title: "ネタがない",
    short: "AI が投稿案を出す",
    body: "アプリの説明から AI が投稿案を出す。AI っぽい雑な文章にならないようチェックもする。",
  },
  {
    title: "マーケティングがわからない",
    short: "目標の立て方から相談できる",
    body: "目標の立て方から AI と相談できる。使ううちに用語や考え方が身につく。",
  },
];

// 送り状の見本: 1 つの文面が各 SNS に予約される様子
const sample = [
  { sns: "X", note: "68 / 140 字", ready: true },
  { sns: "Threads", note: "68 / 500 字", ready: true },
  { sns: "Instagram", note: "画像が 1 枚必要です", ready: false },
  { sns: "Facebook", note: "68 字", ready: true },
];

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/projects");

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-20 py-10 max-lg:px-8 max-sm:gap-5 max-sm:px-5 max-sm:py-6">
      <header className="flex items-center gap-3">
        <span className="max-sm:hidden">
          <Brand withMark />
        </span>
        <span className="sm:hidden">
          <Brand size="sm" />
        </span>
        <nav className="ml-auto flex items-center gap-6 text-[14px] text-muted">
          <ThemeToggle />
          <a href="#how" className="hover:text-fg max-sm:hidden">
            しくみ
          </a>
          <Link href="/login" className={`${buttonClass({ variant: "secondary", size: "sm" })} max-sm:hidden`}>
            ログイン
          </Link>
          <Link href="/login" className="font-semibold text-primary sm:hidden">
            ログイン
          </Link>
        </nav>
      </header>

      <main className="grid flex-1 grid-cols-[1fr_500px] items-center gap-[72px] py-10 max-lg:grid-cols-1 max-lg:gap-10 max-sm:gap-5 max-sm:py-0">
        <div className="flex flex-col gap-6 max-sm:contents">
          <h1 className="font-heading text-[54px] leading-[1.4] font-bold text-pretty max-lg:text-[40px] max-sm:mt-4 max-sm:text-[30px] max-sm:leading-[1.45]">
            アプリ開発に集中したい人のための、SNS 運用ツール
          </h1>
          <p className="text-lg leading-[1.8] text-muted max-sm:text-base">
            狙った相手へ、離れた場所から、一斉に文を届ける。矢文のように。
          </p>
          <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
            <ButtonLink href="/signup" className="h-[54px] px-7 text-[16px] max-sm:h-13">
              はじめる（無料）
            </ButtonLink>
            <span className="text-[14px] text-muted max-sm:hidden">アプリ名を入れるだけで始められます</span>
          </div>

          <ol id="how" className="mt-5 border-t border-border text-[14px] max-sm:order-last max-sm:mt-0">
            {pains.map((p, i) => (
              <li
                key={p.title}
                className="grid grid-cols-[28px_220px_1fr] items-baseline border-b border-line py-3.5 last:border-b-0 max-sm:grid-cols-[20px_1fr] max-sm:py-3"
              >
                <span className="font-bold text-primary">{i + 1}</span>
                <b className="max-sm:hidden">{p.title}</b>
                <span className="leading-[1.7] text-muted max-sm:hidden">{p.body}</span>
                <span className="sm:hidden">{p.short}</span>
              </li>
            ))}
          </ol>
        </div>

        <figure aria-label="送り状の見本" className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex justify-between border-b-2 border-primary px-5 py-3.5 text-sm text-muted max-sm:px-3.5 max-sm:py-2.5 max-sm:text-xs">
            <b className="text-fg">送り状</b>
            <span className="max-sm:hidden">10/14（火）20:00 に送る</span>
            <span className="sm:hidden">10/14 20:00</span>
          </div>
          <p className="bg-ruled px-5 py-4 text-base leading-8 max-sm:hidden">
            レシートを撮るだけで家計簿がつく「かけいぼ日和」、v1.2 で月ごとのグラフが見られるようになりました。
          </p>
          <ul className="px-5 pb-3.5 max-sm:px-3.5 max-sm:pt-1 max-sm:pb-2.5">
            {sample.map((s, i) => (
              <li
                key={s.sns}
                className={`grid grid-cols-[100px_1fr_auto] border-t border-line py-2.5 text-sm max-sm:grid-cols-[1fr_auto] max-sm:py-2 max-sm:text-xs max-sm:first:border-t-0 ${i === 3 ? "max-sm:hidden" : ""}`}
              >
                <b>{s.sns}</b>
                <span className="text-muted max-sm:hidden">{s.note}</span>
                {s.ready ? (
                  <StatusMark status="scheduled" />
                ) : (
                  <span className="text-muted">
                    ○ <span className="max-sm:hidden">未完</span>
                    <span className="sm:hidden">画像が必要</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </figure>
      </main>
    </div>
  );
}
