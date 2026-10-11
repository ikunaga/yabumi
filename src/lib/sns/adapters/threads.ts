import {
  createCarouselContainer,
  createImageContainer,
  createTextContainer,
  deleteMedia,
  getContainerStatus,
  getPermalink,
  publishContainer,
  refreshLongLived,
  shouldRefresh,
  ThreadsApiError,
} from "@/lib/sns/threads/api";
import { continueStaged, type StagedOps } from "./staged";
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

type Options = { sleep?: (ms: number) => Promise<void>; pollIntervalMs?: number; maxPolls?: number; maxImagePolls?: number };

export function createThreadsAdapter({
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollIntervalMs = 2000,
  maxPolls = 5,
  // 画像は Threads が取りに来て処理するので時間がかかる（公式は平均 30 秒待つことをすすめている）。2 秒 × 20 回 = 最大 40 秒
  maxImagePolls = 20,
}: Options = {}): SnsAdapter {
  // コンテナの準備ができるまで待つ。だめなら SnsPublishError
  async function waitFinished(token: string, containerId: string, polls: number) {
    for (let i = 0; ; i++) {
      const { status, errorMessage } = await getContainerStatus(token, containerId);
      if (status === "FINISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new SnsPublishError("permanent", `Threads が投稿を受け付けませんでした（${errorMessage ?? status}）`);
      }
      if (i + 1 >= polls) {
        // 公開していないコンテナは投稿されないので、やり直しても二重にはならない
        throw new SnsPublishError("retryable", "Threads 側の準備に時間がかかっています。時間をおいて送り直します。");
      }
      await sleep(pollIntervalMs);
    }
  }

  // 画像つきの投稿を段階で進めるときの、Threads の呼び出し（staged.ts）
  const staged = (token: string): StagedOps => ({
    label: "Threads",
    status: async (id) => {
      const { status, errorMessage } = await getContainerStatus(token, id);
      return { status, detail: errorMessage };
    },
    createCarousel: (children, text) => createCarouselContainer(token, children, text),
    publish: (id) => publishContainer(token, id),
    permalink: (mediaId) => getPermalink(token, mediaId),
    toError: toPublishError,
  });

  return {
    sns: "threads",

    // 画像つき: コンテナを作るだけで待たない。準備の続きは continuePublish（次の回の送信ジョブ）で確かめる
    async startPublish(account, text, images) {
      try {
        if (images.length === 1) {
          const [image] = images;
          return { kind: "single", id: await createImageContainer(account.accessToken, image.url, { text, altText: image.altText || undefined }) };
        }
        const children: string[] = [];
        for (const image of images) {
          children.push(await createImageContainer(account.accessToken, image.url, { carouselItem: true, altText: image.altText || undefined }));
        }
        return { kind: "carousel", children, text };
      } catch (e) {
        throw toPublishError(e, "prepare");
      }
    },

    continuePublish(account, state) {
      return continueStaged(staged(account.accessToken), state);
    },

    async publishText(account, text, images = []) {
      let containerId: string;
      try {
        if (images.length === 0) {
          containerId = await createTextContainer(account.accessToken, text);
          // 文章だけならすぐ FINISHED になることが多い。処理中なら少し待つ（最大 maxPolls 回）
          await waitFinished(account.accessToken, containerId, maxPolls);
        } else if (images.length === 1) {
          const [image] = images;
          containerId = await createImageContainer(account.accessToken, image.url, { text, altText: image.altText || undefined });
          await waitFinished(account.accessToken, containerId, maxImagePolls);
        } else {
          // カルーセル: 1 枚ずつのコンテナを作り、まとめたコンテナの準備を待つ
          const children: string[] = [];
          for (const image of images) {
            children.push(await createImageContainer(account.accessToken, image.url, { carouselItem: true, altText: image.altText || undefined }));
          }
          containerId = await createCarouselContainer(account.accessToken, children, text);
          await waitFinished(account.accessToken, containerId, maxImagePolls);
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
