import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";

// エラーのときは ?sns= でどの SNS かがわかる（ないときは、最初につないだ Threads として扱う）
const ERRORS: Record<"threads" | "x", Record<string, string>> = {
  threads: {
    not_configured: "Threads の設定（環境変数 THREADS_APP_ID・THREADS_APP_SECRET・APP_URL）が足りないため、つなげません。",
    denied: "Threads の画面でキャンセルされたため、つなぎませんでした。",
    failed: "Threads とつなげませんでした。もう一度お試しください。続くときは Meta のアプリの設定を確認してください。",
  },
  x: {
    not_configured: "X の設定（環境変数 X_CLIENT_ID・X_CLIENT_SECRET・APP_URL）が足りないため、つなげません。",
    denied: "X の画面でキャンセルされたため、つなぎませんでした。",
    failed: "X とつなげませんでした。もう一度お試しください。続くときは X の Developer Console で、アプリの権限（Read and write）と Callback URI を確認してください。",
  },
};
const STATE_ERROR = "接続の確認に失敗しました。時間をおいて、もう一度「つなぐ」から始めてください。";

const CONNECTED: Record<string, string> = { threads: "Threads", x: "X" };

// SNS をつないだ結果（OAuth の受け口から ?connected= / ?sns_error= 付きで戻る）
export function SnsResultBanner({ connected, error, sns }: { connected?: string | string[]; error?: string | string[]; sns?: string | string[] }) {
  if (typeof connected === "string" && CONNECTED[connected]) return <SuccessBanner>{CONNECTED[connected]} をつなぎました。</SuccessBanner>;
  if (typeof error !== "string") return null;
  if (error === "state") return <ErrorBanner>{STATE_ERROR}</ErrorBanner>;
  const message = ERRORS[sns === "x" ? "x" : "threads"][error];
  return message ? <ErrorBanner>{message}</ErrorBanner> : null;
}
