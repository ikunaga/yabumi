import {
  appendVideoChunk,
  createPost,
  createPostWithMedia,
  deletePost,
  finalizeVideoUpload,
  initVideoUpload,
  postUrl,
  refreshTokens,
  setImageAltText,
  uploadImage,
  videoUploadStatus,
  X_VIDEO_CHUNK_BYTES,
  XApiError,
  type XConfig,
} from "@/lib/sns/x/api";
import { xPostCostUsd, xPostOperation } from "@/lib/sns/x/pricing";
import { SnsPublishError, type PrepareState, type SnsAdapter } from "./types";

const RECONNECT = "プロジェクトの設定の「つないだ SNS」からつなぎ直してください。";
const MANUAL = "送信の結果から、手動で投稿して記録することもできます。";

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
      // yabumi の X のアプリの残高・上限の話なので、運営者向けにはログに出す
      console.warn("[x] API の上限、またはクレジット切れで断られました", e.status, e.code ?? "");
      return new SnsPublishError(
        "permanent",
        `X の API の利用の上限に達したため、送れませんでした。時間をおいて、もう一度送ってください。${MANUAL}`,
        { cause: e },
      );
    }
    if (e.status >= 500) {
      if (stage === "publish") {
        return new SnsPublishError(
          "unknown",
          "X 側でエラーが起きました。X に投稿されているか確認してから、必要ならもう一度送ってください。",
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
      "X への投稿の途中で通信が切れました。X に投稿されているか確認してから、必要ならもう一度送ってください。",
      { cause: e },
    );
  }
  return new SnsPublishError("retryable", "X につながりませんでした。時間をおいて送り直します。", { cause: e });
}

// 使われないリフレッシュトークンが古くならないよう、最後の取り直しから 30 日で取り直す
export const X_ROTATE_AFTER_DAYS = 30;

// 動画の準備の途中の状態（post_targets.sns_container）。上げ終えて X の処理を待っている。本文は投稿するときに使う
type XVideoState = { kind: "x_video"; mediaId: string; text: string };

function parseXVideo(state: PrepareState): XVideoState {
  const s = state as { kind?: unknown; mediaId?: unknown; text?: unknown };
  if (s.kind === "x_video" && typeof s.mediaId === "string" && typeof s.text === "string") return { kind: "x_video", mediaId: s.mediaId, text: s.text };
  throw new SnsPublishError("permanent", "送信の途中の記録が読めませんでした。もう一度送ってください。");
}

const xVideoRejected = (detail?: string) =>
  new SnsPublishError("permanent", `X が動画を受け付けませんでした（${detail ?? "failed"}）。動画を選び直して、もう一度送ってください。`);

export function createXAdapter(config: () => XConfig): SnsAdapter {
  // 処理が済んでいれば投稿する。まだなら状態を返す（次の回にまた確かめる）
  async function postWhenReady(token: string, state: XVideoState, processing: { state: string; error?: string } | null) {
    if (processing && processing.state === "failed") throw xVideoRejected(processing.error);
    if (processing && processing.state !== "succeeded") return { state: state as PrepareState };
    let id: string;
    try {
      ({ id } = await createPostWithMedia(token, state.text, [state.mediaId]));
    } catch (e) {
      throw toXPublishError(e, "publish");
    }
    return { done: { externalPostId: id, url: postUrl(id) } };
  }

  return {
    sns: "x",

    // 動画: yabumi のサーバーが Storage から 5MB ずつ読んで X に送る（X は取りに来ない）。上げただけでは投稿されないので、
    // ここでの失敗はやり直しても二重にならない。処理の続きと投稿は continuePublish
    async startPublishVideo(account, text, video) {
      const token = account.accessToken;
      let mediaId: string;
      let processing;
      try {
        mediaId = await initVideoUpload(token, video.sizeBytes);
        for (let at = 0, i = 0; at < video.sizeBytes; at += X_VIDEO_CHUNK_BYTES, i++) {
          await appendVideoChunk(token, mediaId, i, await video.readRange(at, Math.min(at + X_VIDEO_CHUNK_BYTES, video.sizeBytes)));
        }
        processing = await finalizeVideoUpload(token, mediaId);
      } catch (e) {
        throw toXPublishError(e, "prepare");
      }
      if (processing?.state === "failed") throw xVideoRejected(processing.error);
      return { kind: "x_video", mediaId, text, ...(processing && processing.state !== "succeeded" ? {} : { ready: true }) };
    },

    async continuePublish(account, raw) {
      const state = parseXVideo(raw);
      if ((raw as { ready?: unknown }).ready === true) return postWhenReady(account.accessToken, state, null);
      let processing;
      try {
        processing = await videoUploadStatus(account.accessToken, state.mediaId);
      } catch (e) {
        throw toXPublishError(e, "prepare");
      }
      return postWhenReady(account.accessToken, state, processing);
    },

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
        ({ id } = mediaIds.length ? await createPostWithMedia(account.accessToken, text, mediaIds, images.some((i) => i.aiGenerated)) : await createPost(account.accessToken, text));
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
