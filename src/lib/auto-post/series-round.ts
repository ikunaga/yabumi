import { buildFormatRoundRequest, screenRoundProposals, type CallFormatRound, type RoundDrop, type RoundDropReason, type RoundProposal } from "@/lib/ai/format-round-ai";
import { AiBudgetDenied } from "@/lib/ai/budget";
import { ROUNDS_FOR_AI, type FormatRound } from "@/lib/post-formats/series";
import type { PostFormat } from "@/lib/post-formats/schema";
import type { PlanData } from "@/lib/plan/schema";

// 自動投稿のシリーズの、次の回の案（2026-11-28。前は AI を 1 回呼ぶだけで、使える案がなければ回を飛ばしていた）。
// 使える案が出るまで、決めた回数と時間の内で作り直す。2 回目からは、前の返事で使えなかった案と理由を AI に伝える。
// 最後まで駄目なときは、試した回数・止まった理由・モデル・捨てた理由ごとの数・かかった秒数を、回の理由（reason_detail）とログに残す（本文は残さない）

// 作り直しを含めて呼ぶ回数の上限
export const SERIES_ROUND_ATTEMPTS = 3;
// シリーズの案に使う時間の上限（ミリ秒）。これをこえる見込みなら、新しく呼ばない。
// 1 回はおよそ 15〜25 秒（2026-11-28 に本物の AI で測った）。2 回目以降は、残りが SERIES_ROUND_MIN_LEFT_MS より少なければ呼ばない
export const SERIES_ROUND_BUDGET_MS = 75_000;
export const SERIES_ROUND_MIN_LEFT_MS = 30_000;

// 本番の回で、作り直しても使える案が出なかった（投げて、ジョブに「作れなかった回」としてやり直させる。message は attemptsDetail の文）
export class SeriesRoundFailed extends Error {
  override name = "SeriesRoundFailed";
}

export type RoundAttempt = { stop: string; model: string; dropped: Partial<Record<RoundDropReason, number>>; ms: number; error?: string };
export type ProposeRoundResult =
  | { ok: true; proposal: RoundProposal; attempts: RoundAttempt[] }
  | { ok: false; detail: string; attempts: RoundAttempt[] };

type Input = {
  project: Parameters<typeof buildFormatRoundRequest>[0]["project"];
  plan: PlanData;
  format: Pick<PostFormat, "name" | "body" | "series" | "image">;
  rounds: Pick<FormatRound, "values">[];
  fixed: Record<string, string>;
  used: Set<string>;
};

const DROP_TEXT: Record<RoundDropReason, string> = {
  schema: "形違い",
  missing: "変数不足",
  count: "数違い",
  dup_past: "前と同じ",
  dup_self: "案どうし同じ",
};

// 作り直しで AI に伝える文（前の返事で使えなかった案と理由。案の言葉は AI が書いたもの）。画面には出さない
export function retryNote(stop: string, dropped: RoundDrop[]): string {
  const lines: string[] = [];
  // ui-wording-ignore: AI への指示（画面に出さない）
  if (stop === "max_tokens") lines.push("- 前の返事は、途中で切れて読めませんでした。考えすぎずに、短く答えてください");
  // ui-wording-ignore: AI への指示（画面に出さない）
  else if (stop === "refusal" || stop === "none") lines.push("- 前の返事を読めませんでした。決められた形（JSON）だけで答えてください");
  for (const d of dropped.slice(0, 6)) {
    const t = d.title ? `「${d.title}」` : "案";
    // ui-wording-ignore: AI への指示（画面に出さない）
    if (d.reason === "dup_past") lines.push(`- ${t}は、もう出した回と重なります。<past> にない、別のものにしてください`);
    // ui-wording-ignore: AI への指示（画面に出さない）
    else if (d.reason === "dup_self") lines.push(`- ${t}は、ほかの案と重なります。案どうしで別のものにしてください`);
    // ui-wording-ignore: AI への指示（画面に出さない）
    else if (d.reason === "count") lines.push(`- ${t}の {${d.varName}} は、「・」で区切ると ${d.got} 個でした。ちょうど ${d.want} 個にし、言葉の中に「・」を入れないでください`);
    // ui-wording-ignore: AI への指示（画面に出さない）
    else if (d.reason === "missing") lines.push(`- ${t}は、変数 {${d.varName}} が入っていませんでした。AI が考える変数をすべて入れてください`);
    // ui-wording-ignore: AI への指示（画面に出さない）
    else lines.push("- 前の返事は、決められた形になっていませんでした。決められた形（JSON）だけで答えてください");
  }
  return lines.join("\n");
}

const countDrops = (dropped: RoundDrop[]) => dropped.reduce<Partial<Record<RoundDropReason, number>>>((a, d) => ({ ...a, [d.reason]: (a[d.reason] ?? 0) + 1 }), {});

// 回の理由に残す文（DB の reason_detail は 200 字まで）。1 文目は利用者向け、そのあとは運営者が原因を追うための数字。本文は入れない。
// 例: 「前と重ならない次の投稿の案を出せませんでした。3 回: refusal opus-5-5 18 秒 / max_tokens 返事なし sonnet-5-5 20 秒 / end_turn opus-5-5 前と同じ3 21 秒」
export const ROUND_FAILED_TEXT = "前と重ならない次の投稿の案を出せませんでした。";
export function attemptsDetail(attempts: RoundAttempt[]): string {
  const parts = attempts.map((a) => {
    const drops = Object.entries(a.dropped).map(([k, n]) => `${DROP_TEXT[k as RoundDropReason]}${n}`);
    return [a.stop, a.model.replace(/^claude-/, ""), ...drops, a.error ? `例外 ${a.error}` : "", `${Math.round(a.ms / 1000)} 秒`].filter(Boolean).join(" ");
  });
  return [...`${ROUND_FAILED_TEXT}${attempts.length} 回: ${parts.join(" / ")}`].slice(0, 200).join("");
}

// call は予約つきの呼び出し（budgeted）。枠で断られたとき（AiBudgetDenied）は、作り直さずにそのまま投げる（呼ぶ側の扱いのまま）
export async function proposeRound(input: Input, call: CallFormatRound, opts: { now?: () => number; budgetMs?: number } = {}): Promise<ProposeRoundResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const until = started + (opts.budgetMs ?? SERIES_ROUND_BUDGET_MS);
  const attempts: RoundAttempt[] = [];
  let retry: string | undefined;
  let lastError: unknown;
  for (let i = 0; i < SERIES_ROUND_ATTEMPTS; i++) {
    if (i > 0 && until - now() < SERIES_ROUND_MIN_LEFT_MS) break;
    const t0 = now();
    const req = buildFormatRoundRequest({ project: input.project, plan: input.plan, format: input.format, past: input.rounds.slice(0, ROUNDS_FOR_AI), wish: "", fixed: input.fixed, retry });
    try {
      const r = await call(req);
      const stop = String(r.stopReason ?? "none");
      // 拒否と、読める返事がないときは使わない。それ以外（途中で切れた・別のモデルに回った など）は、形が正しく読めた案だけを使う
      const { proposals, dropped } = stop === "refusal" || r.output == null ? { proposals: [], dropped: [] as RoundDrop[] } : screenRoundProposals(r.output, input.format, input.used, input.fixed);
      attempts.push({ stop: r.output == null && stop !== "refusal" ? `${stop} 返事なし` : stop, model: r.model, dropped: countDrops(dropped), ms: now() - t0 });
      if (proposals.length) return { ok: true, proposal: proposals[0], attempts };
      retry = retryNote(r.output == null && stop === "end_turn" ? "none" : stop, dropped);
    } catch (e) {
      if (e instanceof AiBudgetDenied) throw e;
      lastError = e;
      attempts.push({ stop: "error", model: "", dropped: {}, ms: now() - t0, error: e instanceof Error ? e.name : "unknown" });
      retry = undefined;
    }
  }
  // 1 回も返事がなかった（呼び出しの失敗だけ）ときは、前と同じく投げる（ジョブが回を「作れなかった」にして、やり直す）
  if (attempts.length && attempts.every((a) => a.stop === "error")) throw lastError;
  return { ok: false, detail: attemptsDetail(attempts), attempts };
}
