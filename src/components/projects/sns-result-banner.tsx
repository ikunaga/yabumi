import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";

// エラーのときは ?sns= でどの SNS かがわかる（ないときは、最初につないだ Threads として扱う）
type BannerSns = "threads" | "x" | "instagram" | "facebook" | "youtube";

const ERRORS: Record<BannerSns, Record<string, string>> = {
  threads: {
    not_configured: "Threads は、まだ yabumi とつなぐことができません。お使いのアカウントの問題ではありません。",
    denied: "Threads の画面でキャンセルされたため、つなぎませんでした。",
    failed: "Threads とつなげませんでした。もう一度つないでください。何度も続くときは、少し時間をおいてからつないでください。",
  },
  instagram: {
    not_configured: "Instagram は、まだ yabumi とつなぐことができません。お使いのアカウントの問題ではありません。",
    denied: "Instagram の画面でキャンセルされたため、つなぎませんでした。",
    not_professional:
      "このアカウントは、Instagram のプロアカウントではありません。そのため、つなげませんでした。Instagram のアプリで、プロアカウントに切り替えてください。「設定とアクティビティ」の「アカウントの種類とツール」にあります。切り替えは無料です。投稿とフォロワーは、そのまま残ります。非公開のアカウントは、公開になります。切り替えたら、もう一度つないでください。",
    failed: "Instagram とつなげませんでした。もう一度つないでください。何度も続くときは、少し時間をおいてからつないでください。",
  },
  facebook: {
    not_configured: "Facebook ページは、まだ yabumi とつなぐことができません。お使いのアカウントの問題ではありません。",
    denied: "Facebook の画面でキャンセルされたため、つなぎませんでした。",
    no_pages:
      "管理している Facebook ページがありませんでした。yabumi から投稿できるのはページだけです。Facebook でページを作ってから、もう一度つないでください。",
    no_postable_page:
      "投稿できる Facebook ページがありませんでした。Facebook の画面で、つなぐページにチェックを入れてください。人のページなら、その人に管理者か編集者の役割をもらってください。そのあと、もう一度つないでください。",
    failed: "Facebook とつなげませんでした。もう一度つないでください。何度も続くときは、少し時間をおいてからつないでください。",
  },
  youtube: {
    not_configured: "YouTube は、まだ yabumi とつなぐことができません。お使いのアカウントの問題ではありません。",
    denied: "Google の画面でキャンセルされたため、つなぎませんでした。",
    scope:
      "YouTube のチェックが外れていたため、つなげませんでした。もう一度つないでください。Google の画面で、YouTube の項目すべてにチェックを入れてください。",
    no_channel: "この Google のアカウントには YouTube のチャンネルがありません。YouTube でチャンネルを作ってから、もう一度つないでください。",
    failed: "YouTube とつなげませんでした。もう一度つないでください。何度も続くときは、少し時間をおいてからつないでください。",
  },
  x: {
    not_configured: "X は、まだ yabumi とつなぐことができません。お使いのアカウントの問題ではありません。",
    denied: "X の画面でキャンセルされたため、つなぎませんでした。",
    failed: "X とつなげませんでした。もう一度つないでください。何度も続くときは、少し時間をおいてからつないでください。",
  },
};
// 確認（OAuth の state）が合わないとき。原因の多くは 10 分の期限切れ・2 回押した・別のブラウザで開いた、で、待っても直らない（2026-11-22 オーナーが Facebook で迷った）。
// この受け口はどのプロジェクトか分からないので、プロジェクトの一覧に戻る。すぐやり直せる手順を書く
const STATE_ERROR =
  "SNS とつなげませんでした。この一覧から宣伝するものを選び、「ホーム」の「つなぐ・外す」を押してください。「つなぐ」は 1 回だけ押し、10 分以内に SNS の画面で許可してください。途中で別のアプリに移ると、つなげないことがあります。";

const CONNECTED: Record<string, string> = { threads: "Threads", x: "X", instagram: "Instagram", facebook: "Facebook ページ", youtube: "YouTube" };

// SNS をつないだ結果（OAuth の受け口から ?connected= / ?sns_error= 付きで戻る）
// replaced: 同じ SNS の別のアカウントから付け替えたときの、外した古いアカウント（1 つのプロジェクトに SNS ごとに 1 つ。docs/architecture.md の 4.6）
export function SnsResultBanner({
  connected,
  error,
  sns,
  replaced = [],
  connectedName = null,
}: {
  connected?: string | string[];
  error?: string | string[];
  sns?: string | string[];
  replaced?: string[];
  connectedName?: string | null;
}) {
  if (typeof connected === "string" && CONNECTED[connected]) {
    const label = CONNECTED[connected];
    if (replaced.length) {
      return (
        <SuccessBanner>
          {label} の {replaced.join("・")} をこのプロジェクトから外し、{connectedName ?? "新しいアカウント"} をつなぎました。予約中の投稿は {connectedName ?? "新しいアカウント"} から送ります。
        </SuccessBanner>
      );
    }
    return <SuccessBanner>{label} をつなぎました。</SuccessBanner>;
  }
  if (typeof error !== "string") return null;
  if (error === "state") return <ErrorBanner>{STATE_ERROR}</ErrorBanner>;
  const key: BannerSns = sns === "x" || sns === "instagram" || sns === "facebook" || sns === "youtube" ? sns : "threads";
  const message = ERRORS[key][error];
  return message ? <ErrorBanner>{message}</ErrorBanner> : null;
}
