import "server-only";
import { isGlossaryKey } from "@/lib/glossary/terms";

// 用語集の詳細ページを開いた（読んだ）と記録する（学びの記録。4.47）。用語集にある key だけ。本人は DB の関数が auth.uid() から取る
export async function recordTermRead(key: string): Promise<void> {
  if (!isGlossaryKey(key)) return;
  // Supabase の読み込みは呼ばれたときに（用語集のページを読み込むだけのテストで、環境変数を求めないように）
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_learning_term_read", { p_term_key: key });
  if (error) console.error("[recordTermRead]", error.message);
}
