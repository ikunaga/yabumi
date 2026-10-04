import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";

const ERRORS: Record<string, string> = {
  not_configured: "Threads の設定（環境変数 THREADS_APP_ID・THREADS_APP_SECRET・APP_URL）が足りないため、つなげません。",
  denied: "Threads の画面でキャンセルされたため、つなぎませんでした。",
  state: "接続の確認に失敗しました。時間をおいて、もう一度「つなぐ」から始めてください。",
  failed: "Threads とつなげませんでした。もう一度お試しください。続くときは Meta のアプリの設定を確認してください。",
};

// SNS をつないだ結果（OAuth の受け口から ?connected= / ?sns_error= 付きで戻る）
export function SnsResultBanner({ connected, error }: { connected?: string | string[]; error?: string | string[] }) {
  if (connected === "threads") return <SuccessBanner>Threads をつなぎました。</SuccessBanner>;
  if (typeof error === "string" && ERRORS[error]) return <ErrorBanner>{ERRORS[error]}</ErrorBanner>;
  return null;
}
