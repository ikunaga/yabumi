// 画面の確かめとテストのための、偽の Vercel・偽の DNS・偽の証明書の確かめの宛先（tests/helpers/fake-link-domain-server.mjs）。
// LINK_DOMAIN_TEST_SERVER に http://127.0.0.1:<port> を入れると、Vercel の API・DNS over HTTPS・https://<ドメイン>/__yabumi/link-check を、
// 本物の代わりにこの宛先に聞く（本物の Vercel・本物の DNS を呼ばずに、ドメインを入れる → DNS 待ち → つながった → 外す を画面で確かめる）。
// 本番（VERCEL_ENV=production）では使わない。入っていても無視し、サーバーのログに出す（env-check.ts の testOnlyEnvInProduction）
import { testOnlyEnvInProduction } from "@/lib/env-check";

export function linkDomainTestServer(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.LINK_DOMAIN_TEST_SERVER?.trim();
  if (!v) return null;
  if (testOnlyEnvInProduction("LINK_DOMAIN_TEST_SERVER", env)) return null;
  return v.replace(/\/+$/, "");
}
