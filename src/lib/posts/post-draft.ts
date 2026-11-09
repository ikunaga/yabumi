import type { SnsKey } from "@/lib/sns";

// 投稿をつくるの書きかけの控え（src/lib/form-draft.ts。docs/architecture.md の 4.35）で比べる中身: 本文・SNS ごとの文面・タイトル
export type PostDraft = { body: string; overrides: Partial<Record<SnsKey, string>>; titles: Partial<Record<SnsKey, string>> };

// 書き始めたときの値を、比べられる形の文字にする（空の文面・タイトルは無いのと同じ。並びもそろえる）
export function postDraftBase(d: PostDraft): string {
  const tidy = (x: Partial<Record<string, string>> = {}) =>
    Object.fromEntries(
      Object.entries(x)
        .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  return JSON.stringify({ body: d.body, overrides: tidy(d.overrides), titles: tidy(d.titles) });
}

export function samePostDraft(a: PostDraft, b: PostDraft): boolean {
  const same = (x: Partial<Record<string, string>> = {}, y: Partial<Record<string, string>> = {}) => {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    return [...keys].every((k) => (x[k] ?? "") === (y[k] ?? ""));
  };
  return a.body === b.body && same(a.overrides, b.overrides) && same(a.titles, b.titles);
}

// 欄が変わったときに控えをどうするか: 開いたときと同じなら消す。違っても、利用者が欄に書いていない（ボタンで入れた値だけ）なら控えない
export function draftStep(args: { same: boolean; typed: boolean }): "clear" | "write" | "none" {
  if (args.same) return "clear";
  return args.typed ? "write" : "none";
}
