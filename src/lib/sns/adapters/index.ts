import "server-only";
import type { SnsKey } from "@/lib/sns";
import { revokeToken } from "@/lib/sns/x/api";
import { xConfig, xConfigured, xMonthlyBudgetUsd, xPostUserMonthlyUsd } from "@/lib/sns/x/config";
import type { RevokeDeps } from "@/lib/sns/revoke";
import type { PublisherDeps } from "@/lib/sns/publisher";
import { facebookAppSecret } from "@/lib/sns/facebook/config";
import { revokeToken as revokeTikTokToken } from "@/lib/sns/tiktok/api";
import { tiktokConfig, tiktokConfigured } from "@/lib/sns/tiktok/config";
import { createFacebookAdapter } from "./facebook";
import { createInstagramAdapter } from "./instagram";
import { createThreadsAdapter } from "./threads";
import type { SnsAdapter } from "./types";
import { createXAdapter } from "./x";
import { createTikTokAdapter } from "./tiktok";
import { appUrl } from "@/lib/sns/threads/config";
import { tiktokAudited } from "@/lib/sns/tiktok/config";
import { clearMediaTickets, issueMediaTickets } from "@/lib/sns/tiktok/media";
import { loadTikTokTarget } from "@/lib/sns/tiktok/store";
import { createAdminClient } from "@/lib/supabase/admin";

// 送信できる SNS。SNS を足すときはここにアダプターを登録する
export const adapters: Partial<Record<SnsKey, SnsAdapter>> = {
  threads: createThreadsAdapter(),
  x: createXAdapter(xConfig),
  instagram: createInstagramAdapter(),
  facebook: createFacebookAdapter(facebookAppSecret),
  // TikTok（docs/design/tiktok.md）。配信先ごとの同意の記録と、写真を渡す入口はサーバーの権限で読み書きする
  tiktok: createTikTokAdapter({
    config: tiktokConfig,
    audited: tiktokAudited,
    loadTarget: (id) => loadTikTokTarget(createAdminClient(), id),
    issueTickets: (a) => issueMediaTickets(createAdminClient(), { ...a, baseUrl: appUrl() }),
    clearTickets: (id) => clearMediaTickets(createAdminClient(), id),
  }),
};

export function canPublish(sns: SnsKey): boolean {
  return adapters[sns] !== undefined;
}

// 送信ジョブ・「今すぐ送る」・取り消しに渡すもの。月の上限（yabumi 全体と利用者ごと）は呼ぶたびに環境変数から読む
export function publisherDeps(): PublisherDeps {
  return { adapters, budgetsUsd: { x: xMonthlyBudgetUsd() }, userBudgetsUsd: { x: xPostUserMonthlyUsd() } };
}

// SNS を外す・退会のときに、SNS 側の連携を解除するためのもの
export function revokeDeps(): RevokeDeps {
  return {
    revokeX: xConfigured() ? (token, hint) => revokeToken(xConfig(), token, hint) : undefined,
    revokeTikTok: tiktokConfigured() ? (token) => revokeTikTokToken(tiktokConfig(), token) : undefined,
  };
}
