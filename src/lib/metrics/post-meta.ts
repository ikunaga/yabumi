import { isSnsKey, SNS_KEYS, type SnsKey } from "@/lib/sns";

export type PostMeta = { title: string; sentAt: string | null; sns: SnsKey[] };

type Row = { body: string; planned_at: string | null; post_targets: { sns: string; status: string; published_at: string | null }[] };

// 分析の「よく見られた投稿」「クリックの多い投稿」の行に出すもの: 本文の 1 行目、送った日時（SNS ごとに違えばいちばん早いもの。
// まだ送っていなければ予約の日時）、送った SNS（並びは SNS の決まった順）。同じ書き出しの投稿を見分けられるように
export function postMeta(row: Row | undefined): PostMeta {
  if (!row) return { title: firstLine(""), sentAt: null, sns: [] };
  const sent = row.post_targets.filter((t) => t.status === "published" && t.published_at);
  const sentAt = sent.map((t) => t.published_at!).sort()[0] ?? row.planned_at;
  const sns = SNS_KEYS.filter((s) => sent.some((t) => isSnsKey(t.sns) && t.sns === s));
  return { title: firstLine(row.body), sentAt, sns };
}

export function firstLine(body: string) {
  const line = body.split("\n").find((l) => l.trim()) ?? "（本文なし）";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}
