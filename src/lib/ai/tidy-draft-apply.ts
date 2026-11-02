import { SNS, type SnsKey } from "@/lib/sns";

// AI で投稿に整えた案（tidy-draft.ts）。画面でも使うので、サーバーのものは読み込まない
export type TidyOption = { label: string; why: string; drafts: { sns: SnsKey; text: string }[] };

type Composer = { body: string; overrides: Partial<Record<SnsKey, string>> };

// 案を本文と SNS ごとの文面にする。共通の本文は、上限のいちばん大きい SNS の文面（note・Substack など、整えていない SNS にも長い方が入る）。
// ほかの SNS は、文面が本文と違えば SNS ごとの文面にし、同じなら SNS ごとの文面を外す。整えていない SNS の文面はそのまま
export function adoptTidyOption(option: TidyOption, current: Composer): Composer {
  const mainSns = tidyMainSns(option);
  const main = option.drafts.find((d) => d.sns === mainSns);
  if (!main) return current;
  const overrides = { ...current.overrides };
  for (const d of option.drafts) {
    if (d.text === main.text) delete overrides[d.sns];
    else overrides[d.sns] = d.text;
  }
  return { body: main.text, overrides };
}

// 共通の本文に入れる文面の SNS（上限のいちばん大きい SNS）
export function tidyMainSns(option: TidyOption): SnsKey | null {
  const size = (s: SnsKey) => SNS[s].maxLength ?? Infinity;
  return [...option.drafts].sort((a, b) => size(b.sns) - size(a.sns))[0]?.sns ?? null;
}
