// プロジェクト内のナビ。まだ作っていない画面は href なし（押せない）。
// main: 上の横並びのメニュー（PC）とスマホの下のタブに出す 5 つ（決定 D33）。ほかは「…」（その他）と、スマホの「メニュー」と、関係する画面の中から開く
export type ProjectNavKey = "overview" | "plan" | "compose" | "notes" | "calendar" | "links" | "metrics" | "consult" | "roadmap" | "settings";

export type ProjectNavItem = { key: ProjectNavKey; label: string; tabLabel: string; href: string | null; main: boolean };

export function projectNavItems(projectId: string): ProjectNavItem[] {
  const base = `/projects/${projectId}`;
  return [
    { key: "overview", label: "概要", tabLabel: "概要", href: base, main: true },
    { key: "compose", label: "投稿", tabLabel: "投稿", href: `${base}/compose`, main: true },
    { key: "calendar", label: "カレンダー", tabLabel: "カレンダー", href: `${base}/calendar`, main: true },
    // 前の名前は「指標」。追いかける数字とストアの数字を見る画面
    { key: "metrics", label: "分析", tabLabel: "分析", href: `${base}/metrics`, main: true },
    { key: "consult", label: "AI と相談", tabLabel: "相談", href: `${base}/consult`, main: true },
    // ここから「…」（その他）。概要の「いまやること」「今週のやること」からも開く
    { key: "plan", label: "アカウント設計", tabLabel: "設計", href: `${base}/plan`, main: false },
    // ネタ帳（4.26）。メモを残すのは上の「＋ メモ」、スマホは右下の「＋ メモ」
    { key: "notes", label: "ネタ帳", tabLabel: "ネタ帳", href: `${base}/notes`, main: false },
    // 短縮リンク（4.22）
    { key: "links", label: "短縮リンク", tabLabel: "短縮リンク", href: `${base}/links`, main: false },
    // ロードマップ（4.23）
    { key: "roadmap", label: "ロードマップ", tabLabel: "ロードマップ", href: `${base}/roadmap`, main: false },
    // プロジェクトの設定（つないだ SNS・このアプリについて・削除）。概要の「つなぐ・外す」からも開く
    { key: "settings", label: "プロジェクトの設定", tabLabel: "設定", href: `${base}/edit`, main: false },
  ];
}

// URL の区切り（/projects/[id]/ の次）から、選択中の項目を決める
export function activeNavKey(segment: string | null): ProjectNavKey {
  switch (segment) {
    case "compose":
    case "posts":
    case "ideas":
      return "compose";
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
