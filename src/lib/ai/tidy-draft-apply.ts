import { SNS, type SnsKey } from "@/lib/sns";

// AI で投稿に整えた案（tidy-draft.ts）。画面でも使うので、サーバーのものは読み込まない
// style: 直しても残った、日本語の決まりに反する言い回し（japanese-style.ts。画面に出し、文面を直したら消す）
export type TidyOption = { label: string; why: string; drafts: { sns: SnsKey; text: string; style?: string[] }[] };

type Composer = { body: string; overrides: Partial<Record<SnsKey, string>> };

// 案を本文と SNS ごとの文面にする（PMO の通しテストで、共通の本文が Instagram の文面に置き換わった件）。
// - 案の文面がどの SNS も同じ: 共通の本文に入れ、その SNS の SNS ごとの文面は外す
// - SNS で違う: 共通の本文は利用者の文のまま残し、案はすべて SNS ごとの文面に入れる（本文の欄に、ある SNS 用のタグや言い回しが入らないように）
// - 元の本文が空（フォーマットの穴だけで整えたなど）: 残すものがないので、上限のいちばん大きい SNS の文面を本文にし、違う SNS だけ SNS ごとの文面にする
// 整えていない SNS の文面はそのまま
export function adoptTidyOption(option: TidyOption, current: Composer): Composer {
  const mainSns = tidyMainSns(option);
  const main = option.drafts.find((d) => d.sns === mainSns);
  if (!main) return current;
  const overrides = { ...current.overrides };
  const allSame = option.drafts.every((d) => d.text === main.text);
  if (allSame || !current.body.trim()) {
    for (const d of option.drafts) {
      if (d.text === main.text) delete overrides[d.sns];
      else overrides[d.sns] = d.text;
    }
    return { body: main.text, overrides };
  }
  for (const d of option.drafts) overrides[d.sns] = d.text;
  return { body: current.body, overrides };
}

// 共通の本文に入れる文面の SNS（上限のいちばん大きい SNS）
export function tidyMainSns(option: TidyOption): SnsKey | null {
  const size = (s: SnsKey) => SNS[s].maxLength ?? Infinity;
  return [...option.drafts].sort((a, b) => size(b.sns) - size(a.sns))[0]?.sns ?? null;
}
