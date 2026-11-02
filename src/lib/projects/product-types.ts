// 宣伝するものの種類と、見た人にしてほしいこと（決定 D34、2026-11-02。yabumi を「個人開発者のアプリ」向けから、
// 宣伝したい商品・サービスがある人のための汎用の SNS 運用ツールに広げた）。
// 画面（プロジェクトの作成・設定、アカウント設計、概要・分析・短縮リンク）と AI への指示の両方がここを使う。
// アプリ前提の機能（ストアの取り込み・RevenueCat・GitHub）は、種類が app のときだけ出す（isAppProject）

export const PRODUCT_TYPES = ["app", "web_service", "shop", "online_shop", "service", "creator", "other"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export type ProductTypeDef = {
  label: string;
  // 選ぶときに添える一文（素人向け）
  description: string;
  // 例（選ぶときに添える）
  examples: string;
};

export const PRODUCT_TYPE_DEFS: Record<ProductType, ProductTypeDef> = {
  app: { label: "アプリ", description: "スマホやパソコンのアプリ。App Store・Google Play で配っているもの", examples: "家計簿アプリ、ゲーム、学習アプリ" },
  web_service: { label: "Web のサービス", description: "ブラウザで使うサービス。会員登録や月額のものも", examples: "予約システム、オンライン講座、SaaS" },
  shop: { label: "お店（実店舗）", description: "来てもらうお店や施設", examples: "カフェ、美容室、雑貨店、整体院" },
  online_shop: { label: "ネットで物を売る", description: "ネットショップやフリマ・ハンドメイドのサイトで物を売る", examples: "BASE・STORES のお店、minne・Creema の作品" },
  service: { label: "サービス（教室・サロン・フリーランス）", description: "人が提供するサービス。予約や問い合わせから始まるもの", examples: "ヨガ教室、ネイルサロン、デザインの仕事の受注" },
  creator: { label: "作品・発信", description: "作品や発信そのものを知ってもらう", examples: "イラスト、音楽、ブログ、YouTube、ニュースレター" },
  other: { label: "そのほか", description: "上のどれにも当てはまらないもの", examples: "イベント、団体の活動" },
};

// 見た人にしてほしいこと（アカウント設計の目標。前の goalType を広げたもの）
export const DESIRED_ACTIONS = ["download", "purchase", "signup", "booking", "inquiry", "visit", "follow", "awareness", "other"] as const;
export type DesiredAction = (typeof DESIRED_ACTIONS)[number];

export type DesiredActionDef = {
  label: string;
  description: string;
};

export const DESIRED_ACTION_DEFS: Record<DesiredAction, DesiredActionDef> = {
  download: { label: "ダウンロードしてもらう", description: "アプリを入れてもらう" },
  purchase: { label: "買ってもらう", description: "商品やサービスを買ってもらう（アプリの課金も）" },
  signup: { label: "申し込み・会員登録", description: "サービスに登録してもらう、講座などに申し込んでもらう" },
  booking: { label: "予約してもらう", description: "席・時間・枠を予約してもらう" },
  inquiry: { label: "問い合わせてもらう", description: "メールやフォームで相談・見積もりの連絡をもらう" },
  visit: { label: "来てもらう", description: "お店や会場に足を運んでもらう" },
  follow: { label: "フォローしてもらう", description: "SNS のアカウントをフォローして、続けて見てもらう" },
  awareness: { label: "まず知ってもらう", description: "名前や存在を知ってもらう。ほかの行動はそのあと" },
  other: { label: "そのほか", description: "上のどれにも当てはまらないこと" },
};

// 種類ごとのおすすめ（先頭がいちばんのおすすめ。AI の案と、選ぶ画面の並びに使う）
export const RECOMMENDED_ACTIONS: Record<ProductType, DesiredAction[]> = {
  app: ["download", "purchase", "awareness"],
  web_service: ["signup", "purchase", "awareness"],
  shop: ["visit", "booking", "follow"],
  online_shop: ["purchase", "follow", "awareness"],
  service: ["booking", "inquiry", "signup"],
  creator: ["follow", "awareness", "purchase"],
  other: ["awareness", "follow", "inquiry"],
};

// 前の版のアカウント設計の目標（goalType）を、してほしいことに読み替える（前の値はそのまま引き継ぐ）
export const LEGACY_GOAL_TYPES = ["downloads", "paid", "awareness", "other"] as const;
export function actionFromLegacyGoal(goalType: string | null | undefined): DesiredAction | null {
  switch (goalType) {
    case "downloads":
      return "download";
    case "paid":
      return "purchase";
    case "awareness":
      return "awareness";
    case "other":
      return "other";
    default:
      return isDesiredAction(goalType) ? goalType : null;
  }
}

// 行き先の URL の種類（プロジェクトに複数登録する。短縮リンクの行き先の候補）
export const DESTINATION_KINDS = ["site", "booking", "shop", "store", "form", "other"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DESTINATION_KIND_DEFS: Record<DestinationKind, { label: string; description: string }> = {
  site: { label: "サイト", description: "公式サイト・紹介ページ・ブログ" },
  booking: { label: "予約", description: "予約のページ（ホットペッパー、STORES 予約など）" },
  shop: { label: "ネットのお店", description: "商品を買えるページ（BASE、minne など）" },
  store: { label: "アプリのストア", description: "App Store・Google Play のページ" },
  form: { label: "申し込み・問い合わせ", description: "申し込みや問い合わせのフォーム" },
  other: { label: "そのほか", description: "上のどれにも当てはまらないページ" },
};

// 種類ごとに、行き先として先に出す種類
export const RECOMMENDED_DESTINATIONS: Record<ProductType, DestinationKind[]> = {
  app: ["store", "site"],
  web_service: ["site", "form"],
  shop: ["site", "booking"],
  online_shop: ["shop", "site"],
  service: ["booking", "form", "site"],
  creator: ["site", "shop"],
  other: ["site", "form"],
};

export function isProductType(v: unknown): v is ProductType {
  return typeof v === "string" && (PRODUCT_TYPES as readonly string[]).includes(v);
}

export function isDesiredAction(v: unknown): v is DesiredAction {
  return typeof v === "string" && (DESIRED_ACTIONS as readonly string[]).includes(v);
}

export function isDestinationKind(v: unknown): v is DestinationKind {
  return typeof v === "string" && (DESTINATION_KINDS as readonly string[]).includes(v);
}

// アプリ前提の機能（ストア・RevenueCat・Google Play・App Store の数字、GitHub の入口）を出すか
export function isAppProject(project: { product_type?: string | null }): boolean {
  return (project.product_type ?? "app") === "app";
}
