// プロジェクト内のナビ。まだ作っていない画面は href なし（押せない）
export type ProjectNavKey = "overview" | "plan" | "compose" | "calendar" | "links" | "metrics" | "consult" | "roadmap";

export type ProjectNavItem = { key: ProjectNavKey; label: string; tabLabel: string; href: string | null; tab: boolean };

export function projectNavItems(projectId: string): ProjectNavItem[] {
  const base = `/projects/${projectId}`;
  return [
    { key: "overview", label: "概要", tabLabel: "概要", href: base, tab: true },
    // スマホの下のタブは 5 つで埋まっているので、設計はヘッダーの「メニュー」と概要の「いまやること」から開く
    { key: "plan", label: "アカウント設計", tabLabel: "設計", href: `${base}/plan`, tab: false },
    { key: "compose", label: "投稿をつくる", tabLabel: "投稿", href: `${base}/compose`, tab: true },
    { key: "calendar", label: "カレンダー", tabLabel: "カレンダー", href: `${base}/calendar`, tab: true },
    // 短縮リンク（4.22）。スマホの下のタブは埋まっているので、ヘッダーの「メニュー」から開く
    { key: "links", label: "短縮リンク", tabLabel: "短縮リンク", href: `${base}/links`, tab: false },
    { key: "metrics", label: "指標", tabLabel: "指標", href: `${base}/metrics`, tab: true },
    { key: "consult", label: "AI と相談", tabLabel: "相談", href: `${base}/consult`, tab: true },
    // ロードマップ（4.23）。スマホの下のタブは埋まっているので、ヘッダーの「メニュー」と概要の「今週のやること」から開く
    { key: "roadmap", label: "ロードマップ", tabLabel: "ロードマップ", href: `${base}/roadmap`, tab: false },
  ];
}

// URL の区切り（/projects/[id]/ の次）から、選択中の項目を決める
export function activeNavKey(segment: string | null): ProjectNavKey {
  switch (segment) {
    case "compose":
    case "posts":
    case "ideas":
      return "compose";
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
    // ストアと課金をつなぐ画面は、指標の画面から開く
    case "metrics":
    case "stores":
      return "metrics";
    default:
      return "overview";
  }
}
