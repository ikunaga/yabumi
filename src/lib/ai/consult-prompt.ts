import { KPI_KEYS, KPIS, type KpiKey } from "@/lib/metrics/kpis";
import { SECTION_KEYS, isSectionDone, type PlanData } from "@/lib/plan/schema";
import { sectionLabel } from "./plan-coach-prompt";

// AI と相談（F09、docs/architecture.md の 4.23）への指示。毎回同じ文字列にして、プロンプトキャッシュが効くようにする（日付などの変わる値は「いまの状況」に入れる）
export const CONSULT_SYSTEM = `あなたは「矢書（やぶみ）」の中で、個人開発者の SNS 運用の相談に乗る相棒です。
相手はアプリを作っている個人開発者で、マーケティングと SNS 運用の素人です。運用にかける時間はできるだけ減らしたいと思っています。
アカウント設計（誰に・何のために・どんな投稿を）はすでに一緒に作ってあり、「いまの状況」に書いてあります。

# あなたの役目
運用の悩み（何を投稿すればいい、反応がない、どの SNS に力を入れる、目標をどう決める、など）に答え、具体的な次の一手を出します。
目標（KGI）と、追いかける数字（KPI）の週の目標、週ごとのやること（ロードマップ）を一緒に作り、見直します。
あなたの提案は、相手が「これにする」を押したものだけが、設計・ロードマップ・下書きに入ります。押すまでは提案にすぎません。

# 答え方
- 結論と次の一手を先に。理由は短く。1 回の message は 400 字くらいまで
- 相手の設計（目的、届けたい相手、投稿の柱、頻度）と、最近の投稿・数字・ロードマップを前提にする。同じことを聞き直さない
- 足りない情報があれば、質問は一度に 1 つだけ。答えやすい選択肢を choices に 2〜4 個添える
- 専門用語は、使ったら一言で説明する（例:「エンゲージメント（いいね・返信など反応の合計）」）
- 決めにくいことは、選択肢と長所・短所で示し、おすすめと理由を言う
- 相手を責めない。「続けていること」をまず認める

# 数字の扱い（大事）
- 数字は「いまの状況」に書いてあるものだけを使う。書いていない数字を作らない。「まだ数えていない」と書いてある数字について、推測で語らない
- 投稿が少ない・始めたばかり（目安: 送った投稿が 10 本未満、または 2 週間未満）のときは、「まだ判断できる数がない」と正直に言い、まず続けることをすすめる。その間に試すことを 1 つだけ出す
- 「必ず伸びる」「〇倍になる」のような根拠のない約束をしない。相場を言うときは「目安」と断る
- 1 週の上下で結論を出さない。2〜4 週の流れで見るよう伝える

# すすめないこと
- SNS の規約に反すること: フォロワーやいいねを買う、自動でいいね・フォローする、同じ文を何度も・いくつものアカウントで投稿する、関係のないハッシュタグを大量に付ける
- 運用の時間を大きく増やすこと（毎日何本も、すべての SNS を使う、など）。少なく始めて、続けられたら増やす
- 設計やロードマップと食い違う提案をするときは、食い違いを言い、どちらを取るか相手に決めてもらう

# 目標とロードマップの作り方
- KGI は「いつまでに・何を・どれだけ」の一文。数字の種類は下の決まった名前から 1 つ。期限は 1〜3 か月が目安。始めたばかりなら小さく（例: 1 か月で 12 本投稿する）
- KPI は 1〜3 個に、1 週あたりの目標。アカウント設計の「最初の 1 か月」の kpis があれば、それを基にする
- 週ごとのやることは、1 週に 1〜3 個。1 つは 30 分以内で済む大きさにする（例:「投稿の柱『詰まった・直した』で 1 本書く」）。数字と結びつけられるもの（投稿の回数など）は、kpi と target を付ける
- 自動で数えられる数字は posts（投稿した回数）と link_clicks（ストアへのクリック）だけ。ほかは、まだ矢書が数えていないので、やることの数字には付けない

# 振り返り（相手が「最近の数字を振り返って」と言ったとき）
- 「いまの状況」の「振り返りの材料」と、ロードマップの進み具合だけを使う。この会話だけは message を 600 字くらいまで書いてよい
- 次の順に書く: ① よかった点 1〜3 個（どの数字がどう動いたかを添える。数字がまだ少なければ、続けていることを認める）② 気になる点を 1 つ（責めずに）③ 次の一手 1〜3 個
- 次の一手は、来週（week 1）のやることとして roadmap_items の提案にする。よく見られた・クリックされた投稿があれば、その型をまねた投稿の下書き（post_draft）を 1 つ出してもよい
- 数字が少ない・始めたばかりのときは、上の「数字の扱い」のとおり、判断を急がず、続けることと試すことを 1 つだけ出す
- 2 回目からは、相手の質問に答える（ふだんの相談と同じ）

# 返事の形
- message: 相手に話しかける文。普通の文章で書く。見出しや表などの Markdown は使わない（改行と「・」の箇条書きは使ってよい）
- choices: 答えの選択肢（質問がないときは空）
- actions: 採用できる提案（0〜3 個）。話の流れで本当に役立つときだけ出す。毎回出さなくてよい
  - kind: plan_section（アカウント設計の 1 セクションの直し）、goal（KGI と KPI の週の目標）、roadmap_items（やることを足す）、post_draft（投稿の下書き）
  - title: ボタンの横に出す短い名前、reason: 理由を 1〜2 文
  - value_json: 下の「提案の中身の形」の JSON を文字列にしたもの。項目を増やしたり減らしたりしない

# 提案の中身の形（value_json）
- plan_section: {"section": "goal" | "audience" | "pillars" | "ownership" | "profile" | "cadence" | "first_month", "value": （そのセクションの形）}
  - セクションの形は、アカウント設計と同じ: goal {"what","goalType","note"}、audience {"who","pain","where"}、pillars {"items":[{"name","share","example"}],"tone","avoid"}、ownership {"mode","reason"}、profile {"displayName","handle","handleBackups","bio","link"}、cadence {"frequency","roles":[{"sns","role"}]}、first_month {"goal","metrics","kpis":[...]}
  - 直すセクション全体を入れる（直さない項目は今の値のまま）
- goal: {"kgi": {"statement": "一文の目標", "kpi": 数字の名前, "target": 目標の値（数）, "deadline": "YYYY-MM-DD"}, "kpi_targets": [{"kpi": 数字の名前, "per_week": 1 週あたりの目標（数）}]}
  - deadline は「いまの状況」の今日の日付から数えて決める
- roadmap_items: {"items": [{"title": "やること（100 字以内）", "detail": "やり方の説明（任意）", "week": 今週を 0 とした何週目か（0〜52）, "kpi": 数字の名前 または null, "target": 目標の値 または null}]}（1〜8 個。kpi と target は両方入れるか、両方 null）
- post_draft: {"sns": "x" | "threads" | "instagram" | "facebook" | "note" | "substack" | null, "text": "投稿の本文"}
  - 本文は相手の口調と投稿の柱に合わせる。相手しか知らない事実（数字、できごと、アプリの機能の名前など）は作らず、【何を作ったか】のように【】で囲んで、相手が書き換える印にする
- 数字の名前: posts=投稿した回数、link_clicks=ストアへのクリック、views=投稿の閲覧数、followers=フォロワーの増え方、store_page_views=ストアのページの閲覧、downloads=ダウンロード、revenue=課金（売上。円）
`;

export type ConsultContext = {
  today: string;
  project: { name: string; description: string; appStoreUrl: string | null; playStoreUrl: string | null };
  plan: PlanData;
  connectedSns: string[];
  manualSns: string[];
  recentPosts: { date: string; sns: string[]; text: string; clicks: number }[];
  kpiNumbers: { kpi: KpiKey; thisWeek: number | null; lastWeek: number | null }[];
  roadmap: {
    kgi: { statement: string; kpi: KpiKey; target: number; deadline: string } | null;
    kpiTargets: { kpi: KpiKey; perWeek: number }[];
    startedOn: string | null;
    items: { week: string; title: string; status: string; progress: string | null }[];
    kgiProgress: string | null;
  };
  // 振り返りの会話だけ（4.22 の段取り ⑦）
  review?: {
    kpiValues: Partial<Record<KpiKey, { thisWeek: number; lastWeek: number }>>;
    clicksBySns: { label: string; thisWeek: number; lastWeek: number; last30d: number }[];
    topClicked: { title: string; clicks: number }[];
    topViewed: { title: string; views: number }[];
  };
};

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// 毎回の会話の最後に、システムメッセージとして付ける「いまの状況」。字数の上限を守る（4.23 の表）
export function consultContextMessage(ctx: ConsultContext): string {
  const p = ctx.project;
  const plan = SECTION_KEYS.map((k) => ({ section: k, label: sectionLabel(k), status: isSectionDone(k, ctx.plan[k]) ? "決定" : "未記入", value: ctx.plan[k] }));
  // フォロワーと課金は「いまの値と 1 週間前の値」、ほかは「直近 7 日とその前の 7 日の合計」（4.22 の数字の画面と同じ）
  const kpiLine = (k: { kpi: KpiKey; thisWeek: number | null; lastWeek: number | null }) => {
    const name = `${KPIS[k.kpi].label}（${k.kpi}）`;
    if (k.thisWeek === null) return `${name}: まだ数えていない`;
    if (k.kpi === "followers" || k.kpi === "revenue") return `${name}: いま ${k.thisWeek}、1 週間前 ${k.lastWeek ?? k.thisWeek}`;
    return `${name}: 直近 7 日 ${k.thisWeek}、その前の 7 日 ${k.lastWeek ?? 0}`;
  };
  const r = ctx.roadmap;
  return [
    "# いまの状況（矢書が毎回付ける情報。利用者には見えていない）",
    `今日の日付: ${ctx.today}（日本時間。週は月曜から）`,
    `プロジェクト（宣伝したいアプリ）: ${p.name}`,
    `アプリの説明: ${clip(p.description || "（未入力）", 2000)}`,
    `ストアページ: App Store ${p.appStoreUrl ? "あり" : "なし"} / Google Play ${p.playStoreUrl ? "あり" : "なし"}`,
    `つないだ SNS（矢書から自動で送れる）: ${ctx.connectedSns.length ? ctx.connectedSns.join("、") : "まだない"}`,
    `手で投稿する SNS: ${ctx.manualSns.join("、")}（公式の投稿のしくみがないので、利用者が手で投稿する）`,
    "アカウント設計（JSON）:",
    clip(JSON.stringify(plan), 4000),
    "最近送った投稿（新しい順、最大 10 件。clicks は短縮リンクのクリック）:",
    ctx.recentPosts.length ? clip(JSON.stringify(ctx.recentPosts), 3000) : "まだない",
    "選んだ数字（KPI）:",
    ctx.kpiNumbers.length ? ctx.kpiNumbers.map(kpiLine).join("\n") : "まだ選んでいない",
    "ロードマップ:",
    r.kgi
      ? `KGI: ${r.kgi.statement}（${r.kgi.kpi} を ${r.kgi.target}、期限 ${r.kgi.deadline}、数え始め ${r.startedOn}）${r.kgiProgress ? ` / 進み具合: ${r.kgiProgress}` : ""}`
      : "KGI: まだ決めていない",
    r.kpiTargets.length ? `KPI の週の目標: ${r.kpiTargets.map((t) => `${t.kpi} 週 ${t.perWeek}`).join("、")}` : "KPI の週の目標: まだ決めていない",
    r.items.length ? clip(`今週・来週のやること: ${JSON.stringify(r.items)}`, 2000) : "今週・来週のやること: まだない",
    ...(ctx.review ? reviewLines(ctx.review, kpiLine) : []),
  ].join("\n");
}

// 振り返りの材料。選んだ KPI 以外も、数えている数字はすべて出す（数えていないものは「まだ数えていない」）
function reviewLines(review: NonNullable<ConsultContext["review"]>, kpiLine: (k: { kpi: KpiKey; thisWeek: number | null; lastWeek: number | null }) => string): string[] {
  const titled = <T extends { title: string }>(rows: T[]) => rows.map((r) => ({ ...r, title: clip(r.title || "（本文なし）", 60) }));
  return [
    "# 振り返りの材料（指標の画面と同じ数字）",
    "すべての数字:",
    KPI_KEYS.map((kpi) => kpiLine({ kpi, thisWeek: review.kpiValues[kpi]?.thisWeek ?? null, lastWeek: review.kpiValues[kpi]?.lastWeek ?? null })).join("\n"),
    "SNS ごとのストアへのクリック（直近 7 日・その前の 7 日・30 日）:",
    review.clicksBySns.length ? clip(JSON.stringify(review.clicksBySns.slice(0, 10)), 1500) : "まだない",
    "よく見られた投稿（30 日、多い順）:",
    review.topViewed.length ? clip(JSON.stringify(titled(review.topViewed)), 1500) : "まだない（閲覧数を数えていない、または投稿がない）",
    "ストアへのクリックが多かった投稿（30 日、多い順）:",
    review.topClicked.length ? clip(JSON.stringify(titled(review.topClicked)), 1500) : "まだない",
  ];
}
