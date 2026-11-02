import type { GOAL_TYPES } from "@/lib/plan/schema";
import { isAppProject } from "@/lib/projects/product-types";

// 数字の画面で先頭に出す数字（KPI）の決まった名前（docs/architecture.md の 4.22）。
// アカウント設計の「最初の 1 か月」に 1〜3 個選んで保存する（account_plans の first_month.kpis）。AI の案もこの名前で出す

export const KPI_KEYS = ["posts", "link_clicks", "views", "followers", "store_page_views", "downloads", "revenue", "outcomes"] as const;
export type KpiKey = (typeof KPI_KEYS)[number];
export const MAX_KPIS = 3;

// いま yabumi で数えられるか。ready: 数えられる / partial: 一部（手で入れた数字だけ）/ connect: ストアや課金をつなぐと出る /
// later: 取り込みを作ったら（それまでは「準備中」）
export type KpiAvailability = "ready" | "partial" | "connect" | "later";

export type KpiDef = {
  label: string;
  // 素人向けの一文の説明（何を意味するか）
  meaning: string;
  // 用語集のキー（あれば）
  term?: "impression" | "shortLink" | "storeListing" | "conversion";
  availability: KpiAvailability;
  // connect のとき、つなぐ画面（stores: ストアと課金をつなぐ / sns: プロジェクトの設定の「つないだ SNS」）
  connectTo?: "stores" | "sns";
  // later・partial のとき、何をすると出るか
  howToGet?: string;
};

export const KPIS: Record<KpiKey, KpiDef> = {
  // 手で記録する成果（決定 D34。project_outcomes_daily）。アプリ以外は、買った・予約などをストアのように自動では読めない
  outcomes: {
    label: "成果（手で記録）",
    meaning: "買ってもらった・申し込み・予約・問い合わせ・来店の数。お店の帳簿や予約の画面を見て、日ごとに入れた分です。",
    availability: "partial",
    howToGet: "分析の画面の「成果を記録する」で、日ごとに入れると出ます",
  },
  posts: {
    label: "投稿した回数",
    meaning: "続けられているかの数字。最初の 1 か月は、数字が小さくても続けることがいちばん大事です。",
    availability: "ready",
  },
  link_clicks: {
    // アプリの画面では「ストアへのクリック」と出す（clickLabel。決定 D34）
    label: "行き先へのクリック",
    meaning: "投稿やプロフィールの短縮リンクから、ストア・サイト・予約のページなどの行き先に来た人の数。興味を持って一歩進んだ人です。",
    term: "shortLink",
    availability: "ready",
  },
  views: {
    label: "投稿の閲覧数",
    meaning: "投稿が画面に表示された回数。どれだけの人の目に届いたかの数字です。",
    term: "impression",
    availability: "connect",
    connectTo: "sns",
    howToGet: "Threads・Instagram・Facebook・X を数字の権限つきでつなぐと出ます（note・Substack は手で記録。X は読むたびに費用がかかるので、月の上限まで）",
  },
  followers: {
    label: "フォロワーの増え方",
    meaning: "アカウントをフォローした人の増え方。続けて見てくれる人の数です。",
    availability: "connect",
    connectTo: "sns",
    howToGet: "Threads・Instagram・Facebook・X を数字の権限つきでつなぐと出ます（X は週に 1 回）",
  },
  store_page_views: {
    label: "ストアのページの閲覧",
    meaning: "App Store・Google Play のアプリのページを見た人の数。",
    term: "storeListing",
    availability: "connect",
    connectTo: "stores",
    howToGet: "App Store のページの閲覧数のレポートを依頼するか、Google Play をつなぐと出ます",
  },
  downloads: {
    label: "ダウンロード",
    meaning: "アプリを入れてくれた人の数（はじめてのダウンロード）。",
    term: "conversion",
    availability: "connect",
    connectTo: "stores",
    howToGet: "App Store か Google Play をつなぐと出ます",
  },
  revenue: {
    label: "課金（売上）",
    meaning: "直近 28 日に払ってもらった金額（RevenueCat の数字）。",
    term: "conversion",
    availability: "connect",
    connectTo: "stores",
    howToGet: "RevenueCat をつなぐと出ます",
  },
};

// アカウント設計で KPI を決めていないとき、目的（見た人にしてほしいこと）から出すおすすめ（4.22 の表。決定 D34 で広げた）。
// ダウンロード・売上（RevenueCat）はアプリのときだけ読めるので、アプリでなければ出さない
export function recommendedKpis(goalType: (typeof GOAL_TYPES)[number] | null, productType: string | null = "app"): KpiKey[] {
  const app = (productType ?? "app") === "app";
  switch (goalType) {
    case "awareness":
    case "follow":
      return ["views", "followers", "posts"];
    case "download":
      return app ? ["link_clicks", "downloads", "posts"] : ["link_clicks", "posts"];
    case "purchase":
      return app ? ["downloads", "revenue", "link_clicks"] : ["link_clicks", "outcomes", "posts"];
    case "signup":
    case "booking":
    case "inquiry":
    case "visit":
      return ["link_clicks", "outcomes", "posts"];
    default:
      return ["posts", "link_clicks"];
  }
}

export function isKpiKey(v: unknown): v is KpiKey {
  return typeof v === "string" && (KPI_KEYS as readonly string[]).includes(v);
}

// 「行き先へのクリック」の画面での名前（アプリならストア。決定 D34）
export function clickLabel(productType: string | null | undefined): string {
  return (productType ?? "app") === "app" ? "ストアへのクリック" : "行き先へのクリック";
}

// ストア・課金をつながないと出ない数字（ストアのページの閲覧・ダウンロード・課金）。宣伝するものがアプリのときだけ（決定 D34）
export function isStoreKpi(kpi: KpiKey): boolean {
  return KPIS[kpi].connectTo === "stores";
}

// その種類で選べる・出せる数字。アプリでなければストアの 3 つを外す
export function kpiAllowed(kpi: KpiKey, productType: string | null | undefined): boolean {
  return isAppProject({ product_type: productType }) || !isStoreKpi(kpi);
}

export function kpiKeysFor(productType: string | null | undefined): KpiKey[] {
  return KPI_KEYS.filter((k) => kpiAllowed(k, productType));
}

// 分析・概要・AI と相談で使う、追いかける数字。アカウント設計で選んだもののうち、その種類で出せるもの（なければ目的からのおすすめ）。
// 種類をアプリから変えた人のストアの数字は、記録は残したまま出さない（アプリに戻せばまた出る）
export function chosenKpis(
  chosen: readonly KpiKey[] | null | undefined,
  goalType: (typeof GOAL_TYPES)[number] | null | undefined,
  productType: string | null | undefined,
): KpiKey[] {
  const allowed = (chosen ?? []).filter((k) => kpiAllowed(k, productType));
  return allowed.length ? allowed : recommendedKpis(goalType ?? null, productType ?? null);
}
