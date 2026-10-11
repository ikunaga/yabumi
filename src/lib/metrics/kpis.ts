import type { GOAL_TYPES } from "@/lib/plan/schema";

// 数字の画面で先頭に出す数字（KPI）の決まった名前（docs/architecture.md の 4.22）。
// アカウント設計の「最初の 1 か月」に 1〜3 個選んで保存する（account_plans の first_month.kpis）。AI の案もこの名前で出す

export const KPI_KEYS = ["posts", "link_clicks", "views", "followers", "store_page_views", "downloads", "revenue"] as const;
export type KpiKey = (typeof KPI_KEYS)[number];
export const MAX_KPIS = 3;

// いま矢書で数えられるか。ready: 数えられる / partial: 一部（手で入れた数字だけ）/ later: 取り込みを作ったら（それまでは「準備中」）
export type KpiAvailability = "ready" | "partial" | "later";

export type KpiDef = {
  label: string;
  // 素人向けの一文の説明（何を意味するか）
  meaning: string;
  // 用語集のキー（あれば）
  term?: "impression" | "shortLink" | "storeListing" | "conversion";
  availability: KpiAvailability;
  // later・partial のとき、何をすると出るか
  howToGet?: string;
};

export const KPIS: Record<KpiKey, KpiDef> = {
  posts: {
    label: "投稿した回数",
    meaning: "続けられているかの数字。最初の 1 か月は、数字が小さくても続けることがいちばん大事です。",
    availability: "ready",
  },
  link_clicks: {
    label: "ストアへのクリック",
    meaning: "投稿やプロフィールの短縮リンクから、ストアなどに来た人の数。興味を持って一歩進んだ人です。",
    term: "shortLink",
    availability: "ready",
  },
  views: {
    label: "投稿の閲覧数",
    meaning: "投稿が画面に表示された回数。どれだけの人の目に届いたかの数字です。",
    term: "impression",
    availability: "partial",
    howToGet: "いまは note・Substack で手で入れた数字だけ。Threads・X などの数字は、取り込みを作ったら出ます",
  },
  followers: {
    label: "フォロワーの増え方",
    meaning: "アカウントをフォローした人の増え方。続けて見てくれる人の数です。",
    availability: "later",
    howToGet: "SNS の数字の取り込みを作ったら出ます",
  },
  store_page_views: {
    label: "ストアのページの閲覧",
    meaning: "App Store・Google Play のアプリのページを見た人の数。",
    term: "storeListing",
    availability: "later",
    howToGet: "App Store Connect・Google Play の取り込みを作ったら出ます",
  },
  downloads: {
    label: "ダウンロード",
    meaning: "アプリを入れてくれた人の数。",
    term: "conversion",
    availability: "later",
    howToGet: "App Store Connect・Google Play の取り込みを作ったら出ます",
  },
  revenue: {
    label: "課金（売上）",
    meaning: "アプリの中で払ってもらった金額。",
    term: "conversion",
    availability: "later",
    howToGet: "RevenueCat・ストアの取り込みを作ったら出ます",
  },
};

// アカウント設計で KPI を決めていないとき、目的から出すおすすめ（4.22 の表）
export function recommendedKpis(goalType: (typeof GOAL_TYPES)[number] | null): KpiKey[] {
  switch (goalType) {
    case "awareness":
      return ["views", "followers", "posts"];
    case "downloads":
      return ["link_clicks", "downloads", "posts"];
    case "paid":
      return ["downloads", "revenue", "link_clicks"];
    default:
      return ["posts", "link_clicks"];
  }
}

export function isKpiKey(v: unknown): v is KpiKey {
  return typeof v === "string" && (KPI_KEYS as readonly string[]).includes(v);
}
