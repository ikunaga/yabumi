import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SnsTag } from "@/components/ui/marks";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { ProjectSnsAccount } from "@/lib/sns/queries";

// つなぐ処理がある SNS と、その入口
const CONNECT_PATH: Partial<Record<SnsKey, string>> = {
  threads: "/sns/threads/connect",
};

// 概要の「つないだ SNS」。SNS ごとに 1 行
export function SnsAccountsCard({ projectId, accounts }: { projectId: string; accounts: ProjectSnsAccount[] }) {
  return (
    <Card className="overflow-hidden">
      <div id="sns" className="scroll-mt-6">
        <CardHeader title="つないだ SNS" />
      </div>
      <ul>
        {SNS_KEYS.map((sns) => {
          const account = accounts.find((a) => a.sns === sns && a.status === "active") ?? accounts.find((a) => a.sns === sns);
          const connectPath = CONNECT_PATH[sns];
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
              <span className="min-w-0 flex-1 truncate">
                {account ? (
                  <AccountLabel account={account} />
                ) : (
                  <span className="text-muted">まだつないでいません</span>
                )}
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
