import type { SnsKey } from "@/lib/sns";

// 投稿をつくるの書きかけの控え（src/lib/form-draft.ts。docs/architecture.md の 4.35）で比べる中身: 本文・SNS ごとの文面・タイトル
// hashtags: SNS ごとのタグの欄（書いたままの文字。4.59。前の版の控えにはない）
// step: 控えたときのステップ（docs/design/compose-steps.md の 4.。戻すと同じステップから。比べる中身には入れない）
// images: 添えた画像（上げ済みの id と説明文。並びは配列の順。docs/architecture.md の 4.62。前の版の控えにはない）。
// URL・大きさ・AI の印・見出しの元は控えない（戻すときにサーバーで本人のものか確かめて読み直す）
// text・originalId・edit: 文字が入っているか・元の画像・最後に描き直した元と整え方（4.65。前の版の控えにはない。比べる中身には入れない）
export type DraftImage = {
  id: string;
  altText: string;
  text?: boolean;
  originalId?: string;
  edit?: { kind: string; baseId: string; adjust?: unknown; headline?: unknown };
};
export type PostDraft = {
  body: string;
  overrides: Partial<Record<SnsKey, string>>;
  titles: Partial<Record<SnsKey, string>>;
  hashtags?: Partial<Record<SnsKey, string>>;
  images?: DraftImage[];
  step?: number;
};

// 書き始めたときの値を、比べられる形の文字にする（空の文面・タイトルは無いのと同じ。並びもそろえる）
export function postDraftBase(d: PostDraft): string {
  const tidy = (x: Partial<Record<string, string>> = {}) =>
    Object.fromEntries(
      Object.entries(x)
        .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  // タグ・画像がなければ前の版と同じ文字にする（足す前の控えを、保存し直されたものと見なさないように）
  const hashtags = tidy(d.hashtags);
  const images = (d.images ?? []).map((i) => [i.id, i.altText]);
  return JSON.stringify({ body: d.body, overrides: tidy(d.overrides), titles: tidy(d.titles), ...(Object.keys(hashtags).length ? { hashtags } : {}), ...(images.length ? { images } : {}) });
}

export function samePostDraft(a: PostDraft, b: PostDraft): boolean {
  const same = (x: Partial<Record<string, string>> = {}, y: Partial<Record<string, string>> = {}) => {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    return [...keys].every((k) => (x[k] ?? "") === (y[k] ?? ""));
  };
  // 画像は並びと説明文で比べる（前の版の控えで画像がないときは、画像なしと同じ）
  const imageKey = (d: PostDraft) => JSON.stringify((d.images ?? []).map((i) => [i.id, i.altText]));
  return a.body === b.body && same(a.overrides, b.overrides) && same(a.titles, b.titles) && same(a.hashtags, b.hashtags) && imageKey(a) === imageKey(b);
}

// 欄が変わったときに控えをどうするか: 開いたときと同じなら消す。違っても、利用者が欄に書いていない（ボタンで入れた値だけ）なら控えない
export function draftStep(args: { same: boolean; typed: boolean }): "clear" | "write" | "none" {
  if (args.same) return "clear";
  return args.typed ? "write" : "none";
}
