// 機能に要る環境変数がそろっているかを調べる。足りないときは、サーバーのログに名前を出す（値は出さない）。
// 画面では「準備中」としか出さない（環境変数の名前などの運営の事情は利用者に見せない）ので、
// なぜ止まっているかを運営者がログでわかるようにするため。本番でも出す（サーバーのプロセスごと・機能ごとに 1 回）
const reported = new Set<string>();

export function envReady(feature: string, names: readonly string[], env: Record<string, string | undefined> = process.env): boolean {
  const missing = names.filter((n) => !env[n]);
  if (missing.length && !reported.has(feature)) {
    reported.add(feature);
    const hint = process.env.NODE_ENV === "production" ? "（ホスティングの環境変数に追加して、デプロイし直す）" : "（.env.local に追加して、pnpm dev を起動し直す）";
    console.warn(`[env] ${feature} は「準備中」です。足りない環境変数: ${missing.join(", ")}${hint}`);
  }
  return missing.length === 0;
}

// テストと画面の確かめだけで使う環境変数（偽のサーバーの宛先など）が、本番（VERCEL_ENV=production）に入っていないか。
// 入っていたら true を返し（呼ぶ側はその値を使わない）、サーバーのログに 1 回だけ出す。本物の代わりに偽の宛先へ聞いてしまわないように
export function testOnlyEnvInProduction(name: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV !== "production" || !env[name]) return false;
  if (!reported.has(`test-only:${name}`)) {
    reported.add(`test-only:${name}`);
    console.error(`[env] ${name} はテストと画面の確かめだけで使う値です。本番では使わずに無視します。ホスティングの環境変数から消してください`);
  }
  return true;
}
