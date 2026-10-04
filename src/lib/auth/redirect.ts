// ログイン後の戻り先として、自サイト内のパスだけを許可する（外部サイトへのリダイレクトを防ぐ）
export function safeNextPath(next: unknown, fallback = "/projects"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
