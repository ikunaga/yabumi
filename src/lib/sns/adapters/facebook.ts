import {
  deletePost,
  FacebookApiError,
  getPermalink,
  postPhoto,
  postText,
  postWithPhotos,
  uploadUnpublishedPhoto,
} from "@/lib/sns/facebook/api";
import { SnsPublishError, type SnsAdapter } from "./types";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001]);
// 権限がない（ページの役割を外された、権限を外したなど）
const PERMISSION_CODES = new Set([10, 200]);

const RECONNECT = "概要の「つないだ SNS」からつなぎ直してください。";

// Facebook API のエラーを、送信ジョブが判断できる形に直す。
// stage が "publish" の通信エラー・障害は、公開されたかどうかわからないので unknown にする
export function toFacebookError(e: unknown, stage: "prepare" | "publish"): SnsPublishError {
  if (e instanceof SnsPublishError) return e;
  if (e instanceof FacebookApiError) {
    if (e.code === 190 || e.status === 401) {
      return new SnsPublishError("auth", `Facebook ページの接続が切れています。${RECONNECT}`, { cause: e });
    }
    if (e.code !== undefined && (PERMISSION_CODES.has(e.code) || (e.code >= 200 && e.code < 300))) {
      return new SnsPublishError(
        "permanent",
        `このページに投稿する権限がありません。ページの役割（投稿を作れる役割）を確かめてから、${RECONNECT}`,
        { cause: e },
      );
    }
    if (e.status === 429 || (e.code !== undefined && RATE_LIMIT_CODES.has(e.code))) {
      return new SnsPublishError("retryable", "Facebook の回数制限にかかりました。時間をおいて送り直します。", { cause: e });
    }
    if (e.transient) {
      if (stage === "publish") {
        return new SnsPublishError("unknown", "Facebook 側でエラーが起きました。ページに投稿されているか確かめてから、必要ならもう一度送ってください。", {
          cause: e,
        });
      }
      return new SnsPublishError("retryable", "Facebook 側で一時的なエラーが起きました。時間をおいて送り直します。", { cause: e });
    }
    return new SnsPublishError("permanent", `Facebook ページに送れませんでした（${e.message}）`, { cause: e });
  }
  if (stage === "publish") {
    return new SnsPublishError(
      "unknown",
      "Facebook への投稿の途中で通信が切れました。ページに投稿されているか確かめてから、必要ならもう一度送ってください。",
      { cause: e },
    );
  }
  return new SnsPublishError("retryable", "Facebook につながりませんでした。時間をおいて送り直します。", { cause: e });
}

// Facebook ページ。account.externalId はページの ID、accessToken はページのトークン（期限なし）
export function createFacebookAdapter(appSecret: () => string): SnsAdapter {
  return {
    sns: "facebook",

    async publishText(account, text, images = []) {
      const secret = appSecret();
      const { accessToken: token, externalId: pageId } = account;
      let postId: string;
      if (images.length <= 1) {
        try {
          postId = images.length === 0 ? await postText(secret, token, pageId, text) : await postPhoto(secret, token, pageId, images[0].url, text);
        } catch (e) {
          throw toFacebookError(e, "publish");
        }
      } else {
        // 複数枚: 画像を公開せずに上げてから、並べて 1 つの投稿にする。上げるところで失敗しても投稿はされない
        const photoIds: string[] = [];
        try {
          for (const image of images) photoIds.push(await uploadUnpublishedPhoto(secret, token, pageId, image.url));
        } catch (e) {
          throw toFacebookError(e, "prepare");
        }
        try {
          postId = await postWithPhotos(secret, token, pageId, photoIds, text);
        } catch (e) {
          throw toFacebookError(e, "publish");
        }
      }
      // URL は表示用。取れなくても送信は成功として扱う
      const url = await getPermalink(secret, token, postId).catch(() => null);
      return { externalPostId: postId, url };
    },

    async deletePost(account, externalPostId) {
      try {
        await deletePost(appSecret(), account.accessToken, externalPostId);
      } catch (e) {
        throw toFacebookError(e, "prepare");
      }
    },
  };
}
