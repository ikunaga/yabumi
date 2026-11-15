// 投稿に添える動画の決まり（docs/design/video.md。2026-11-15 オーナーが W1〜W6 をおすすめで了承）。
// 画像の決まりは rules.ts。動画は別のバケット（post-videos）に置き、上限も別に数える

export const VIDEO_BUCKET = "post-videos";
export const VIDEO_MIME = "video/mp4";

// 1 本の上限（Supabase Free の 1 ファイルの上限。Pro にしたら上げられる。video.md の 1.）
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// ブラウザで作るときの目安（50MB に収める。下の videoBitrate）
export const TARGET_VIDEO_BYTES = 48 * 1024 * 1024;

// 長さ（W3: 一律 3〜90 秒。3 秒は Instagram・Facebook の下限、90 秒は Facebook リールの上限）
export const MIN_VIDEO_MS = 3_000;
export const MAX_VIDEO_MS = 90_000;

// 縦横（9:16 の 1080×1920 に収める。540×960 は Facebook リールの下限）
export const VIDEO_OUT_WIDTH = 1080;
export const VIDEO_OUT_HEIGHT = 1920;
export const VIDEO_MIN_WIDTH = 540;
export const VIDEO_MIN_HEIGHT = 960;
export const VIDEO_FPS = 30;
// キーフレームの間（秒。Facebook の closed GOP 2〜5 秒、X の open GOP 不可）
export const VIDEO_KEYFRAME_SECONDS = 2;
export const MAX_VIDEO_BITRATE = 6_000_000;

// 上限（W4。video.md の 7.・8.）
export const MAX_PENDING_VIDEO_TICKETS = 2;
export const MAX_UNATTACHED_VIDEOS = 3;
export const VIDEO_USER_QUOTA_BYTES = 300 * 1024 * 1024;
export const VIDEO_MONTH_LIMIT = 20;
export const VIDEO_GLOBAL_QUOTA_BYTES = 500 * 1024 * 1024;

// 送り終えて消すまで（W6。送れなかった配信先が残っていれば 7 日）
export const KEEP_VIDEO_AFTER_SENT_DAYS = 1;
export const KEEP_VIDEO_AFTER_FAILED_DAYS = 7;

// サーバーが読むときの署名 URL の長さ（秒。postVideoFor の readRange が使い回す）
export const VIDEO_READ_URL_SECONDS = 5 * 60;

// 保存先のパス: <利用者の ID>/<乱数>.mp4
export function videoPath(ownerId: string, id: string): string {
  return `${ownerId}/${id}.mp4`;
}

export function isOwnVideoPath(ownerId: string, path: string): boolean {
  return new RegExp(`^${ownerId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.mp4$`).test(path);
}

// 映像のビットレート（bps）。音声と合わせて TARGET_VIDEO_BYTES に収まり、MAX_VIDEO_BITRATE を超えない
export function videoBitrate(durationMs: number, audioBitrate: number): number {
  const seconds = Math.max(durationMs, MIN_VIDEO_MS) / 1000;
  const fit = Math.floor((TARGET_VIDEO_BYTES * 8) / seconds) - audioBitrate;
  return Math.max(500_000, Math.min(MAX_VIDEO_BITRATE, fit));
}

// 長さを mm:ss で（画面の「▶ 0:42」）
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
