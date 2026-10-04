// プロジェクト内のナビ。まだ作っていない画面は href なし（押せない）
export type ProjectNavKey = "overview" | "plan" | "compose" | "calendar" | "metrics" | "consult" | "roadmap";

export type ProjectNavItem = { key: ProjectNavKey; label: string; tabLabel: string; href: string | null; tab: boolean };

export function projectNavItems(projectId: string): ProjectNavItem[] {
  const base = `/projects/${projectId}`;
  return [
    { key: "overview", label: "概要", tabLabel: "概要", href: base, tab: true },
    // スマホの下のタブは 5 つで埋まっているので、設計は概要の「いまやること」から開く
    { key: "plan", label: "アカウント設計", tabLabel: "設計", href: `${base}/plan`, tab: false },
    { key: "compose", label: "投稿をつくる", tabLabel: "投稿", href: `${base}/compose`, tab: true },
    { key: "calendar", label: "カレンダー", tabLabel: "予定", href: `${base}/calendar`, tab: true },
    { key: "metrics", label: "指標", tabLabel: "指標", href: null, tab: true },
    { key: "consult", label: "AI と相談", tabLabel: "相談", href: null, tab: true },
    { key: "roadmap", label: "ロードマップ", tabLabel: "ロードマップ", href: null, tab: false },
  ];
}

// URL の区切り（/projects/[id]/ の次）から、選択中の項目を決める
export function activeNavKey(segment: string | null): ProjectNavKey {
  switch (segment) {
    case "compose":
    case "posts":
      return "compose";
    case "calendar":
      return "calendar";
    case "plan":
      return "plan";
    default:
      return "overview";
  }
}
