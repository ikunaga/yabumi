// ログイン後の戻り先として、自サイト内のパスだけを許可する（外部サイトへのリダイレクトを防ぐ）
export function safeNextPath(next: unknown, fallback = "/projects"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // ブラウザは URL のタブ・改行を取り除き、\ を / と読む（「/\t/evil.example」は「//evil.example」になる）。制御文字と \ はどこにあっても断る
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}
