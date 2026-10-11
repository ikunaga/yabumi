// 本番の URL（APP_URL）以外の vercel.app のアドレスで開かれたら、APP_URL へ転送する（docs/deploy.md の 11）。
// ログインの cookie はホストごとなので、同じサービスに 2 つの入口があると、ログインし直しや OAuth の戻り先の食い違いが起きる。
// - 転送するのは本番（VERCEL_ENV=production）の *.vercel.app だけ。プレビューやローカルは転送しない
// - 外から POST で届くもの（予約ジョブ、Meta の SNS のアンインストール・削除の通知）は転送しない。転送に従わない相手がいるため。
//   それぞれの呼び先を新しい URL に変え終わるまで、古い URL でも動くようにしておく

const NO_REDIRECT_PREFIXES = [
  "/api/jobs",
  "/sns/threads/uninstall",
  "/sns/threads/delete",
  "/sns/instagram/uninstall",
  "/sns/instagram/delete",
  "/sns/facebook/uninstall",
  "/sns/facebook/delete",
];

export function canonicalRedirect(
  url: URL,
  env: { appUrl?: string; vercelEnv?: string },
): URL | null {
  if (env.vercelEnv !== "production" || !env.appUrl) return null;
  let canonical: URL;
  try {
    canonical = new URL(env.appUrl);
  } catch {
    return null;
  }
  if (url.host === canonical.host || !url.hostname.endsWith(".vercel.app")) return null;
  if (NO_REDIRECT_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null;
  const to = new URL(url.pathname + url.search, canonical.origin);
  return to;
}
