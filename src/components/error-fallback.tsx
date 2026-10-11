"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

// 画面の読み込みや表示で思わぬエラーが起きたときの表示（error.tsx・global-error.tsx から使う）。
// 本番では理由の文はブラウザに届かない（Next が隠す）ので、利用者には「もう一度」と戻り先だけを出し、番号はサーバーのログと照らし合わせる用に添える
export function ErrorFallback({
  error,
  retry,
  backHref = "/projects",
  backLabel = "プロジェクト一覧へ",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  backHref?: string;
  backLabel?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-16 text-center">
      <h1 className="font-heading text-2xl font-bold">うまく表示できませんでした</h1>
      <p className="max-w-[480px] text-[14px] leading-7 text-muted">
        一時的な不具合の可能性があります。少し待ってから「もう一度読み込む」を押してください。入力の途中だった内容は、保存していなければ消えていることがあります。
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button type="button" onClick={() => retry()}>
          もう一度読み込む
        </Button>
        <ButtonLink href={backHref} variant="secondary">
          {backLabel}
        </ButtonLink>
      </div>
      {error.digest && <p className="text-xs text-muted">エラーの番号: {error.digest}</p>}
    </div>
  );
}
