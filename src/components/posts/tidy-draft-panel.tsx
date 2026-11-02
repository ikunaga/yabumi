"use client";

import { useState, useTransition } from "react";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { overLimit } from "@/lib/ai/shorten";
import { tidyPostDraft } from "@/lib/ai/tidy-draft-actions";
import { adoptTidyOption, type TidyOption } from "@/lib/ai/tidy-draft-apply";
import { isManualSns, SNS, type SnsKey } from "@/lib/sns";

type Composer = { body: string; overrides: Partial<Record<SnsKey, string>> };

type Props = {
  projectId: string;
  aiEnabled: boolean;
  // いまの本文と SNS ごとの文面
  current: Composer;
  // 整える SNS（送り先に選んだもの）
  sns: SnsKey[];
  // 本文と SNS ごとの文面を入れ替える
  onReplace: (next: Composer) => void;
};

// AI で投稿に整える（docs/architecture.md の 4.34）: 声で入れた話し言葉などを、言いたいことを 1 つに絞って SNS ごとの字数に収めた案にする。
// 案を選ぶと本文と SNS ごとの文面に入り、「元に戻す」で整える前の文に戻せる
export function TidyDraftPanel({ projectId, aiEnabled, current, sns, onReplace }: Props) {
  const [options, setOptions] = useState<TidyOption[] | null>(null);
  // 整える前の文（案を使ったときに覚え、「元に戻す」で戻す）
  const [original, setOriginal] = useState<Composer | null>(null);
  const [adopted, setAdopted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 案を使ったあとに整え直すときは、整える前の文から
  const source = original?.body ?? current.body;
  const hasText = source.trim() !== "";
  // note・Substack（長い記事）は整えない
  const hasSns = sns.some((s) => !isManualSns(s));

  const run = () =>
    startTransition(async () => {
      setError(null);
      const res = await tidyPostDraft(projectId, { text: source, sns });
      if (res.error || !res.options) {
        setError(res.error ?? "うまくいきませんでした。");
        return;
      }
      setOptions(res.options);
      setAdopted(null);
    });

  function adopt(i: number) {
    const base = original ?? current;
    if (!original) setOriginal(current);
    onReplace(adoptTidyOption(options![i], base));
    setAdopted(i);
  }

  function restore() {
    if (!original) return;
    onReplace(original);
    setOriginal(null);
    setAdopted(null);
  }

  const showSns = (options?.[0]?.drafts.length ?? 0) > 1;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="tidy-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id="tidy-heading" className="sr-only">
          AI で投稿に整える
        </h2>
        {aiEnabled ? (
          <Button type="button" variant="secondary" size="sm" disabled={pending || !hasText || !hasSns} onClick={run}>
            {pending ? "整えています…" : options ? "もう一度整える" : "AI で投稿に整える"}
          </Button>
        ) : (
          <NotReadyButton variant="secondary" size="sm">
            AI で投稿に整える
          </NotReadyButton>
        )}
        <span className="text-xs text-muted">{!hasText ? "本文を話すか書くと押せます" : !hasSns ? "送り先の SNS（note・Substack 以外）を選ぶと押せます" : "1 回 5〜15 円ほど"}</span>
        <HelpTip label="AI で投稿に整える">
          話した言葉や思いつくままに書いた文から、言いたいことを 1 つに絞り、選んだ SNS ごとの字数に収めた案を 2〜3 個出します。最初の 1 行で引きつける・問いかけで終えるなど、形の違う案から選べます。あなたが言っていないこと（数字・できごと・感想）は足しません。口調とやらないこと、ハッシュタグはアカウント設計に合わせます。AI はいまはやっている言葉や話題を知らない（その時々のデータを見ていない）ので、はやりには合わせません。1 回 5〜15 円ほどかかります。
        </HelpTip>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {adopted !== null && options?.[adopted] && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-primary-soft px-3 py-2 text-sm text-fg" role="status">
          <span>
            「{options[adopted].label}」の案を本文に入れました。直してから送れます。
          </span>
          <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={restore}>
            元に戻す
          </button>
        </p>
      )}

      {options && (
        <ul className="flex flex-col gap-3">
          {options.map((o, i) => (
            <li key={i} className={`flex flex-col gap-2 rounded-lg border bg-surface p-4 ${adopted === i ? "border-primary" : "border-line"}`}>
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-bold text-fg">{o.label}</span>
                  {o.why && <span className="text-[13px] leading-[1.7] text-muted">{o.why}</span>}
                </div>
                {adopted === i ? (
                  <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">使っています</span>
                ) : (
                  <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => adopt(i)}>
                    この案を使う
                  </Button>
                )}
              </div>
              {o.drafts.map((d) => {
                const over = overLimit(d.sns, d.text);
                return (
                  <div key={d.sns} className="flex flex-col gap-1 border-t border-line pt-2">
                    {showSns && <span className="text-xs font-semibold text-muted">{SNS[d.sns].label}</span>}
                    <p className="text-[15px] leading-[1.75] whitespace-pre-wrap text-fg">{d.text}</p>
                    {over > 0 && (
                      <p className="text-[13px] font-semibold text-danger">
                        {SNS[d.sns].label} の上限を {over} 字超えています。使ったあとで縮めてください。
                      </p>
                    )}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
