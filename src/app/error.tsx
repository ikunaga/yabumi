"use client";

import { ErrorFallback } from "@/components/error-fallback";

// ルートのレイアウトより内側で起きた思わぬエラー（プロジェクトの中は projects/[id]/error.tsx が先に受ける）
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col">
      <ErrorFallback error={error} retry={retry} />
    </main>
  );
}
