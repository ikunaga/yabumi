import { SuccessBanner } from "@/components/ui/feedback";
import { consultClosedText } from "@/lib/ai/consult-closed";

// 相談を終えて戻ってきたときの知らせ（分析・概要・ロードマップ・相談の一覧）
export function ConsultClosedBanner({ done, items }: { done: unknown; items: unknown }) {
  const text = consultClosedText(done, items);
  return text ? <SuccessBanner>{text}</SuccessBanner> : null;
}
