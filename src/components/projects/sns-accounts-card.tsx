import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SnsTag } from "@/components/ui/marks";
import { Term } from "@/components/ui/term";
import { isManualSns, SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { DisconnectSnsButton } from "./disconnect-sns-button";
import { ManualChannelRow } from "./manual-channel-row";
import type { ProjectSnsAccount } from "@/lib/sns/queries";
import { formatUsd } from "@/lib/sns/x/pricing";
import type { XSpend } from "@/lib/sns/x/spend";

// つなぐ処理がある SNS と、その入口
// どの SNS も、先に確かめの画面（できること・費用・準備）を出してから認可の画面へ進む（docs/architecture.md の 4.21）
const CONNECT_HREF: Partial<Record<SnsKey, (projectId: string) => string>> = {
  threads: (id) => `/projects/${id}/connect/threads`,
  x: (id) => `/projects/${id}/connect/x`,
  instagram: (id) => `/projects/${id}/connect/instagram`,
  facebook: (id) => `/projects/${id}/connect/facebook`,
};

// 概要の「つないだ SNS」。SNS ごとに 1 行
// 手で投稿する SNS の説明（プロフィールを登録していないとき）
const MANUAL_NOTE: Partial<Record<SnsKey, React.ReactNode>> = {
  note: "日本語の長文。個人開発の振り返りや技術の記事が読まれやすい",
  substack: (
    <>
      メールで届く<Term k="newsletter" />。読者が<Term k="ownedAudience" />になる。英語圏に強い
    </>
  ),
};

export function SnsAccountsCard({
  projectId,
  accounts,
  manualChannels = [],
  connectable = {},
  xSpend = null,
}: {
  projectId: string;
  accounts: ProjectSnsAccount[];
  manualChannels?: { sns: string; profile_url: string | null }[];
  // 環境変数がそろい、つなげる SNS。そろっていなければ「準備中」
  connectable?: Partial<Record<SnsKey, boolean>>;
  xSpend?: XSpend | null;
}) {
  return (
    <Card className="overflow-hidden">
      <div id="sns" className="scroll-mt-6">
        <CardHeader title="つないだ SNS" />
      </div>
      <ul>
        {SNS_KEYS.map((sns) => {
          if (isManualSns(sns)) {
            const ch = manualChannels.find((c) => c.sns === sns);
            return <ManualChannelRow key={sns} projectId={projectId} sns={sns} profileUrl={ch?.profile_url ?? null} note={MANUAL_NOTE[sns]} />;
          }
          const account = accounts.find((a) => a.sns === sns && a.status === "active") ?? accounts.find((a) => a.sns === sns);
          // 認可画面へのリダイレクトなので、Link（先読みあり）ではなく a で開く
          const connectHref = connectable[sns] ? (CONNECT_HREF[sns]?.(projectId) ?? null) : null;
          return (
            <li
              key={sns}
              // スマホでは、状態の文を 2 行目に回して切らずに出す
              className="flex items-center gap-3 border-b border-line px-5 py-3 text-[14px] last:border-b-0 max-sm:flex-wrap max-sm:gap-y-1.5 max-sm:px-4"
            >
              <span className="w-24 shrink-0 max-sm:mr-auto max-sm:w-auto">
                <SnsTag sns={sns} />
              </span>
              <span className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                <span className="block truncate">
                  {account ? <AccountLabel account={account} /> : <span className="text-muted">まだつないでいません</span>}
                </span>
                {sns === "x" && xSpend && <XSpendLine spend={xSpend} />}
              </span>
              {account && <DisconnectSnsButton projectId={projectId} accountId={account.id} sns={sns} label={SNS[sns].label} />}
              {connectHref ? (
                // 使える状態でも、権限を足したときなどのために控えめな「つなぎ直す」を出す
                <a
                  href={connectHref}
                  className={buttonClass({ variant: account?.status === "active" ? "text" : "secondary", size: "sm" })}
                >
                  {account ? "つなぎ直す" : "つなぐ"}
                </a>
              ) : (
                <NotReadyButton variant="secondary" size="sm">
                  つなぐ
                </NotReadyButton>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AccountLabel({ account }: { account: ProjectSnsAccount }) {
  const name = account.handle ? `@${account.handle}` : account.displayName || "アカウント";
  if (account.status === "active") {
    return (
      <>
        <span className="font-bold text-success">✓ </span>
        {name}
      </>
    );
  }
  return (
    <>
      {name}
      <span className="ml-2 font-bold text-signal">要確認</span>
      <span className="ml-1 text-xs text-muted">{account.status === "expired" ? "期限切れ" : "解除済み"}</span>
    </>
  );
}

// X は使った分だけ払うので、今月の自分の費用と、自分の自動投稿の上限・矢書全体の上限に達したかを出す（決定 D16・D23）。
// 列が狭い（PC は 2 段組みの左）ので、費用と上限を 2 行に分け、言葉のまとまり（inline-block）の間でだけ折る。上限に達した印は 3 行目に出す
function XSpendLine({ spend }: { spend: XSpend }) {
  return (
    <span className="mt-0.5 block text-xs leading-[1.6] text-muted">
      <span className="block">
        <span className="inline-block">
          今月の<Term k="payPerUse">費用</Term> {formatUsd(spend.mineUsd)}
        </span>
        <span className="inline-block">（うち投稿 {formatUsd(spend.minePostUsd)}）</span>
      </span>
      <span className="block">
        <span className="inline-block">月の上限</span> <span className="inline-block">あなた {formatUsd(spend.userBudgetUsd)}・</span>
        <span className="inline-block">全体 {formatUsd(spend.budgetUsd)}</span>
      </span>
      {spend.userReached ? (
        <span className="block font-bold text-signal">
          <span className="inline-block">今月のあなたの</span>
          <span className="inline-block">上限に達しました</span>
        </span>
      ) : (
        spend.budgetReached && (
          <span className="block font-bold text-signal">
            <span className="inline-block">今月の上限に達しました</span>
            <span className="inline-block">（矢書全体）</span>
          </span>
        )
      )}
    </span>
  );
}
