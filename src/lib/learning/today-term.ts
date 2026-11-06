// 概要の「今日の用語」の語の選び方（docs/architecture.md の 4.47）。DB を読まない純粋な関数（テストしやすいように）。
// 1. その人の状況に合う語のうち、まだ読んでいない語（状況の並び順・語の並び順）
// 2. なければ、まだ読んでいない語を用語集の順に
// 3. 全部読んだら、読んだのが古い順（last_read_at の古いもの）
// 同じ日は同じ語にするため、その日に選んだ語はサーバーが覚えておき（今日の分があればそれを使う）、この関数は日が変わったときだけ呼ぶ

export type LearningSignals = {
  // アカウント設計の 3 つ（目的・届けたい相手・投稿の柱）がまだそろっていない
  planIncomplete: boolean;
  // 短縮リンクを作った
  usedShortLink: boolean;
  // ロードマップに目標かやることがある
  hasRoadmap: boolean;
  // Instagram をつないだ
  connectedInstagram: boolean;
};

// 状況ごとに先に出す語（用語集の key）。並びは優先の順
export const SITUATION_TERMS: { signal: keyof LearningSignals; keys: string[] }[] = [
  { signal: "planIncomplete", keys: ["persona", "contentPillar", "toneAndManner"] },
  { signal: "usedShortLink", keys: ["marketingFunnel", "conversion"] },
  { signal: "hasRoadmap", keys: ["kgi", "milestone", "kpi"] },
  { signal: "connectedInstagram", keys: ["snsTraits"] },
];

export type TermRead = { key: string; lastReadAt: string };

export function pickTodayTerm(args: { keys: readonly string[]; reads: readonly TermRead[]; signals: LearningSignals }): string | null {
  const { keys, reads, signals } = args;
  if (keys.length === 0) return null;
  const known = new Set(keys);
  const read = new Map(reads.filter((r) => known.has(r.key)).map((r) => [r.key, r.lastReadAt]));
  const unread = (k: string) => known.has(k) && !read.has(k);

  for (const s of SITUATION_TERMS) {
    if (!signals[s.signal]) continue;
    const k = s.keys.find(unread);
    if (k) return k;
  }
  const next = keys.find(unread);
  if (next) return next;
  // 全部読んだ: 読んだのが古い順（同じ日時なら用語集の順）
  return [...keys].sort((a, b) => (read.get(a)! < read.get(b)! ? -1 : read.get(a)! > read.get(b)! ? 1 : keys.indexOf(a) - keys.indexOf(b)))[0];
}
