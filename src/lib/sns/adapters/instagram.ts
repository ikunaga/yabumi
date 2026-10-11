import {
  createCarouselContainer,
  createImageContainer,
  getContainerStatus,
  getPermalink,
  InstagramApiError,
  publishContainer,
  refreshLongLived,
  shouldRefresh,
} from "@/lib/sns/instagram/api";
import { continueStaged, type StagedOps } from "./staged";
import { SnsPublishError, type SnsAdapter } from "./types";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
// 24 時間に公開できる数（100 件）を超えた
const PUBLISH_LIMIT_SUBCODE = 2207042;

const RECONNECT = "概要の「つないだ SNS」からつなぎ直してください。";

// Instagram の投稿は、Instagram Login では API で消せない（docs/architecture.md の 4.21）。画面では取り消しのボタンを出さない
export const INSTAGRAM_DELETE_UNSUPPORTED =
  "Instagram の投稿は、矢書からは取り消せません。Instagram のアプリで投稿を開き、「…」→「削除」から消してください。";

// Instagram API のエラーを、送信ジョブが判断できる形に直す。
// stage が "publish" の通信エラー・障害は、公開されたかどうかわからないので unknown にする
export function toInstagramError(e: unknown, stage: "prepare" | "publish"): SnsPublishError {
  if (e instanceof SnsPublishError) return e;
  if (e instanceof InstagramApiError) {
    if (e.code === 190 || e.status === 401) {
      return new SnsPublishError("auth", `Instagram の接続が切れています。${RECONNECT}`, { cause: e });
    }
    if (e.subcode === PUBLISH_LIMIT_SUBCODE) {
      return new SnsPublishError("permanent", "Instagram の 24 時間に投稿できる数（100 件）を超えました。時間をおいてから送り直してください。", {
        cause: e,
      });
    }
    if (e.status === 429 || (e.code !== undefined && RATE_LIMIT_CODES.has(e.code))) {
      return new SnsPublishError("retryable", "Instagram の回数制限にかかりました。時間をおいて送り直します。", { cause: e });
    }
    if (e.transient) {
      if (stage === "publish") {
        return new SnsPublishError("unknown", "Instagram 側でエラーが起きました。Instagram に投稿されているか確かめてから、必要ならもう一度送ってください。", {
          cause: e,
        });
      }
      return new SnsPublishError("retryable", "Instagram 側で一時的なエラーが起きました。時間をおいて送り直します。", { cause: e });
    }
    return new SnsPublishError("permanent", `Instagram に送れませんでした（${e.message}）`, { cause: e });
  }
  if (stage === "publish") {
    return new SnsPublishError(
      "unknown",
      "Instagram への公開の途中で通信が切れました。Instagram に投稿されているか確かめてから、必要ならもう一度送ってください。",
      { cause: e },
    );
  }
  return new SnsPublishError("retryable", "Instagram につながりませんでした。時間をおいて送り直します。", { cause: e });
}

type Options = { sleep?: (ms: number) => Promise<void>; pollIntervalMs?: number; maxPolls?: number };

export function createInstagramAdapter({
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollIntervalMs = 3000,
  // 画像は Instagram が取りに来て処理する。3 秒 × 15 回 = 最大 45 秒（送信のジョブの時間の上限の中に収める）
  maxPolls = 15,
}: Options = {}): SnsAdapter {
  async function waitFinished(token: string, containerId: string) {
    for (let i = 0; ; i++) {
      const { status, detail } = await getContainerStatus(token, containerId);
      if (status === "FINISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new SnsPublishError("permanent", `Instagram が投稿を受け付けませんでした（${detail ?? status}）。画像の縦横比や大きさを確かめてください。`);
      }
      if (i + 1 >= maxPolls) {
        // 公開していないコンテナは投稿されないので、やり直しても二重にはならない
        throw new SnsPublishError("retryable", "Instagram 側の準備に時間がかかっています。時間をおいて送り直します。");
      }
      await sleep(pollIntervalMs);
    }
  }

  // 画像つきの投稿を段階で進めるときの、Instagram の呼び出し（staged.ts）
  const staged = (token: string, igUserId: string): StagedOps => ({
    label: "Instagram",
    status: (id) => getContainerStatus(token, id),
    createCarousel: (children, text) => createCarouselContainer(token, igUserId, children, text),
    publish: (id) => publishContainer(token, igUserId, id),
    permalink: (mediaId) => getPermalink(token, mediaId),
    toError: toInstagramError,
  });

  return {
    sns: "instagram",

    // コンテナを作るだけで待たない。準備の続きは continuePublish（次の回の送信ジョブ）で確かめる
    async startPublish(account, text, images) {
      if (images.length === 0) {
        throw new SnsPublishError("permanent", "Instagram には画像が必要です。画像を 1 枚以上添えてください。");
      }
      const { accessToken: token, externalId: igUserId } = account;
      try {
        if (images.length === 1) {
          const [image] = images;
          return { kind: "single", id: await createImageContainer(token, igUserId, image.url, { caption: text, altText: image.altText || undefined }) };
        }
        const children: string[] = [];
        for (const image of images) {
          children.push(await createImageContainer(token, igUserId, image.url, { carouselItem: true, altText: image.altText || undefined }));
        }
        return { kind: "carousel", children, text };
      } catch (e) {
        throw toInstagramError(e, "prepare");
      }
    },

    continuePublish(account, state) {
      return continueStaged(staged(account.accessToken, account.externalId), state);
    },

    async publishText(account, text, images = []) {
      if (images.length === 0) {
        throw new SnsPublishError("permanent", "Instagram には画像が必要です。画像を 1 枚以上添えてください。");
      }
      const token = account.accessToken;
      const igUserId = account.externalId;
      let containerId: string;
      try {
        if (images.length === 1) {
          const [image] = images;
          containerId = await createImageContainer(token, igUserId, image.url, { caption: text, altText: image.altText || undefined });
        } else {
          // カルーセル: 1 枚ずつのコンテナを作り、まとめたコンテナに本文を付ける（10 枚まで。1 件として数えられる）
          const children: string[] = [];
          for (const image of images) {
            const child = await createImageContainer(token, igUserId, image.url, { carouselItem: true, altText: image.altText || undefined });
            await waitFinished(token, child);
            children.push(child);
          }
          containerId = await createCarouselContainer(token, igUserId, children, text);
        }
        await waitFinished(token, containerId);
      } catch (e) {
        throw toInstagramError(e, "prepare");
      }

      let mediaId: string;
      try {
        mediaId = await publishContainer(token, igUserId, containerId);
      } catch (e) {
        throw toInstagramError(e, "publish");
      }
      // URL は表示用。取れなくても送信は成功として扱う
      const url = await getPermalink(token, mediaId).catch(() => null);
      return { externalPostId: mediaId, url };
    },

    async deletePost() {
      throw new SnsPublishError("permanent", INSTAGRAM_DELETE_UNSUPPORTED);
    },

    async refreshToken(accessToken, now) {
      try {
        return await refreshLongLived(accessToken, now);
      } catch (e) {
        throw toInstagramError(e, "prepare");
      }
    },

    shouldRefresh,
  };
}
