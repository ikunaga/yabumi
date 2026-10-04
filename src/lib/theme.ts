// 画面のテーマ。cookie に保存し、サーバーで html の data-theme に反映する（表示の切り替わりのちらつきを防ぐ）
export const THEME_COOKIE = "yabumi-theme";
export type Theme = "light" | "dark";

export function parseTheme(value: string | undefined): Theme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}
