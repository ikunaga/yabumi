// GitHub の REST API（https://docs.github.com/en/rest）。トークンは呼ぶ側が渡す

export const GITHUB_API = "https://api.github.com";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

async function gh<T>(token: string, path: string, init: RequestInit & { accept?: string } = {}): Promise<T> {
  const { accept, ...rest } = init;
  const res = await fetch(path.startsWith("https://") ? path : `${GITHUB_API}${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      Accept: accept ?? "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "yabumi",
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new GitHubApiError(body.message ?? `GitHub API の呼び出しに失敗しました（${res.status}）`, res.status);
  }
  if (accept === "application/vnd.github.raw") return (await res.text()) as T;
  return (await res.json()) as T;
}

// インストールのトークン（1 時間）。読むリポジトリと権限を絞って発行する
export async function createInstallationToken(appJwt: string, installationId: number, repositoryIds?: number[]): Promise<string> {
  const body: Record<string, unknown> = { permissions: { contents: "read", metadata: "read" } };
  if (repositoryIds) body.repository_ids = repositoryIds;
  const json = await gh<{ token: string }>(appJwt, `/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return json.token;
}

// 利用者の認可コード → 利用者のトークン（インストールが本人のものか確かめるためだけに使い、保存しない）
export async function exchangeUserCode(clientId: string, clientSecret: string, code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "yabumi" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new GitHubApiError(json.error_description ?? "GitHub の認可に失敗しました", res.status);
  return json.access_token;
}

export type Installation = { id: number; account: { login: string; type: string }; app_id: number };

// 利用者が使える、この App のインストール
export async function listUserInstallations(userToken: string): Promise<Installation[]> {
  const json = await gh<{ installations: Installation[] }>(userToken, "/user/installations?per_page=100");
  return json.installations;
}

export type Repo = { id: number; full_name: string; private: boolean; default_branch: string; description: string | null };

// インストールで読めるリポジトリ（利用者がインストールのときに選んだもの）
export async function listInstallationRepos(installationToken: string): Promise<Repo[]> {
  const repos: Repo[] = [];
  for (let page = 1; page <= 5; page++) {
    const json = await gh<{ repositories: Repo[]; total_count: number }>(installationToken, `/installation/repositories?per_page=100&page=${page}`);
    repos.push(...json.repositories);
    if (repos.length >= json.total_count || json.repositories.length === 0) break;
  }
  return repos;
}

export async function getRepo(token: string, fullName: string): Promise<Repo & { language: string | null; topics?: string[] }> {
  return gh(token, `/repos/${fullName}`);
}

export type TreeEntry = { path: string; type: "blob" | "tree" | "commit"; size?: number };

export async function getTree(token: string, fullName: string, branch: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const json = await gh<{ tree: TreeEntry[]; truncated: boolean }>(token, `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return { entries: json.tree, truncated: json.truncated };
}

export async function getFileText(token: string, fullName: string, path: string, ref: string): Promise<string> {
  const p = path.split("/").map(encodeURIComponent).join("/");
  return gh<string>(token, `/repos/${fullName}/contents/${p}?ref=${encodeURIComponent(ref)}`, { accept: "application/vnd.github.raw" });
}
