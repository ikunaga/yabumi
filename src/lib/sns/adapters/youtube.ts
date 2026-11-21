import { consentHash } from "@/lib/sns/tiktok/send-check";
import {
  fetchMyChannel,
  putChunk,
  queryUpload,
  refreshTokens,
  startUploadSession,
  UPLOAD_CHUNK_BYTES,
  videoUrl,
  YouTubeApiError,
  type UploadProgress,
  type VideoMetadata,
  type YouTubeConfig,
} from "@/lib/sns/youtube/api";
import { SnsPublishError, type ContinueResult, type PrepareState, type PublishTarget, type PublishVideo, type SnsAdapter } from "./types";

// YouTube のアダプター（docs/design/youtube.md の 3.）。再開できるアップロードで、動画を 8MB ずつ送る。
// 1 回の呼び出しで送るのは UPLOAD_BUDGET_MS まで。残りは「準備中」にして次の回（1 分後）に続きから送る。
// アップロードが済んだら published にする（これより後は二度と上げ直さない）。途中の情報（セッションの URL・送った量・動画の ID）は
// youtube_uploads（サーバーだけ）に置き、post_targets.sns_container には段階と量だけを入れる（本人が読める列なので、URL は入れない）

// 送る動画（実装担当1 の src/lib/media/video-store.ts の PostVideo と同じ形。docs/design/video.md）
export type YouTubeVideo = {
  mediaId: string;
  sizeBytes: number;
  mime: "video/mp4";
  durationMs: number;
  width: number;
  height: number;
  aiGenerated: boolean;
  readRange(start: number, endExclusive: number): Promise<Uint8Array>;
};

// 送るときに利用者が選んで同意した設定（post_target_youtube の行）
export type YouTubeSettings = {
  privacy_status: "public" | "unlisted" | "private";
  made_for_kids: boolean;
  synthetic_media: boolean;
  category_id: string;
  consent_text_hash: string;
  consent_channel: string;
};

export type YouTubeTarget = { ownerId: string; postId: string; title: string; settings: YouTubeSettings | null };

// アップロードの途中の情報（youtube_uploads の行。セッションの URL は復号したもの）
// queried: false は、この回に始めたばかりのセッション（聞かなくても 0 からとわかる）。DB には持たない
export type YouTubeUploadRow = { sessionUri: string | null; bytesTotal: number; bytesSent: number; videoId: string | null; queried?: false };

export type QuotaVerdict = "ok" | "global" | "user";

export type YouTubeAdapterDeps = {
  config: () => YouTubeConfig;
  loadTarget: (targetId: string) => Promise<YouTubeTarget | null>;
  // 続きの回に動画を読み直す（実装担当1 の postVideoFor。送り終えて消したあとは "removed"）
  loadVideo: (postId: string) => Promise<YouTubeVideo | "removed" | null>;
  reserveUpload: (ownerId: string, targetId: string) => Promise<QuotaVerdict>;
  // 利用者ごとの 1 日の上限（文に出す）
  userDailyUploads: number;
  loadUpload: (targetId: string) => Promise<YouTubeUploadRow | null>;
  // 書く（セッションの URL は呼ぶ側で暗号化する）。videoId を入れたら、送ったあとの処理の確かめを始める
  saveUpload: (targetId: string, ownerId: string, row: YouTubeUploadRow) => Promise<void>;
  clearUpload: (targetId: string) => Promise<void>;
  // 1 回の呼び出しで送ってよい時間（既定 UPLOAD_BUDGET_MS）。テストで縮める
  budgetMs?: number;
  now?: () => number;
};

// 送信ジョブは 40 秒で切り上げる（JOB_DEADLINE_MS）。Vercel の 60 秒に収まるよう、1 回の呼び出しは 15 秒までにする
export const UPLOAD_BUDGET_MS = 15_000;
// 全体の割り当てに当たったときの文（Y3。太平洋時間の 0 時に戻る）
export const QUOTA_GLOBAL_MESSAGE = "今日の YouTube の送信の枠（yabumi 全体）がいっぱいです。日本時間の 17 時（夏時間の間は 16 時）を過ぎてから送り直すか、手動で投稿してください。";
export const quotaUserMessage = (n: number) => `YouTube は 1 日 ${n} 本まで送れます。明日送り直すか、手動で投稿してください。`;
const RECONNECT = "プロジェクトの設定の「つないだ SNS」からつなぎ直してください。";
const MAX_TITLE = 100;
const MAX_DESCRIPTION_BYTES = 5000;

type State = { stage: "uploading"; targetId: string; bytesSent: number };

export function youtubeTitleProblem(title: string): string | null {
  const t = title.trim();
  if (!t) return "YouTube のタイトルを入れてください。";
  if ([...t].length > MAX_TITLE) return `YouTube のタイトルは ${MAX_TITLE} 字までです。`;
  if (/[<>]/.test(t)) return "YouTube のタイトルには < と > を使えません。";
  return null;
}

export function youtubeDescriptionProblem(text: string): string | null {
  if (new TextEncoder().encode(text).length > MAX_DESCRIPTION_BYTES) return "YouTube の説明は 5,000 バイト（日本語でおよそ 1,600 字）までです。";
  if (/[<>]/.test(text)) return "YouTube の説明には < と > を使えません。";
  return null;
}

export function videoMetadata(title: string, description: string, s: YouTubeSettings): VideoMetadata {
  return {
    snippet: { title: title.trim(), description, categoryId: s.category_id },
    status: { privacyStatus: s.privacy_status, selfDeclaredMadeForKids: s.made_for_kids, containsSyntheticMedia: s.synthetic_media },
  };
}

// Google の失敗を、送信ジョブの扱い（やり直す・つなぎ直し・やり直さない）に分ける
export function toPublishError(e: unknown): SnsPublishError {
  if (e instanceof SnsPublishError) return e;
  if (e instanceof RangeError) return new SnsPublishError("permanent", "動画のファイルの大きさが合いません。動画を添え直してください。", { cause: e });
  if (e instanceof YouTubeApiError) {
    if (e.status === 401 || e.reason === "invalid_grant") return new SnsPublishError("auth", `YouTube とのつながりが切れています。${RECONNECT}`, { cause: e });
    if (e.reason === "quotaExceeded") return new SnsPublishError("permanent", QUOTA_GLOBAL_MESSAGE, { cause: e });
    if (e.reason === "uploadLimitExceeded") return new SnsPublishError("permanent", "YouTube の 1 日の上限に達しました。明日送り直すか、YouTube のアプリから投稿してください。", { cause: e });
    if (e.reason === "youtubeSignupRequired") return new SnsPublishError("permanent", "この Google のアカウントには YouTube のチャンネルがありません。YouTube でチャンネルを作ってから、つなぎ直してください。", { cause: e });
    if (e.status === 403 && (e.reason === "insufficientPermissions" || e.reason === "forbidden")) {
      return new SnsPublishError("auth", `YouTube に動画を上げる許可がありません。${RECONNECT}`, { cause: e });
    }
    if (e.status === 429 || e.status >= 500) return new SnsPublishError("retryable", "YouTube が混み合っています。少しあとで続きから送ります。", { cause: e });
    if (e.status === 400) return new SnsPublishError("permanent", `YouTube が動画の情報を受け付けませんでした（${e.message}）。投稿の画面で確認してください。`, { cause: e });
    return new SnsPublishError("permanent", `YouTube に送れませんでした（${e.status}）。`, { cause: e });
  }
  // 通信の失敗・動画を読めなかった（Storage）など。続きから送れるのでやり直す
  return new SnsPublishError("retryable", "YouTube に送る途中で通信が切れました。少しあとで続きから送ります。", { cause: e });
}

export function createYouTubeAdapter(deps: YouTubeAdapterDeps): SnsAdapter {
  const now = () => deps.now?.() ?? Date.now();

  // 送れるところまで送る。済んだら done、時間切れなら state
  async function pump(account: { accessToken: string }, target: YouTubeTarget, targetId: string, row: YouTubeUploadRow, video: YouTubeVideo): Promise<ContinueResult> {
    const started = now();
    const budget = deps.budgetMs ?? UPLOAD_BUDGET_MS;
    const sessionUri = row.sessionUri!;
    // どこまで受け取られたかを先に聞く（前の回の最後の答えが届かなかったときも、ここで済んだかがわかる）
    // 始めたばかりのセッション（まだ 1 バイトも送っていない）だけは聞かずに 0 から送る
    let progress: UploadProgress = row.bytesSent > 0 || row.queried !== false ? await queryUpload(sessionUri, account.accessToken, video.sizeBytes) : { done: false, received: 0 };
    const base: YouTubeUploadRow = { sessionUri: row.sessionUri, bytesTotal: row.bytesTotal, bytesSent: row.bytesSent, videoId: row.videoId };
    while (!progress.done) {
      const start = progress.received;
      if (start >= video.sizeBytes) {
        // 全部受け取られたのに完了の答えがない。次の回に聞き直す
        break;
      }
      if (now() - started >= budget) break;
      const end = Math.min(start + UPLOAD_CHUNK_BYTES, video.sizeBytes);
      const bytes = await video.readRange(start, end);
      progress = await putChunk(sessionUri, account.accessToken, bytes, start, video.sizeBytes);
      if (!progress.done) await deps.saveUpload(targetId, target.ownerId, { ...base, bytesSent: progress.received });
    }
    if (progress.done) {
      await deps.saveUpload(targetId, target.ownerId, { ...base, bytesSent: video.sizeBytes, videoId: progress.videoId });
      return { done: { externalPostId: progress.videoId, url: videoUrl(progress.videoId) } };
    }
    const state: State = { stage: "uploading", targetId, bytesSent: progress.received };
    return { state: state as unknown as PrepareState };
  }

  // セッションを始め直す（初めて・セッションが切れた）。割り当てを 1 本ぶん取ってから
  async function newSession(account: { accessToken: string }, target: YouTubeTarget, targetId: string, video: YouTubeVideo, text: string): Promise<YouTubeUploadRow> {
    const quota = await deps.reserveUpload(target.ownerId, targetId);
    if (quota === "global") throw new SnsPublishError("permanent", QUOTA_GLOBAL_MESSAGE);
    if (quota === "user") throw new SnsPublishError("permanent", quotaUserMessage(deps.userDailyUploads));
    const sessionUri = await startUploadSession(account.accessToken, videoMetadata(target.title, text, target.settings!), video.sizeBytes, video.mime);
    const row: YouTubeUploadRow = { sessionUri, bytesTotal: video.sizeBytes, bytesSent: 0, videoId: null };
    await deps.saveUpload(targetId, target.ownerId, row);
    return { ...row, queried: false };
  }

  type Ready = { done: true; videoId: string } | { done: false; target: YouTubeTarget; row: YouTubeUploadRow; video: YouTubeVideo };

  // 送る用意: 済んでいればその動画の ID、まだならセッション（なければ同意を確かめてから始める）と動画
  // given: 最初の回に送信ジョブが渡した動画（startPublishVideo）。続きの回は deps.loadVideo で読み直す
  async function prepare(account: { accessToken: string; externalId: string }, targetId: string, text: string | null, rawText: string | null, given?: YouTubeVideo): Promise<Ready> {
    const target = await deps.loadTarget(targetId);
    if (!target) throw new SnsPublishError("permanent", "YouTube の配信先が見つかりません。");
    let row = await deps.loadUpload(targetId);
    // もう上げ終えている（前の回の最後で記録した）。二度と上げ直さない
    if (row?.videoId) return { done: true, videoId: row.videoId };

    const loaded = given ?? (await deps.loadVideo(target.postId));
    // 送り終えて動画を消したあと（送信ジョブの最初の回と同じく、送り直すには動画を選び直す）
    if (loaded === "removed") throw new SnsPublishError("permanent", "添えていた動画は、送り終えたので消しました。投稿の画面で動画を選び直してから送り直してください。");
    const video = loaded;
    if (!video) throw new SnsPublishError("permanent", "YouTube に送る動画がありません。投稿に動画を添えてから送ってください。");
    if (row && row.bytesTotal !== video.sizeBytes) {
      // 動画を差し替えた。前のセッションは使わない
      await deps.clearUpload(targetId);
      row = null;
    }
    if (row?.sessionUri) return { done: false, target, row, video };

    // 初めて送る: 同意したときと変わっていないかを確かめてから（docs/design/youtube.md の 5.）
    if (text === null || rawText === null) throw new SnsPublishError("retryable", "YouTube の送信の途中の情報が見つかりません。最初から送り直します。");
    const s = target.settings;
    if (!s) throw new SnsPublishError("permanent", "YouTube の公開範囲などを選んで同意してから送ってください。投稿の画面で確認してください。");
    const problem = youtubeTitleProblem(target.title) ?? youtubeDescriptionProblem(text);
    if (problem) throw new SnsPublishError("permanent", problem);
    if (consentHash(target.title, rawText) !== s.consent_text_hash) {
      throw new SnsPublishError("permanent", "YouTube のタイトルか説明が、同意したあとに変わっていたので、送りませんでした。投稿の画面で確認してから、もう一度送ってください。");
    }
    const channel = await fetchMyChannel(account.accessToken);
    if (!channel || channel.id !== account.externalId || channel.title !== s.consent_channel) {
      throw new SnsPublishError("permanent", "つないでいる YouTube のチャンネルが、予約のときと違っていたので、送りませんでした。投稿の画面で確認してから、もう一度送ってください。");
    }
    return { done: false, target, row: await newSession(account, target, targetId, video, text), video };
  }

  return {
    sns: "youtube",
    // 準備（アップロード）に時間がかかっても、最初から送り直さない（二重に上げないため。続きから送る）
    restartOnPrepareTimeout: false,

    async publishText() {
      throw new SnsPublishError("permanent", "YouTube には動画が要ります。投稿に動画を添えてから送ってください。");
    },

    async deletePost() {
      // 取り消しは YouTube Studio から（2026-11-15 オーナーの決定 Y5。youtube.upload では消せない）
      throw new SnsPublishError("permanent", "YouTube の動画は、YouTube Studio から削除してください。");
    },

    async refreshWithRefreshToken(refreshToken, at) {
      try {
        const t = await refreshTokens(deps.config(), refreshToken, at);
        return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
      } catch (e) {
        if (e instanceof YouTubeApiError && (e.reason === "invalid_grant" || e.status === 401)) {
          throw new SnsPublishError("auth", `YouTube とのつながりが切れています。${RECONNECT}`, { cause: e });
        }
        throw toPublishError(e);
      }
    },

    // チャンネル名を読み直す（7 日ごとの取り直しのあと。保存した YouTube のデータは 30 日ごとに読み直す決まり）
    async refreshProfile(accessToken) {
      const channel = await fetchMyChannel(accessToken);
      return channel ? { displayName: channel.title, handle: channel.handle } : null;
    },

    // 7 日に 1 回は取り直して、まだ許可されているかを確かめる（開発者ポリシーの 30 日ごとの確かめ。docs/design/youtube.md の 2.2）
    shouldRotate(lastRefreshedAt, at) {
      return at.getTime() - lastRefreshedAt.getTime() >= 7 * 24 * 60 * 60 * 1000;
    },

    // 用意だけ（セッションを始める）。送るのは continuePublish（publisher が続けて呼ぶ）。1 回の呼び出しの時間を UPLOAD_BUDGET_MS に収めるため
    // 動画の投稿（送信ジョブの動画の受け口。docs/design/video.md の 5.）。用意だけ（セッションを始める）で、送るのは continuePublish
    // （publisher が続けて呼ぶ）。1 回の呼び出しの時間を UPLOAD_BUDGET_MS に収めるため
    async startPublishVideo(account, text, video: PublishVideo, target?: PublishTarget): Promise<PrepareState> {
      if (!target) throw new SnsPublishError("permanent", "YouTube の配信先がわかりません。");
      try {
        const r = await prepare(account, target.id, text, target.rawText, video ? { ...video, mime: "video/mp4", aiGenerated: false } : undefined);
        if (r.done) return { stage: "done", targetId: target.id, videoId: r.videoId } as unknown as PrepareState;
        const state: State = { stage: "uploading", targetId: target.id, bytesSent: r.row.bytesSent };
        return state as unknown as PrepareState;
      } catch (e) {
        throw toPublishError(e);
      }
    },

    async continuePublish(account, raw): Promise<ContinueResult> {
      const s = raw as unknown as { stage: string; targetId: string; videoId?: string };
      if (s.stage === "done" && s.videoId) return { done: { externalPostId: s.videoId, url: videoUrl(s.videoId) } };
      try {
        const r = await prepare(account, s.targetId, null, null);
        if (r.done) return { done: { externalPostId: r.videoId, url: videoUrl(r.videoId) } };
        try {
          return await pump(account, r.target, s.targetId, r.row, r.video);
        } catch (e) {
          // セッションが切れた（404）。アップロードは済んでいないので動画はできていない。次の回にセッションから始め直す
          if (e instanceof YouTubeApiError && e.status === 404) {
            await deps.clearUpload(s.targetId);
            throw new SnsPublishError("retryable", "YouTube のアップロードの受付が切れました。少しあとで最初から送り直します。", { cause: e });
          }
          throw e;
        }
      } catch (e) {
        throw toPublishError(e);
      }
    },
  };
}
