import {
  createTextContainer,
  deleteMedia,
  getContainerStatus,
  getPermalink,
  publishContainer,
  refreshLongLived,
  shouldRefresh,
  ThreadsApiError,
} from "@/lib/sns/threads/api";
import { SnsPublishError, type SnsAdapter } from "./types";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

// Threads API のエラーを、送信ジョブが判断できる形に直す。
// stage が "publish" の通信エラーは、公開されたかどうかわからないので unknown にする
export function toPublishError(e: unknown, stage: "prepare" | "publish"): SnsPublishError {
  if (e instanceof SnsPublishError) return e;
  if (e instanceof ThreadsApiError) {
    if (e.code === 190 || e.status === 401) {
      return new SnsPublishError("auth", "Threads の接続が切れています。概要の「つないだ SNS」からつなぎ直してください。", { cause: e });
    }
    if (e.status === 429 || (e.code !== undefined && RATE_LIMIT_CODES.has(e.code))) {
      return new SnsPublishError("retryable", "Threads の回数制限にかかりました。時間をおいて送り直します。", { cause: e });
    }
    if (e.transient) {
      return new SnsPublishError("retryable", "Threads 側で一時的なエラーが起きました。時間をおいて送り直します。", { cause: e });
    }
    return new SnsPublishError("permanent", `Threads に送れませんでした（${e.message}）`, { cause: e });
  }
  // fetch 自体の失敗（通信エラー）
  if (stage === "publish") {
    return new SnsPublishError(
      "unknown",
      "Threads への公開の途中で通信が切れました。Threads に投稿されているか確かめてから、必要ならもう一度送ってください。",
      { cause: e },
    );
  }
  return new SnsPublishError("retryable", "Threads につながりませんでした。時間をおいて送り直します。", { cause: e });
}

type Options = { sleep?: (ms: number) => Promise<void>; pollIntervalMs?: number; maxPolls?: number };

export function createThreadsAdapter({ sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollIntervalMs = 2000, maxPolls = 5 }: Options = {}): SnsAdapter {
  return {
    sns: "threads",

    async publishText(account, text) {
      let containerId: string;
      try {
        containerId = await createTextContainer(account.accessToken, text);
        // 文章だけならすぐ FINISHED になることが多い。処理中なら少し待つ（最大 maxPolls 回）
        for (let i = 0; ; i++) {
          const { status, errorMessage } = await getContainerStatus(account.accessToken, containerId);
          if (status === "FINISHED") break;
          if (status === "ERROR" || status === "EXPIRED") {
            throw new SnsPublishError("permanent", `Threads が投稿を受け付けませんでした（${errorMessage ?? status}）`);
          }
          if (i + 1 >= maxPolls) {
            // 公開していないコンテナは投稿されないので、やり直しても二重にはならない
            throw new SnsPublishError("retryable", "Threads 側の準備に時間がかかっています。時間をおいて送り直します。");
          }
          await sleep(pollIntervalMs);
        }
      } catch (e) {
        throw toPublishError(e, "prepare");
      }

      let mediaId: string;
      try {
        mediaId = await publishContainer(account.accessToken, containerId);
      } catch (e) {
        throw toPublishError(e, "publish");
      }

      // URL は表示用。取れなくても送信は成功として扱う
      const url = await getPermalink(account.accessToken, mediaId).catch(() => null);
      return { externalPostId: mediaId, url };
    },

    async deletePost(account, externalPostId) {
      try {
        await deleteMedia(account.accessToken, externalPostId);
      } catch (e) {
        throw toPublishError(e, "prepare");
      }
    },

    async refreshToken(accessToken, now) {
      try {
        return await refreshLongLived(accessToken, now);
      } catch (e) {
        throw toPublishError(e, "prepare");
      }
    },

    shouldRefresh,
  };
}
