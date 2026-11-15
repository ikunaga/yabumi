import { CANNOT_POST_CODES, TikTokApiError, fetchCreatorInfo, fetchPublishStatus, initPhotoPost, refreshTokens, type TikTokConfig } from "@/lib/sns/tiktok/api";
import { failureOf, photoInitBody, TIKTOK_MAX_PHOTOS, type TikTokSettings } from "@/lib/sns/tiktok/publish";
import { checkBeforeSend } from "@/lib/sns/tiktok/send-check";
import { SnsPublishError, type ContinueResult, type PrepareState, type PublishImage, type PublishTarget, type SnsAdapter } from "./types";

// TikTok のアダプター（docs/design/tiktok.md）。写真の投稿（直接投稿・下書き）を PULL_FROM_URL で送り、status/fetch で確かめる。
// 送る直前に creator_info を読み直し、同意したときの設定と変わっていたら送らない（4.）。
// トークンはアクセスが短い（いまの資料では 2 時間）ので、X と同じくリフレッシュトークンで取り直す（publisher の loadAccount が送る直前に取り直す）

export type TikTokTarget = { ownerId: string; title: string; settings: TikTokSettings | null };

export type TikTokAdapterDeps = {
  config: () => TikTokConfig;
  audited: () => boolean;
  loadTarget: (targetId: string) => Promise<TikTokTarget | null>;
  issueTickets: (args: { ownerId: string; postTargetId: string; mediaIds: string[] }) => Promise<string[]>;
  clearTickets: (postTargetId: string) => Promise<void>;
};

type State = { publishId: string; targetId: string; mode: "DIRECT_POST" | "MEDIA_UPLOAD"; username: string };

// リフレッシュトークンは日ごとに取り直して古くしない（使われないままの期限切れを防ぐ）
const ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function toError(e: unknown): never {
  if (e instanceof SnsPublishError) throw e;
  if (e instanceof TikTokApiError) {
    const f = e.status === 429 ? failureOf("rate_limit_exceeded") : e.status >= 500 ? failureOf("internal") : failureOf(e.code);
    throw new SnsPublishError(f.kind, f.message, { cause: e });
  }
  throw new SnsPublishError("retryable", "TikTok につながりませんでした。少しあとで送り直します。", { cause: e });
}

export function createTikTokAdapter(deps: TikTokAdapterDeps): SnsAdapter {
  return {
    sns: "tiktok",

    async publishText() {
      throw new SnsPublishError("permanent", "TikTok には写真が要ります。投稿に写真を添えてから送ってください（動画は準備中です）。");
    },

    async deletePost() {
      throw new SnsPublishError("permanent", "TikTok の投稿は、TikTok のアプリから削除してください。");
    },

    async refreshWithRefreshToken(refreshToken, now) {
      try {
        const t = await refreshTokens(deps.config(), refreshToken, now);
        return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
      } catch (e) {
        if (e instanceof TikTokApiError && (e.status === 400 || e.status === 401)) {
          throw new SnsPublishError("auth", "TikTok とのつながりが切れています。プロジェクトの設定の「つないだ SNS」からつなぎ直してください。", { cause: e });
        }
        return toError(e);
      }
    },

    shouldRotate(lastRefreshedAt, now) {
      return now.getTime() - lastRefreshedAt.getTime() >= ROTATE_AFTER_MS;
    },

    async startPublish(account, text, images: PublishImage[], target?: PublishTarget): Promise<PrepareState> {
      if (!target) throw new SnsPublishError("permanent", "TikTok の配信先がわかりません。");
      if (images.length === 0) throw new SnsPublishError("permanent", "TikTok には写真が要ります。投稿に写真を添えてから送ってください（動画は準備中です）。");
      if (images.length > TIKTOK_MAX_PHOTOS) throw new SnsPublishError("permanent", `TikTok に添えられる写真は ${TIKTOK_MAX_PHOTOS} 枚までです。`);
      const ctx = await deps.loadTarget(target.id);
      if (!ctx) throw new SnsPublishError("permanent", "TikTok の配信先が見つかりません。");
      try {
        // 送る直前の creator_info（投稿できない状態なら止める）
        let creator;
        try {
          creator = await fetchCreatorInfo(account.accessToken);
        } catch (e) {
          if (e instanceof TikTokApiError && (CANNOT_POST_CODES as readonly string[]).includes(e.code)) {
            const f = failureOf(e.code);
            throw new SnsPublishError("permanent", f.message, { cause: e });
          }
          throw e;
        }
        const reason = checkBeforeSend({ settings: ctx.settings, creator, title: ctx.title, description: target.rawText, audited: deps.audited() });
        if (reason) throw new SnsPublishError("permanent", reason);
        const settings = ctx.settings!;
        const mediaIds = images.map((i) => i.mediaId).filter((x): x is string => Boolean(x));
        if (mediaIds.length !== images.length) throw new SnsPublishError("permanent", "TikTok に渡す写真がわかりません。");
        const urls = await deps.issueTickets({ ownerId: ctx.ownerId, postTargetId: target.id, mediaIds });
        // AI で作った画像が 1 枚でもあれば、TikTok で AI の印を付ける（いまの画像から決める。docs/design/tiktok.md の 10.）
        const isAigc = settings.is_aigc || images.some((i) => i.aiGenerated);
        const publishId = await initPhotoPost(account.accessToken, photoInitBody({ settings: { ...settings, is_aigc: isAigc }, title: ctx.title, description: text, urls }));
        const state: State = { publishId, targetId: target.id, mode: settings.post_mode, username: creator.username || settings.consent_username };
        return state;
      } catch (e) {
        await deps.clearTickets(target.id).catch(() => undefined);
        return toError(e);
      }
    },

    async continuePublish(account, raw): Promise<ContinueResult> {
      const state = raw as unknown as State;
      let s;
      try {
        s = await fetchPublishStatus(account.accessToken, state.publishId);
      } catch (e) {
        return toError(e);
      }
      if (s.status === "PROCESSING_DOWNLOAD" || s.status === "PROCESSING_UPLOAD" || s.status === "") return { state: raw };
      await deps.clearTickets(state.targetId).catch(() => undefined);
      if (s.status === "FAILED") {
        const f = failureOf(s.failReason);
        throw new SnsPublishError(f.kind, f.message);
      }
      // 下書きは受信箱に届いたところで終わり（仕上げて投稿するのは利用者。docs/design/tiktok.md の 8.）
      if (s.status === "SEND_TO_USER_INBOX") return { done: { externalPostId: state.publishId, url: null } };
      // 公開の投稿は、TikTok の審査が済むまで ID が来ない。来ていれば URL も作る
      const postId = s.postIds[0];
      const url = postId && state.username ? `https://www.tiktok.com/@${state.username}/photo/${postId}` : null;
      return { done: { externalPostId: postId ?? state.publishId, url } };
    },
  };
}

