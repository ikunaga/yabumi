import { createPost, createPostWithMedia, deletePost, postUrl, refreshTokens, setImageAltText, uploadImage, XApiError, type XConfig } from "@/lib/sns/x/api";
import { xPostCostUsd, xPostOperation } from "@/lib/sns/x/pricing";
import { SnsPublishError, type SnsAdapter } from "./types";

const RECONNECT = "概要の「つないだ SNS」からつなぎ直してください。";
const MANUAL = "送信の結果から、手で投稿して記録することもできます。";

// X の上限・クレジット切れを表す problem の種類
const CAP_CODES = new Set(["UsageCapExceeded", "CreditsDepleted", "client-not-enrolled", "ClientForbidden"]);

// X API のエラーを、送信ジョブが判断できる形に直す。
// 回数の上限・クレジット切れは、やり直すと費用や失敗が重なるので自動ではやり直さない（決定 D16）。
// stage が "publish" で X 側の障害・通信エラーのときは、投稿されたかどうかわからないので unknown にする
export function toXPublishError(e: unknown, stage: "prepare" | "publish"): SnsPublishError {
  if (e instanceof SnsPublishError) return e;
  if (e instanceof XApiError) {
    if (e.status === 401 || e.code === "invalid_grant" || e.code === "invalid_token") {
      return new SnsPublishError("auth", `X とのつながりが切れています。${RECONNECT}`, { cause: e });
    }
    if (e.status === 402 || e.status === 429 || (e.code !== undefined && CAP_CODES.has(e.code))) {
      return new SnsPublishError(
        "permanent",
        `X の API の上限、またはクレジット切れで断られました。X の Developer Console で残高と上限を確かめてください。${MANUAL}`,
        { cause: e },
      );
    }
    if (e.status >= 500) {
      if (stage === "publish") {
        return new SnsPublishError(
          "unknown",
          "X 側でエラーが起きました。X に投稿されているか確かめてから、必要ならもう一度送ってください。",
          { cause: e },
        );
      }
      return new SnsPublishError("retryable", "X 側で一時的なエラーが起きました。時間をおいて送り直します。", { cause: e });
    }
    if (e.status === 403 && /media\.write|scope|not permitted to perform/i.test(e.message)) {
      // 接続そのものは使えるので期限切れにはしない（文章だけの投稿は送れる）
      return new SnsPublishError("permanent", `X に画像を送る権限がありません。${RECONNECT}`, { cause: e });
    }
    if (e.status === 403 && /duplicate/i.test(e.message)) {
      return new SnsPublishError("permanent", "X は同じ文面の投稿を続けて受け付けません。文面を変えてください。", { cause: e });
    }
    return new SnsPublishError("permanent", `X に送れませんでした（${e.message}）`, { cause: e });
  }
  if (stage === "publish") {
    return new SnsPublishError(
      "unknown",
      "X への投稿の途中で通信が切れました。X に投稿されているか確かめてから、必要ならもう一度送ってください。",
      { cause: e },
    );
  }
  return new SnsPublishError("retryable", "X につながりませんでした。時間をおいて送り直します。", { cause: e });
}

// 使われないリフレッシュトークンが古くならないよう、最後の取り直しから 30 日で取り直す
export const X_ROTATE_AFTER_DAYS = 30;

export function createXAdapter(config: () => XConfig): SnsAdapter {
  return {
    sns: "x",

    async publishText(account, text, images = []) {
      // 画像を先に上げる（上げただけでは投稿されないので、ここでの失敗はやり直しても二重にならない）
      const mediaIds: string[] = [];
      try {
        for (const image of images) {
          const mediaId = await uploadImage(account.accessToken, await image.load());
          if (image.altText) await setImageAltText(account.accessToken, mediaId, image.altText);
          mediaIds.push(mediaId);
        }
      } catch (e) {
        throw toXPublishError(e, "prepare");
      }

      let id: string;
      try {
        ({ id } = mediaIds.length ? await createPostWithMedia(account.accessToken, text, mediaIds) : await createPost(account.accessToken, text));
      } catch (e) {
        throw toXPublishError(e, "publish");
      }
      return { externalPostId: id, url: postUrl(id) };
    },

    async deletePost(account, externalPostId) {
      try {
        await deletePost(account.accessToken, externalPostId);
      } catch (e) {
        throw toXPublishError(e, "prepare");
      }
    },

    async refreshWithRefreshToken(refreshToken, now) {
      try {
        return await refreshTokens(config(), refreshToken, now);
      } catch (e) {
        throw toXPublishError(e, "prepare");
      }
    },

    shouldRotate(lastRefreshedAt, now) {
      return now.getTime() - lastRefreshedAt.getTime() >= X_ROTATE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    },

    publishCost(text, images = []) {
      return { operation: xPostOperation(text), costUsd: xPostCostUsd(text, images.filter((i) => i.altText).length) };
    },
  };
}
