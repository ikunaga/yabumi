import type { SnsKey } from "@/lib/sns";
import { createThreadsAdapter } from "./threads";
import type { SnsAdapter } from "./types";

// 送信できる SNS。SNS を足すときはここにアダプターを登録する
export const adapters: Partial<Record<SnsKey, SnsAdapter>> = {
  threads: createThreadsAdapter(),
};

export function canPublish(sns: SnsKey): boolean {
  return adapters[sns] !== undefined;
}
