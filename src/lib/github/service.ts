import "server-only";
import { createAppJwt } from "./app-auth";
import { createInstallationToken, getFileText, getTree, listInstallationRepos, type Repo } from "./api";
import type { GitHubAppConfig } from "./config";
import { readSelectedFiles } from "./repo-reader";

// インストールのトークンを、そのつど発行する（保存しない）
export async function installationToken(cfg: GitHubAppConfig, installationId: number, repositoryIds?: number[]) {
  return createInstallationToken(createAppJwt(cfg.appId, cfg.privateKey), installationId, repositoryIds);
}

export async function reposForInstallation(cfg: GitHubAppConfig, installationId: number): Promise<Repo[]> {
  return listInstallationRepos(await installationToken(cfg, installationId));
}

type Link = { installationId: number; repoId: number; fullName: string; defaultBranch: string };

// 紹介文の下書き用の読み込み。トークンはこのリポジトリだけに絞り、読むたびに発行する
export function repoAccess(cfg: GitHubAppConfig) {
  return {
    async listFiles(link: Link) {
      const token = await installationToken(cfg, link.installationId, [link.repoId]);
      return (await getTree(token, link.fullName, link.defaultBranch)).entries;
    },
    async readFiles(link: Link, paths: string[]) {
      const token = await installationToken(cfg, link.installationId, [link.repoId]);
      return readSelectedFiles(paths, (path) => getFileText(token, link.fullName, path, link.defaultBranch));
    },
  };
}
