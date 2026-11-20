// 伸びた投稿の判定（docs/design/winning-posts.md の 2.）。AI は使わず、決まりで判定する。
// 同じ SNS の、直近 90 日の自分の投稿の中央値と比べる。送って 7 日たったものだけを見る。
// 自動の投稿の「伸びた投稿の言い直し（rerun）」を作るときも、この判定で元の投稿を選ぶ（winning-posts.md の 1.）
import type { SnsKey } from "@/lib/sns";
import { BAND_INFO, bandOfHour } from "./time-bands";

// 送ってから数字が落ち着くまでの日数と、見る期間（日）
export const SETTLE_DAYS = 7;
export const LOOKBACK_DAYS = 90;
// SNS ごとに、数字のある投稿がこれだけそろうまでは判定しない
export const MIN_POSTS = 6;
// 中央値の何倍から「伸びた」と言うか・SNS ごとに上から何本まで・全体で何本まで出すか
export const MIN_RATIO = 1.5;
export const TOP_PER_SNS = 3;
export const MAX_WINNERS = 5;
// 小さい数どうしの「2 倍」は偶然なので、下限を置く（推測。数字がたまったら直す）
export const FLOOR = { views: 100, clicks: 5 } as const;

// X の数字は判定に使わない。X の開発者規約で、X の API で得たデータ（その派生物を含む）を第三者（AI の会社）に渡すことが
// 許されていると確かめられなかったため（Developer Agreement の I.12・III.A(d)・II.A.1、Developer Policy の Content redistribution。2026-11-19 に調べた）
export const EXCLUDED_SNS: readonly SnsKey[] = ["x"];

export type WinnerMetric = "views" | "clicks";

// 見た人にしてほしいこと（設計の goalType）で、見る数字を決める。知ってもらう・フォローは見られた数、それ以外は押された数
export function metricForGoal(goalType: string | null | undefined): WinnerMetric {
  return goalType === "awareness" || goalType === "follow" || !goalType ? "views" : "clicks";
}

export type TargetNumbers = {
  targetId: string;
  postId: string;
  sns: SnsKey;
  publishedAt: string; // ISO
  views: number | null;
  clicks: number | null; // 短縮リンクがなければ null
};

export type SnsJudge = {
  sns: SnsKey;
  metric: WinnerMetric; // その SNS で実際に見た数字
  posts: number; // 数字のある投稿の数
  median: number | null;
  need: number; // あと何本で判定できるか（0 なら判定した）
};

export type WinnerHit = { sns: SnsKey; metric: WinnerMetric; value: number; median: number; ratio: number };
export type Winner = { postId: string; publishedAt: string; best: WinnerHit; hits: WinnerHit[] };
export type WinnersJudge = { metric: WinnerMetric; bySns: SnsJudge[]; winners: Winner[] };

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 倍率は小数 1 桁（「2.4 倍」）
export const roundRatio = (r: number) => Math.round(r * 10) / 10;

export function judgeWinners(rows: TargetNumbers[], opts: { metric: WinnerMetric; now: Date }): WinnersJudge {
  const nowMs = opts.now.getTime();
  const from = nowMs - LOOKBACK_DAYS * 86_400_000;
  const until = nowMs - SETTLE_DAYS * 86_400_000;
  const inRange = rows.filter((r) => {
    const t = Date.parse(r.publishedAt);
    return !EXCLUDED_SNS.includes(r.sns) && Number.isFinite(t) && t >= from && t <= until;
  });
  const bySns: SnsJudge[] = [];
  const hits = new Map<string, { publishedAt: string; hits: WinnerHit[] }>();
  const snsList = [...new Set(inRange.map((r) => r.sns))];
  for (const sns of snsList) {
    const mine = inRange.filter((r) => r.sns === sns);
    const withClicks = mine.filter((r) => r.clicks !== null);
    // 押された数で見るのは、その SNS で短縮リンクを付けた投稿がそろっているときだけ。そろわなければ見られた数で見る
    const metric: WinnerMetric = opts.metric === "clicks" && withClicks.length >= MIN_POSTS ? "clicks" : "views";
    const scored = mine.map((r) => ({ r, v: metric === "clicks" ? r.clicks : r.views })).filter((x): x is { r: TargetNumbers; v: number } => typeof x.v === "number" && Number.isFinite(x.v) && x.v >= 0);
    const med = median(scored.map((x) => x.v));
    const need = Math.max(0, MIN_POSTS - scored.length);
    bySns.push({ sns, metric, posts: scored.length, median: med, need });
    if (need > 0 || med === null) continue;
    const top = scored
      .filter((x) => x.v >= FLOOR[metric] && (med === 0 ? x.v > 0 : x.v / med >= MIN_RATIO))
      .sort((a, b) => b.v - a.v)
      .slice(0, TOP_PER_SNS);
    for (const x of top) {
      // 中央値が 0 のときは、下限で割った倍率にする（0 で割らない）
      const ratio = roundRatio(x.v / Math.max(med, med === 0 ? FLOOR[metric] / MIN_RATIO : med));
      const hit: WinnerHit = { sns, metric, value: x.v, median: med, ratio };
      const cur = hits.get(x.r.postId) ?? { publishedAt: x.r.publishedAt, hits: [] };
      cur.hits.push(hit);
      if (x.r.publishedAt < cur.publishedAt) cur.publishedAt = x.r.publishedAt;
      hits.set(x.r.postId, cur);
    }
  }
  const winners: Winner[] = [...hits.entries()]
    .map(([postId, h]) => {
      const sorted = [...h.hits].sort((a, b) => b.ratio - a.ratio);
      return { postId, publishedAt: h.publishedAt, best: sorted[0], hits: sorted };
    })
    .sort((a, b) => b.best.ratio - a.best.ratio || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_WINNERS);
  bySns.sort((a, b) => a.sns.localeCompare(b.sns));
  return { metric: opts.metric, bySns, winners };
}

// 「いつもの 2.4 倍見られました」など。AI に送るのもこの言い方（そのままの数字は送らない）
export function hitText(h: Pick<WinnerHit, "metric" | "ratio">): string {
  return `いつもの ${h.ratio} 倍${h.metric === "clicks" ? "押されました" : "見られました"}`;
}

// 伸びた投稿を送った時間帯の時刻（自動の投稿の「いつ」の初期値。日本時間。投稿をつくるの「この時間帯に入れる」とそろえる）
export function winnerTime(publishedAt: string): { time: string; reason: string } {
  const hour = (new Date(publishedAt).getUTCHours() + 9) % 24;
  const b = BAND_INFO[bandOfHour(hour)];
  return { time: b.at, reason: `伸びた投稿を送った時間帯（${b.label}・${b.hours}）にします` };
}

// 自動の投稿の「何を」に出す「伸びた投稿から」のカードの 1 行（docs/design/winning-posts.md の 3. の A）。出すものがなければ null
export function winnersCardText(j: Pick<WinnersJudge, "bySns" | "winners">, label: (s: SnsKey) => string): { text: string; off: boolean } | null {
  if (j.winners.length) {
    const best = j.winners[0].best;
    const what = `いつもの ${best.ratio} 倍${best.metric === "clicks" ? "押された" : "見られた"}投稿`;
    return { text: `${label(best.sns)} で${what}${j.winners.length > 1 ? `など ${j.winners.length} 本` : ""}があります`, off: false };
  }
  const waiting = j.bySns.filter((s) => s.need > 0).sort((a, b) => a.need - b.need)[0];
  if (waiting) return { text: `${label(waiting.sns)} にあと ${waiting.need} 本送ると、伸びた投稿がわかります`, off: true };
  if (j.bySns.length) return { text: "いつもの 1.5 倍を超えた投稿は、まだありません", off: true };
  return { text: "送って 7 日たった投稿の数字が、まだありません", off: true };
}
