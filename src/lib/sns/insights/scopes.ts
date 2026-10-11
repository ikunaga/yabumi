import type { SnsKey } from "@/lib/sns";

// 数字を読む権限。Meta のアプリでこの権限を足し、SNS_INSIGHTS（例: "threads,instagram,facebook"）で有効にしたら、
// つなぐときに求める（Meta のアプリにない権限を求めると、つなぐ画面がエラーになるため、先に Meta の側で足す。docs/review/meta.md）
export const INSIGHTS_SCOPE: Partial<Record<SnsKey, string>> = {
  threads: "threads_manage_insights",
  instagram: "instagram_business_manage_insights",
  facebook: "read_insights",
  // X は投稿のときから求めている権限で読める（読むたびに費用がかかるので、SNS_INSIGHTS に x を入れたときだけ読む）
  x: "tweet.read",
};

export function insightsEnabled(sns: SnsKey, env: string | undefined = process.env.SNS_INSIGHTS): boolean {
  return (env ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(sns);
}

// つなぐときに求める権限（有効なら数字の権限を足す）
export function withInsightsScope<T extends string>(sns: SnsKey, base: readonly T[], env?: string): string[] {
  const extra = INSIGHTS_SCOPE[sns];
  return extra && insightsEnabled(sns, env) && !base.includes(extra as T) ? [...base, extra] : [...base];
}

export function hasInsightsScope(sns: SnsKey, scopes: readonly string[]): boolean {
  const needed = INSIGHTS_SCOPE[sns];
  return Boolean(needed && scopes.includes(needed));
}
