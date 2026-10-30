// プロジェクトの設定の画面（つないだ SNS・このアプリについて・削除）。SNS をつなぐ・外す入口と、つないだあとに戻る先
export function projectSettingsHref(projectId: string, section?: "sns"): string {
  return `/projects/${projectId}/edit${section ? `#${section}` : ""}`;
}
