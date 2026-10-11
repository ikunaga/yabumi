import "server-only";
import type { SnsKey } from "@/lib/sns";
import { revokeToken } from "@/lib/sns/x/api";
import { xConfig, xConfigured, xMonthlyBudgetUsd, xPostUserMonthlyUsd } from "@/lib/sns/x/config";
import type { RevokeDeps } from "@/lib/sns/revoke";
import type { PublisherDeps } from "@/lib/sns/publisher";
import { facebookAppSecret } from "@/lib/sns/facebook/config";
import { createFacebookAdapter } from "./facebook";
import { createInstagramAdapter } from "./instagram";
import { createThreadsAdapter } from "./threads";
import type { SnsAdapter } from "./types";
import { createXAdapter } from "./x";

// 送信できる SNS。SNS を足すときはここにアダプターを登録する
export const adapters: Partial<Record<SnsKey, SnsAdapter>> = {
  threads: createThreadsAdapter(),
  x: createXAdapter(xConfig),
  instagram: createInstagramAdapter(),
  facebook: createFacebookAdapter(facebookAppSecret),
};

export function canPublish(sns: SnsKey): boolean {
  return adapters[sns] !== undefined;
}

// 送信ジョブ・「今すぐ送る」・取り消しに渡すもの。月の上限（矢書全体と利用者ごと）は呼ぶたびに環境変数から読む
export function publisherDeps(): PublisherDeps {
  return { adapters, budgetsUsd: { x: xMonthlyBudgetUsd() }, userBudgetsUsd: { x: xPostUserMonthlyUsd() } };
}

// SNS を外す・退会のときに、SNS 側の連携を解除するためのもの
export function revokeDeps(): RevokeDeps {
  return { revokeX: xConfigured() ? (token, hint) => revokeToken(xConfig(), token, hint) : undefined };
}
