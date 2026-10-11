import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";

// エラーのときは ?sns= でどの SNS かがわかる（ないときは、最初につないだ Threads として扱う）
type BannerSns = "threads" | "x" | "instagram" | "facebook";

const ERRORS: Record<BannerSns, Record<string, string>> = {
  threads: {
    not_configured: "Threads の設定（環境変数 THREADS_APP_ID・THREADS_APP_SECRET・APP_URL）が足りないため、つなげません。",
    denied: "Threads の画面でキャンセルされたため、つなぎませんでした。",
    failed: "Threads とつなげませんでした。もう一度お試しください。続くときは Meta のアプリの設定を確認してください。",
  },
  instagram: {
    not_configured: "Instagram の設定（環境変数 INSTAGRAM_APP_ID・INSTAGRAM_APP_SECRET・APP_URL）が足りないため、つなげません。",
    denied: "Instagram の画面でキャンセルされたため、つなぎませんでした。",
    not_professional:
      "このアカウントはプロアカウントではないため、つなげませんでした。Instagram のアプリの「設定とアクティビティ」→「アカウントの種類とツール」→「プロアカウントに切り替える」で切り替えてから、もう一度つないでください（無料です）。",
    failed: "Instagram とつなげませんでした。もう一度お試しください。続くときは、Meta のアプリの設定（リダイレクト URI、Instagram テスター）を確認してください。",
  },
  facebook: {
    not_configured: "Facebook の設定（環境変数 META_APP_ID・META_APP_SECRET・FACEBOOK_LOGIN_CONFIG_ID・APP_URL）が足りないため、つなげません。",
    denied: "Facebook の画面でキャンセルされたため、つなぎませんでした。",
    no_pages:
      "管理している Facebook ページがありませんでした。矢書から投稿できるのはページだけです。Facebook でページを作ってから、もう一度つないでください。",
    no_postable_page:
      "投稿を作れる役割のある Facebook ページがありませんでした。ページの管理者に、投稿を作れる役割（管理者・編集者など）をもらってから、もう一度つないでください。Facebook の画面で、つなぐページにチェックが入っているかも確かめてください。",
    failed: "Facebook とつなげませんでした。もう一度お試しください。続くときは、Meta のアプリの設定（リダイレクト URI、権限）を確認してください。",
  },
  x: {
    not_configured: "X の設定（環境変数 X_CLIENT_ID・X_CLIENT_SECRET・APP_URL）が足りないため、つなげません。",
    denied: "X の画面でキャンセルされたため、つなぎませんでした。",
    failed: "X とつなげませんでした。もう一度お試しください。続くときは X の Developer Console で、アプリの権限（Read and write）と Callback URI を確認してください。",
  },
};
const STATE_ERROR = "接続の確認に失敗しました。時間をおいて、もう一度「つなぐ」から始めてください。";

const CONNECTED: Record<string, string> = { threads: "Threads", x: "X", instagram: "Instagram", facebook: "Facebook ページ" };

// SNS をつないだ結果（OAuth の受け口から ?connected= / ?sns_error= 付きで戻る）
export function SnsResultBanner({ connected, error, sns }: { connected?: string | string[]; error?: string | string[]; sns?: string | string[] }) {
  if (typeof connected === "string" && CONNECTED[connected]) return <SuccessBanner>{CONNECTED[connected]} をつなぎました。</SuccessBanner>;
  if (typeof error !== "string") return null;
  if (error === "state") return <ErrorBanner>{STATE_ERROR}</ErrorBanner>;
  const key: BannerSns = sns === "x" || sns === "instagram" || sns === "facebook" ? sns : "threads";
  const message = ERRORS[key][error];
  return message ? <ErrorBanner>{message}</ErrorBanner> : null;
}
