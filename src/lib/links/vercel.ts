// Vercel の API（Project Domains）で、利用者のドメインを矢書の Vercel のプロジェクトに足す・確かめる・外す（4.22、D28）。
// トークンは運営者の環境変数（VERCEL_API_TOKEN、VERCEL_PROJECT_ID、VERCEL_TEAM_ID。docs/deploy.md の 12）。
// 使う API（https://vercel.com/openapi.json、2026-10-12 確認）:
// - POST   /v10/projects/{id}/domains              ドメインを足す（verified が false なら verification の TXT が要る）
// - POST   /v9/projects/{id}/domains/{domain}/verify 所有の確認の TXT を確かめる
// - GET    /v6/domains/{domain}/config               DNS の向き（misconfigured、recommendedCNAME、configuredBy）
// - DELETE /v9/projects/{id}/domains/{domain}        外す

export type VercelConfig = { token: string; projectId: string; teamId?: string };

export function vercelConfig(env: Record<string, string | undefined> = process.env): VercelConfig | null {
  const token = env.VERCEL_API_TOKEN?.trim();
  const projectId = env.VERCEL_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  return { token, projectId, teamId: env.VERCEL_TEAM_ID?.trim() || undefined };
}

export class VercelApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VercelApiError";
  }
}

export type VerificationChallenge = { type: string; domain: string; value: string };
export type ProjectDomain = { name: string; apexName: string; verified: boolean; verification: VerificationChallenge[] };
export type DomainConfig = { misconfigured: boolean; configuredBy: string | null; recommendedCNAME: string | null };

type Fetch = typeof fetch;

async function call<T>(cfg: VercelConfig, method: string, path: string, body: unknown, fetcher: Fetch): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (cfg.teamId) url.searchParams.set("teamId", cfg.teamId);
  const res = await fetcher(url, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) throw new VercelApiError(res.status, json.error?.code ?? "", json.error?.message ?? `HTTP ${res.status}`);
  return json as T;
}

export function vercelDomains(cfg: VercelConfig, fetcher: Fetch = fetch) {
  const project = encodeURIComponent(cfg.projectId);
  return {
    async add(domain: string): Promise<ProjectDomain> {
      const d = await call<ProjectDomain>(cfg, "POST", `/v10/projects/${project}/domains`, { name: domain }, fetcher);
      return { name: d.name, apexName: d.apexName, verified: Boolean(d.verified), verification: d.verification ?? [] };
    },
    async get(domain: string): Promise<ProjectDomain> {
      const d = await call<ProjectDomain>(cfg, "GET", `/v9/projects/${project}/domains/${encodeURIComponent(domain)}`, null, fetcher);
      return { name: d.name, apexName: d.apexName, verified: Boolean(d.verified), verification: d.verification ?? [] };
    },
    async verify(domain: string): Promise<boolean> {
      const d = await call<{ verified?: boolean }>(cfg, "POST", `/v9/projects/${project}/domains/${encodeURIComponent(domain)}/verify`, null, fetcher);
      return Boolean(d.verified);
    },
    async config(domain: string): Promise<DomainConfig> {
      const d = await call<{ misconfigured?: boolean; configuredBy?: string | null; recommendedCNAME?: { rank: number; value: string }[] }>(
        cfg,
        "GET",
        `/v6/domains/${encodeURIComponent(domain)}/config?projectIdOrName=${project}`,
        null,
        fetcher,
      );
      const cname = [...(d.recommendedCNAME ?? [])].sort((a, b) => a.rank - b.rank)[0]?.value ?? null;
      return { misconfigured: d.misconfigured !== false, configuredBy: d.configuredBy ?? null, recommendedCNAME: cname?.replace(/\.$/, "") ?? null };
    },
    // 外す。もう付いていなければ（404）外れたものとして扱う
    async remove(domain: string): Promise<void> {
      try {
        await call(cfg, "DELETE", `/v9/projects/${project}/domains/${encodeURIComponent(domain)}`, null, fetcher);
      } catch (e) {
        if (e instanceof VercelApiError && e.status === 404) return;
        throw e;
      }
    },
  };
}

export type VercelDomains = ReturnType<typeof vercelDomains>;
