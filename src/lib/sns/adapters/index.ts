import "server-only";
import type { SnsKey } from "@/lib/sns";
import { xConfig, xMonthlyBudgetUsd } from "@/lib/sns/x/config";
import type { PublisherDeps } from "@/lib/sns/publisher";
import { createThreadsAdapter } from "./threads";
import type { SnsAdapter } from "./types";
import { createXAdapter } from "./x";

// 送信できる SNS。SNS を足すときはここにアダプターを登録する
export const adapters: Partial<Record<SnsKey, SnsAdapter>> = {
  threads: createThreadsAdapter(),
  x: createXAdapter(xConfig),
};

export function canPublish(sns: SnsKey): boolean {
  return adapters[sns] !== undefined;
}

// 送信ジョブ・「今すぐ送る」・取り消しに渡すもの。月の上限は呼ぶたびに環境変数から読む
export function publisherDeps(): PublisherDeps {
  return { adapters, budgetsUsd: { x: xMonthlyBudgetUsd() } };
}
