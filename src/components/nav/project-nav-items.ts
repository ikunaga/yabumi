// プロジェクト内のナビ。まだ作っていない画面は href なし（押せない）。
// main: 上の横並びのメニュー（PC）とスマホの下のタブに出す 5 つ（決定 D33）。ほかは「…」（その他）と、スマホの「メニュー」と、関係する画面の中から開く
export type ProjectNavKey = "overview" | "plan" | "compose" | "drafts" | "comments" | "notes" | "calendar" | "links" | "metrics" | "consult" | "roadmap" | "settings";

// barLabel: PC の上の帯に出す英語の名前（2026-10-31 オーナーの指示）。画面の見出し・スマホのタブ・メニューの説明は日本語（label・tabLabel）のまま
export type ProjectNavItem = { key: ProjectNavKey; label: string; barLabel: string; tabLabel: string; href: string | null; main: boolean };

export function projectNavItems(projectId: string): ProjectNavItem[] {
  const base = `/projects/${projectId}`;
  return [
    { key: "overview", label: "概要", barLabel: "Overview", tabLabel: "概要", href: base, main: true },
    { key: "compose", label: "投稿", barLabel: "Compose", tabLabel: "投稿", href: `${base}/compose`, main: true },
    { key: "calendar", label: "カレンダー", barLabel: "Calendar", tabLabel: "カレンダー", href: `${base}/calendar`, main: true },
    // 前の名前は「指標」。追いかける数字とストアの数字を見る画面
    { key: "metrics", label: "分析", barLabel: "Analytics", tabLabel: "分析", href: `${base}/metrics`, main: true },
    { key: "consult", label: "AI と相談", barLabel: "Ask AI", tabLabel: "相談", href: `${base}/consult`, main: true },
    // ここから「…」（その他）。概要の「いまやること」「今週のやること」からも開く
    // 下書きの一覧（保存した下書きを探して続ける。概要とカレンダーの「下書き n 件」・投稿をつくるの「下書きから続ける」からも開く。2026-11-13 PMO2 の確かめ）
    { key: "drafts", label: "下書き", barLabel: "Drafts", tabLabel: "下書き", href: `${base}/drafts`, main: false },
    // SNS のコメント（4.70）。概要の「新しいコメント」の帯・スマホの通知・投稿の画面からも開く
    { key: "comments", label: "コメント", barLabel: "Comments", tabLabel: "コメント", href: `${base}/comments`, main: false },
    { key: "plan", label: "アカウント設計", barLabel: "Strategy", tabLabel: "設計", href: `${base}/plan`, main: false },
    // ネタ帳（4.26）。メモを残すのは上の「＋ メモ」、スマホは右下の「＋ メモ」
    { key: "notes", label: "ネタ帳", barLabel: "Notes", tabLabel: "ネタ帳", href: `${base}/notes`, main: false },
    // 短縮リンク（4.22）
    { key: "links", label: "短縮リンク", barLabel: "Links", tabLabel: "短縮リンク", href: `${base}/links`, main: false },
    // ロードマップ（4.23）
    { key: "roadmap", label: "ロードマップ", barLabel: "Roadmap", tabLabel: "ロードマップ", href: `${base}/roadmap`, main: false },
    // プロジェクトの設定（つないだ SNS・このアプリについて・削除）。概要の「つなぐ・外す」からも開く
    { key: "settings", label: "プロジェクトの設定", barLabel: "Settings", tabLabel: "設定", href: `${base}/edit`, main: false },
  ];
}

// URL の区切り（/projects/[id]/ の次）から、選択中の項目を決める
export function activeNavKey(segment: string | null): ProjectNavKey {
  switch (segment) {
    case "compose":
    case "posts":
    case "ideas":
      return "compose";
    case "drafts":
      return "drafts";
    case "comments":
      return "comments";
    case "notes":
      return "notes";
    case "calendar":
      return "calendar";
    case "plan":
      return "plan";
    case "links":
      return "links";
    case "roadmap":
      return "roadmap";
    case "consult":
      return "consult";
    // SNS をつなぐ画面と GitHub は、プロジェクトの設定（つないだ SNS・このアプリについて）から開く
    case "edit":
    case "connect":
    case "github":
      return "settings";
    // ストアと課金をつなぐ画面は、分析の画面から開く
    case "metrics":
    case "stores":
      return "metrics";
    default:
      return "overview";
  }
}

// 用語集（4.45）。プロジェクトの外の画面だが、どの画面からも開けるように、PC の上の帯の「More」の下（区切りのあと）と、
// スマホの「メニュー」、プロジェクトの外の上の帯に置く
export const GLOSSARY_NAV = { href: "/glossary", barLabel: "Glossary", label: "用語集" } as const;

// 選んでいる印を付ける先（プロジェクトの画面か、用語集。用語集はプロジェクトの中から開くと、そのプロジェクトの帯のまま出す。4.48）
export type NavActive = ProjectNavKey | "glossary";
