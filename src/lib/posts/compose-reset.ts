import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";

// 投稿をつくるの「リセット」と、下書きの「保存した内容に戻す」（docs/architecture.md の 4.38）。
// 開いたときの状態（新しい投稿は空、下書きは保存した内容）と比べて、戻すと消えるもの・戻るものを並べる

export type ComposeSnapshot = {
  body: string;
  overrides: Partial<Record<SnsKey, string>>;
  titles: Partial<Record<SnsKey, string>>;
  // 添えた画像の id（並び順も見る）
  imageIds: string[];
  plannedAt: string;
  targets: SnsKey[];
  shortLinks: boolean;
  // ネタ帳から本文に入れたメモ（保存すると「投稿にした」の印が付く）
  noteIds: string[];
};

// 戻すと変わるものを、モーダルに出す短い言葉で。何もなければ空（ボタンを出さない）。
// saved: 保存済みの下書き（「〜の変更」と書く。新しい投稿は、入っているものをそのまま書く）
export function composeChanges(initial: ComposeSnapshot, now: ComposeSnapshot, { saved }: { saved: boolean }): string[] {
  const out: string[] = [];
  const changed = (a: Partial<Record<SnsKey, string>>, b: Partial<Record<SnsKey, string>>) =>
    SNS_KEYS.filter((s) => (a[s] ?? null) !== (b[s] ?? null));
  const labels = (keys: SnsKey[]) => keys.map((s) => SNS[s].label).join("・");

  if (now.body !== initial.body) out.push(saved ? "本文の変更" : "本文");
  const overrides = changed(initial.overrides, now.overrides);
  if (overrides.length) out.push(`SNS ごとの文面（${labels(overrides)}）`);
  const titles = changed(initial.titles, now.titles).filter((s) => (now.titles[s] ?? "") !== (initial.titles[s] ?? ""));
  if (titles.length) out.push(`${labels(titles)} のタイトル`);
  if (now.imageIds.join() !== initial.imageIds.join()) {
    out.push(saved || initial.imageIds.length ? "添えた画像の変更" : `添えた画像 ${now.imageIds.length} 枚`);
  }
  if (now.plannedAt !== initial.plannedAt) out.push(saved || initial.plannedAt ? "送る日時の変更" : "送る日時");
  if ([...now.targets].sort().join() !== [...initial.targets].sort().join()) out.push(saved ? "送り先の選び直し" : "送り先の選び直し（最初の選び方に戻します）");
  if (now.shortLinks !== initial.shortLinks) out.push("短縮リンクのオン・オフ");
  if (now.noteIds.length) out.push(`ネタ帳のメモ ${now.noteIds.length} 件に「投稿にした」の印を付ける予定`);
  return out;
}
