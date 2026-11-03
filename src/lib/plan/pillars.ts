import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { PlanData } from "./schema";

// 投稿の柱を SNS ごとに使い分ける（2026-11-03 オーナーの要望。docs/architecture.md の 4.39）。
// 柱ごとに「使う SNS」を持ち、空は「すべての SNS」（前の版の設計はそのまま動く）。
// 割合は SNS ごとに、その SNS に付いた柱の中で数える（例: X は 開発 50%・生き方 50%、Instagram は 映画 60%・音楽 40%）。
// AI の材料（ネタ・整える・相談・見直し・画像の案）と「設計を見返す」は、送り先の SNS に付いた柱だけを使う

export type Pillar = PlanData["pillars"]["items"][number];

export function namedPillars(items: readonly Pillar[]): Pillar[] {
  return items.filter((p) => p.name.trim());
}

export function pillarAppliesTo(p: Pick<Pillar, "sns">, sns: SnsKey): boolean {
  return p.sns.length === 0 || p.sns.includes(sns);
}

// その SNS で使う柱（名前のあるものだけ）
export function pillarsFor(items: readonly Pillar[], sns: SnsKey): Pillar[] {
  return namedPillars(items).filter((p) => pillarAppliesTo(p, sns));
}

// SNS ごとに分けているか（使う SNS を選んだ柱が 1 つでもあるか）
export function isSplitBySns(items: readonly Pillar[]): boolean {
  return namedPillars(items).some((p) => p.sns.length > 0);
}

// 柱の「使う SNS」の呼び方（例: 「X・Threads」「すべての SNS」）
export function pillarSnsLabel(p: Pick<Pillar, "sns">): string {
  return p.sns.length === 0 ? "すべての SNS" : p.sns.map((s) => SNS[s].label).join("・");
}

// SNS ごとにまとめて見るときの SNS: 柱で選んだ SNS と、ほかで使っている SNS（役割を書いた・つないだ・週の回数を決めた）を SNS_KEYS の順に
export function pillarViewSns(items: readonly Pillar[], inUse: readonly SnsKey[]): SnsKey[] {
  const picked = new Set<SnsKey>([...inUse, ...namedPillars(items).flatMap((p) => p.sns)]);
  return SNS_KEYS.filter((k) => picked.has(k));
}

export type SnsPillars = { sns: SnsKey; pillars: Pillar[]; total: number };

// SNS ごとの柱と割合の合計
export function pillarsBySns(items: readonly Pillar[], snsList: readonly SnsKey[]): SnsPillars[] {
  return snsList.map((sns) => {
    const pillars = pillarsFor(items, sns);
    return { sns, pillars, total: pillars.reduce((n, p) => n + (p.share ?? 0), 0) };
  });
}

const pillarLine = (p: Pillar) => `- 柱「${p.name.trim()}」${p.share !== null ? `（${p.share}%）` : ""}${p.example.trim() ? ` 例: ${p.example.trim()}` : ""}`;

// AI に渡す柱の行。targets は送り先の SNS（空ならわからない: すべての柱を、使う SNS を添えて出す）。
// SNS ごとに分けていなければ、前と同じ 1 つの一覧
export function pillarPromptLines(items: readonly Pillar[], targets: readonly SnsKey[]): string[] {
  const named = namedPillars(items);
  if (named.length === 0) return ["投稿の柱はまだ決まっていません。"];
  if (!isSplitBySns(named)) return named.map(pillarLine);
  if (targets.length === 0) {
    return [
      "投稿の柱は SNS ごとに使い分けています（割合は、その SNS に付いた柱の中での割合）:",
      ...named.map((p) => `${pillarLine(p)}（使う SNS: ${pillarSnsLabel(p)}）`),
    ];
  }
  const lines = ["投稿の柱は SNS ごとに使い分けています。その SNS のネタ・下書きは、その SNS に付いた柱だけから選びます（割合は、その SNS に付いた柱の中での割合）:"];
  for (const { sns, pillars } of pillarsBySns(named, targets)) {
    lines.push(`${SNS[sns].label}（${sns}）の柱:`);
    lines.push(...(pillars.length ? pillars.map(pillarLine) : ["- （この SNS に付いた柱はありません。柱にとらわれず、届けたい相手に合うネタにする）"]));
  }
  return lines;
}

// ネタの柱（AI が書いた名前）が、その SNS で使えるか。設計にない名前（柱が決まっていないときの仮の名前など）は、どの SNS でも使える
export function ideaPillarAllows(items: readonly Pillar[], pillarName: string, sns: SnsKey): boolean {
  const p = namedPillars(items).find((x) => x.name.trim() === pillarName.trim());
  return !p || pillarAppliesTo(p, sns);
}
