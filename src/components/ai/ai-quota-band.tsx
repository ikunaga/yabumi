import { AI_LOW_TEXT, aiBlockedText, type AiBlockedWords, type AiBudgetState } from "@/lib/ai/budget-status-text";

// AI を使う画面の上に出す、枠の帯（2026-11-21 オーナーの依頼）。使えないときは朱の印の帯、残り少しのときは小さい 1 行。ふだんは何も出さない
// words: その画面で止まっていること・できること（なければ相談の画面の言葉）
export function AiQuotaBand({ state, words }: { state: AiBudgetState | null; words?: AiBlockedWords }) {
  if (!state) return null;
  const blocked = aiBlockedText(state, words);
  if (blocked) {
    return (
      <p role="status" className="rounded-lg border border-line bg-surface px-4 py-3 text-[15px] leading-[1.7]">
        <span className="mr-1.5 font-bold text-signal">●</span>
        {blocked}
      </p>
    );
  }
  if (state.low) return <p className="text-sm text-muted">{AI_LOW_TEXT}</p>;
  return null;
}
