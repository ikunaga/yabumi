import { isUuid } from "@/lib/uuid";

// 概要の「コンセプトを決める」の帯（4.50）を閉じたプロジェクト。中身はプロジェクトの id だけ（「,」区切り、新しい順に 50 件まで）。1 年。
// DB を変えずに済むよう cookie に置く（その端末だけで覚える。別の端末ではもう一度出る）
export const CONCEPT_HINT_COOKIE = "yabumi_concept_hint_closed";
export const CONCEPT_HINT_MAX_AGE = 365 * 24 * 60 * 60;
const MAX_IDS = 50;

export function parseConceptHintCookie(raw: string | undefined): string[] {
  return (raw ?? "").split(",").filter(isUuid).slice(0, MAX_IDS);
}

// 閉じたプロジェクトを先頭に足した値
export function addConceptHintClosed(raw: string | undefined, projectId: string): string {
  return [projectId, ...parseConceptHintCookie(raw).filter((id) => id !== projectId)].slice(0, MAX_IDS).join(",");
}
