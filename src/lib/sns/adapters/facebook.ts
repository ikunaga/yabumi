import {
  deletePost,
  FacebookApiError,
  finishReel,
  getPermalink,
  getReelStatus,
  startReelUpload,
  uploadReelFromUrl,
  postPhoto,
  postText,
  postWithPhotos,
  uploadUnpublishedPhoto,
} from "@/lib/sns/facebook/api";
import { SnsPublishError, type PrepareState, type SnsAdapter } from "./types";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001]);
// 権限がない（ページの役割を外された、権限を外したなど）
const PERMISSION_CODES = new Set([10, 200]);

const RECONNECT = "プロジェクトの設定の「つないだ SNS」からつなぎ直してください。";

// Facebook API のエラーを、送信ジョブが判断できる形に直す。
// stage が "publish" の通信エラー・障害は、公開されたかどうかわからないので unknown にする
export function toFacebookError(e: unknown, stage: "prepare" | "publish"): SnsPublishError {
  if (e instanceof SnsPublishError) return e;
  if (e instanceof FacebookApiError) {
    if (e.code === 190 || e.status === 401) {
      return new SnsPublishError("auth", `Facebook ページとのつながりが切れています。${RECONNECT}`, { cause: e });
    }
    if (e.code !== undefined && (PERMISSION_CODES.has(e.code) || (e.code >= 200 && e.code < 300))) {
      return new SnsPublishError(
        "permanent",
        `このページに投稿する権限がありません。ページの役割（投稿を作れる役割）を確認してから、${RECONNECT}`,
        { cause: e },
      );
    }
    if (e.status === 429 || (e.code !== undefined && RATE_LIMIT_CODES.has(e.code))) {
      return new SnsPublishError("retryable", "Facebook の回数制限にかかりました。時間をおいて送り直します。", { cause: e });
    }
    if (e.transient) {
      if (stage === "publish") {
        return new SnsPublishError("unknown", "Facebook 側でエラーが起きました。ページに投稿されているか確認してから、必要ならもう一度送ってください。", {
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
      "Facebook への投稿の途中で通信が切れました。ページに投稿されているか確認してから、必要ならもう一度送ってください。",
      { cause: e },
    );
  }
  return new SnsPublishError("retryable", "Facebook につながりませんでした。時間をおいて送り直します。", { cause: e });
}

// リールの準備の途中の状態（post_targets.sns_container）。finished: 公開（finish）を頼んだあと
type ReelState = { kind: "fb_reel"; videoId: string; finished?: boolean };

function parseReel(state: PrepareState): ReelState {
  const s = state as { kind?: unknown; videoId?: unknown; finished?: unknown };
  if (s.kind === "fb_reel" && typeof s.videoId === "string") return { kind: "fb_reel", videoId: s.videoId, ...(s.finished === true ? { finished: true } : {}) };
  throw new SnsPublishError("permanent", "送信の途中の記録が読めませんでした。もう一度送ってください。");
}

const reelRejected = (detail?: string) =>
  new SnsPublishError("permanent", `Facebook が動画を受け付けませんでした（${detail ?? "error"}）。動画を選び直して、もう一度送ってください。`);

// Facebook ページ。account.externalId はページの ID、accessToken はページのトークン（期限なし）
export function createFacebookAdapter(appSecret: () => string): SnsAdapter {
  return {
    sns: "facebook",

    // 動画はリールとして送る（docs/design/video.md の 5.）。受付と、Facebook に取りに来てもらうところまで。処理と公開は continuePublish
    async startPublishVideo(account, text, video) {
      const { accessToken: token, externalId: pageId } = account;
      try {
        const videoId = await startReelUpload(appSecret(), token, pageId);
        await uploadReelFromUrl(token, videoId, video.url);
        return { ...({ kind: "fb_reel", videoId } satisfies ReelState), text };
      } catch (e) {
        throw toFacebookError(e, "prepare");
      }
    },

    // 取り込みが終わったら公開を頼み（本文はここで付ける。startPublishVideo で受けた本文を state に持つ）、公開まで済んだら終わり。
    // まだなら同じ状態を返す（次の回にまた確かめる）
    async continuePublish(account, raw) {
      const state = parseReel(raw);
      const text = typeof (raw as { text?: unknown }).text === "string" ? String((raw as { text: string }).text) : "";
      const secret = appSecret();
      const { accessToken: token, externalId: pageId } = account;
      let status;
      try {
        status = await getReelStatus(secret, token, state.videoId);
      } catch (e) {
        throw toFacebookError(e, "prepare");
      }
      if (status.videoStatus === "error" || [status.uploading, status.processing, status.publishing].includes("error")) throw reelRejected(status.error);
      if (!state.finished) {
        if (status.uploading !== "complete") return { state: raw };
        try {
          await finishReel(secret, token, pageId, state.videoId, text);
        } catch (e) {
          throw toFacebookError(e, "publish");
        }
        return { state: { ...raw, finished: true } };
      }
      if (status.publishing !== "complete") return { state: raw };
      // URL は表示用。取れなくても送信は成功として扱う
      const url = await getPermalink(secret, token, state.videoId).catch(() => null);
      return { done: { externalPostId: state.videoId, url } };
    },

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
