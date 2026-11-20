// フォーマットの画面から戻る先（自動の投稿の「画像」の「フォーマットを編集 →」から来たとき。2026-11-20）。
// 好きな URL は受け取らない（よその場所へ飛ばされないよう、決まった戻り先の種類と回し方の id だけ）
export type FormatsBack = { kind: "auto-new" } | { kind: "plan" | "plan-edit"; planId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatsBackHref(projectId: string, back: FormatsBack): string {
  const v = back.kind === "auto-new" ? "auto-new" : `${back.kind}:${back.planId}`;
  return `/projects/${projectId}/formats?back=${encodeURIComponent(v)}`;
}

// ?back= の値から、戻る先の道と文を作る。形が違えば null（戻るのリンクを出さない）
export function readFormatsBack(projectId: string, raw: unknown): { href: string; label: string } | null {
  if (typeof raw !== "string") return null;
  if (raw === "auto-new") return { href: `/projects/${projectId}/auto/new`, label: "自動投稿を始める画面に戻る" };
  const m = /^(plan|plan-edit):(.+)$/.exec(raw);
  if (!m || !UUID.test(m[2])) return null;
  return m[1] === "plan"
    ? { href: `/projects/${projectId}/auto/${m[2]}`, label: "自動投稿に戻る" }
    : { href: `/projects/${projectId}/auto/${m[2]}/edit`, label: "自動投稿の編集に戻る" };
}
