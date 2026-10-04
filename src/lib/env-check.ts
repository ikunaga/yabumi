// 機能に要る環境変数がそろっているかを調べる。足りないときは、開発中だけサーバーのログに名前を出す（値は出さない）。
// 画面では「準備中」としか出ないので、なぜ止まっているかを開発者がわかるようにするため
const reported = new Set<string>();

export function envReady(feature: string, names: readonly string[], env: Record<string, string | undefined> = process.env): boolean {
  const missing = names.filter((n) => !env[n]);
  if (missing.length && process.env.NODE_ENV !== "production" && !reported.has(feature)) {
    reported.add(feature);
    console.warn(`[env] ${feature} は「準備中」です。.env.local に足りない環境変数: ${missing.join(", ")}（足したら pnpm dev を起動し直す）`);
  }
  return missing.length === 0;
}
