import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SnsTag } from "@/components/ui/marks";
import { Term } from "@/components/ui/term";
import { isManualSns, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { ManualChannelRow } from "./manual-channel-row";
import type { ProjectSnsAccount } from "@/lib/sns/queries";
import { formatUsd } from "@/lib/sns/x/pricing";
import type { XSpend } from "@/lib/sns/x/spend";

// つなぐ処理がある SNS と、その入口
const CONNECT_PATH: Partial<Record<SnsKey, string>> = {
  threads: "/sns/threads/connect",
  x: "/sns/x/connect",
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
          const connectPath = connectable[sns] ? CONNECT_PATH[sns] : undefined;
          // 認可画面へのリダイレクトなので、Link（先読みあり）ではなく a で開く
          const connectHref = connectPath ? `${connectPath}?project=${projectId}` : null;
          return (
            <li
              key={sns}
              className="flex items-center gap-3 border-b border-line px-5 py-3 text-[14px] last:border-b-0 max-sm:px-4"
            >
              <span className="w-24 shrink-0">
                <SnsTag sns={sns} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {account ? <AccountLabel account={account} /> : <span className="text-muted">まだつないでいません</span>}
                </span>
                {sns === "x" && xSpend && <XSpendLine spend={xSpend} />}
              </span>
              {connectHref ? (
                // 使える状態でも、権限を足したときなどのために控えめな「つなぎ直す」を出す
                <a
                  href={connectHref}
                  className={buttonClass({ variant: account?.status === "active" ? "text" : "secondary", size: "sm" })}
                >
                  {account ? "つなぎ直す" : "つなぐ"}
                </a>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">準備中</span>
                  <button type="button" className={buttonClass({ variant: "secondary", size: "sm" })} disabled>
                    つなぐ
                  </button>
                </span>
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

// X は使った分だけ払うので、今月の費用と上限を出す（決定 D16）
function XSpendLine({ spend }: { spend: XSpend }) {
  const reached = spend.spentUsd >= spend.budgetUsd;
  return (
    <span className="mt-0.5 block text-xs text-muted">
      今月の X の<Term k="payPerUse">費用</Term> {formatUsd(spend.spentUsd)} / 上限 {formatUsd(spend.budgetUsd)}
      {reached && <span className="ml-2 font-bold text-signal">上限に達しました</span>}
    </span>
  );
}
