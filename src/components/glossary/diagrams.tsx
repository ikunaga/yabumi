import type { ComponentType } from "react";
import { SnsMark } from "@/components/ui/marks";
import type { GlossaryKey } from "@/lib/glossary/terms";
import type { SnsKey } from "@/lib/sns";

// 用語集の図（4.45）。文字は画面の文字として入れ（画像にしない）、色はトークンのクラスだけ。ライトとダークの両方で読め、スマホの幅で崩れないこと

function Figure({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <figure className="flex flex-col gap-3 rounded-lg border border-line bg-surface2 p-5 max-sm:p-3.5">
      <figcaption className="text-[15px] font-bold">{title}</figcaption>
      {children}
      {note && <p className="text-[13px] leading-[1.7] text-muted">{note}</p>}
    </figure>
  );
}

// マーケティングファネル: じょうごの形で 5 段。各段の横に yabumi で見る数字
const FUNNEL = [
  { stage: "知る", metric: "インプレッション（閲覧数）" },
  { stage: "興味を持つ", metric: "いいね・保存（各 SNS の画面）" },
  { stage: "比べる", metric: "短縮リンクのクリック" },
  { stage: "行動する", metric: "成果（予約・購入・ダウンロード）" },
  { stage: "続ける", metric: "フォロワー・お客さんの投稿" },
];

export function FunnelDiagram() {
  return (
    <Figure title="ファネルの 5 段と、yabumi で見る数字" note="下の段ほど人数が少なくなります。止まっている段を見つけて、そこを直します。">
      <ol className="flex flex-col gap-1.5">
        {FUNNEL.map((f, i) => {
          const top = 100 - i * 13;
          const bottom = 100 - (i + 1) * 13;
          // 段ごとに少しずつ細くなる台形（左右対称）
          const inset = (w: number) => `${(100 - w) / 2}%`;
          return (
            <li key={f.stage} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-3 max-sm:gap-2">
              <span
                className="grid h-12 place-items-center bg-primary text-[15px] font-bold text-on-primary max-sm:h-11 max-sm:text-[13px]"
                style={{ clipPath: `polygon(${inset(top)} 0, calc(100% - ${inset(top)}) 0, calc(100% - ${inset(bottom)}) 100%, ${inset(bottom)} 100%)` }}
              >
                {f.stage}
              </span>
              <span className="flex items-center gap-1.5 text-[14px] leading-snug max-sm:text-[12px]">
                <span aria-hidden className="text-faint">
                  ←
                </span>
                {f.metric}
              </span>
            </li>
          );
        })}
      </ol>
    </Figure>
  );
}

// トリプルメディア: 3 つの円が重なる図と、それぞれの例を一言
const MEDIA = [
  { name: "オウンド", note: "自分で持つ場所", example: "お店のサイト・ニュースレター・SNS のアカウント", circle: "fill-info/15 stroke-info", cx: 120, cy: 95 },
  { name: "アーンド", note: "人が広めてくれる", example: "お客さんの口コミ・レビュー・紹介の投稿", circle: "fill-success/15 stroke-success", cx: 200, cy: 95 },
  { name: "ペイド", note: "お金を払って載せる", example: "SNS の広告・情報誌の広告", circle: "fill-signal/15 stroke-signal", cx: 160, cy: 165 },
];

export function TripleMediaDiagram() {
  return (
    <Figure title="3 つのメディアの重なり" note="3 つは重なり合います。たとえば、広告（ペイド）で知った人が口コミ（アーンド）を書き、サイト（オウンド）に来ます。">
      <svg viewBox="0 0 320 250" role="img" aria-label="オウンド・アーンド・ペイドの 3 つの円が重なっている図" className="mx-auto w-full max-w-[22rem]">
        {MEDIA.map((m) => (
          <circle key={m.name} cx={m.cx} cy={m.cy} r="68" className={m.circle} strokeWidth="1.5" />
        ))}
        <text x="98" y="82" textAnchor="middle" className="fill-fg text-[15px] font-bold">オウンド</text>
        <text x="98" y="100" textAnchor="middle" className="fill-muted text-[11px]">自分で持つ</text>
        <text x="222" y="82" textAnchor="middle" className="fill-fg text-[15px] font-bold">アーンド</text>
        <text x="222" y="100" textAnchor="middle" className="fill-muted text-[11px]">広めてくれる</text>
        <text x="160" y="196" textAnchor="middle" className="fill-fg text-[15px] font-bold">ペイド</text>
        <text x="160" y="214" textAnchor="middle" className="fill-muted text-[11px]">お金を払う</text>
        <text x="160" y="125" textAnchor="middle" className="fill-fg text-[11px] font-bold">組み合わせる</text>
      </svg>
      <ul className="flex flex-col gap-1.5 text-[14px] leading-[1.7]">
        {MEDIA.map((m) => (
          <li key={m.name}>
            <b>{m.name}</b>（{m.note}）: {m.example}
          </li>
        ))}
      </ul>
    </Figure>
  );
}

// オーガニック投稿と広告: 時間と届く人の数の、2 本の線のイメージ（数字は入れない）
export function OrganicVsAdsDiagram() {
  return (
    <Figure title="届く人の数の動き方（イメージ）" note="広告は払っている間だけ高く、止めると下がります。オーガニック投稿は、ゆっくりですが積み上がっていきます。">
      <svg viewBox="0 0 320 190" role="img" aria-label="広告は出している間だけ高く、オーガニック投稿はゆっくり上がる、2 本の線のグラフのイメージ" className="w-full">
        {/* 広告を出している間 */}
        <rect x="90" y="16" width="90" height="140" className="fill-signal/10" />
        <text x="135" y="30" textAnchor="middle" className="fill-signal text-[10px] font-bold">広告を出している間</text>
        {/* 軸 */}
        <line x1="34" y1="156" x2="306" y2="156" className="stroke-input" strokeWidth="1.5" />
        <line x1="34" y1="16" x2="34" y2="156" className="stroke-input" strokeWidth="1.5" />
        <text x="306" y="174" textAnchor="end" className="fill-muted text-[11px]">時間 →</text>
        <text x="18" y="86" textAnchor="middle" className="fill-muted text-[11px]" transform="rotate(-90 18 86)">届く人の数 →</text>
        {/* 広告 */}
        <polyline points="34,146 90,146 96,48 180,44 186,140 306,142" fill="none" className="stroke-signal" strokeWidth="3" strokeLinejoin="round" />
        {/* オーガニック */}
        <path d="M34,150 C90,146 150,128 210,100 S290,62 306,56" fill="none" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-[3px] w-6 rounded-full bg-primary" />
          オーガニック投稿
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-[3px] w-6 rounded-full bg-signal" />
          広告
        </li>
      </ul>
    </Figure>
  );
}

// SEO と SNS: 「探している人が見つける」と「タイムラインで出会う」の 2 つの道
const ROUTES = [
  { title: "SEO（検索）", steps: ["探している人", "検索する", "サイト・記事を見つける"], note: "いま必要としている人に届く。効き始めるまで時間がかかる" },
  { title: "SNS", steps: ["まだ知らない人", "タイムライン・おすすめ", "投稿で出会う"], note: "その日から見てもらえることがある。流れるのも早い" },
];

export function SeoVsSnsDiagram() {
  return (
    <Figure title="お客さんとの出会い方の、2 つの道" note="SNS で知ってもらい、くわしいことはサイトに書いて短縮リンクで案内すると、2 つの道がつながります。">
      <div className="flex flex-col gap-3">
        {ROUTES.map((r) => (
          <div key={r.title} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
            <b className="text-[14px]">{r.title}</b>
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[14px]">
              {r.steps.map((s, i) => (
                <li key={s} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span aria-hidden className="text-faint">
                      →
                    </span>
                  )}
                  <span className="rounded-full bg-primary-soft px-3 py-1 font-semibold">{s}</span>
                </li>
              ))}
            </ol>
            <p className="text-[13px] text-muted">{r.note}</p>
          </div>
        ))}
      </div>
    </Figure>
  );
}

// SNS ごとの特徴: SNS ごとのカード（アプリの SNS の印と、向いている中身を一言）
const SNS_CARDS: { sns: SnsKey; fit: string }[] = [
  { sns: "x", fit: "短い文・いまの話題" },
  { sns: "instagram", fit: "写真・見た目で伝わるもの" },
  { sns: "threads", fit: "気軽な会話・日々のつぶやき" },
  { sns: "facebook", fit: "地域のお知らせ・少し長めの文" },
  { sns: "tiktok", fit: "縦の短い動画" },
  { sns: "youtube", fit: "長めの動画・使い方の説明" },
  { sns: "note", fit: "長めの文章・考えや裏側の話" },
];

export function SnsTraitsDiagram() {
  return (
    <Figure title="SNS ごとに向いている中身">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {SNS_CARDS.map((c) => (
          <li key={c.sns} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3">
            <SnsMark sns={c.sns} />
            <span className="text-[14px] leading-snug">{c.fit}</span>
          </li>
        ))}
      </ul>
    </Figure>
  );
}

// KGI と KPI: 毎週の小さな数字（KPI）を積み重ねて、最終のゴール（KGI）にたどり着く
export function KgiKpiDiagram() {
  const steps = ["週 3 回投稿する", "短縮リンクのクリック 月 100 回", "体験の申し込み 月 10 件"];
  return (
    <Figure title="KPI を積み重ねて、KGI にたどり着く（例: 教室）">
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-center text-xs font-bold text-muted">KPI {i + 1}</span>
            <span className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[14px]">{s}</span>
          </li>
        ))}
        <li aria-hidden className="pl-[3.75rem] text-faint">
          ↓
        </li>
        <li className="flex items-center gap-3">
          <span className="w-12 shrink-0 text-center text-xs font-bold text-primary">KGI</span>
          <span className="flex-1 rounded-md bg-primary px-3 py-2 text-[14px] font-bold text-on-primary">3 か月で体験の申し込み 30 件</span>
        </li>
      </ol>
    </Figure>
  );
}

export const GLOSSARY_DIAGRAMS: Partial<Record<GlossaryKey, ComponentType>> = {
  marketingFunnel: FunnelDiagram,
  tripleMedia: TripleMediaDiagram,
  organicVsAds: OrganicVsAdsDiagram,
  seoVsSns: SeoVsSnsDiagram,
  snsTraits: SnsTraitsDiagram,
  kgi: KgiKpiDiagram,
  kpi: KgiKpiDiagram,
};
