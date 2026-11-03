"use client";

import { useEffect } from "react";
import { recordTermRead } from "@/lib/learning/actions";

// 用語集の詳細ページを読んだと記録する（学びの記録。4.47）。
// ページを描くとき（GET）に書くと、ほかのサイトの img や先読み（prefetch）でも記録されてしまうので、画面を描いたあとに server action で送る
// （セキュリティ確認 2026-11-03 の L3）。記録できなくてもページはそのまま
export function RecordTermRead({ termKey }: { termKey: string }) {
  useEffect(() => {
    recordTermRead(termKey).catch(() => {});
  }, [termKey]);
  return null;
}
