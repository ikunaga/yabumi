import type { SnsKey } from "@/lib/sns";

// 投稿に添える画像の決まり（docs/architecture.md の 4.18）。画面とサーバーの両方から読む

export const MEDIA_BUCKET = "post-media";

// 1 枚の上限。いちばん厳しい Facebook の写真（4MB）に合わせる。X は 5MB、Threads・Instagram は 8MB
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// ブラウザで縮めるときの長い辺。X は 4096、Threads・Instagram は幅 1440 を超えると SNS 側で縮める
export const MAX_LONG_EDGE = 2048;
// 縮めた JPEG の画質（0〜1）。4MB を超えたら下げてやり直す
export const JPEG_QUALITY = 0.85;

// これより大きい画像は受け付けない（壊れた・異常なファイルを避ける）
export const MAX_DIMENSION = 8192;

// 1 つの投稿に添えられる枚数（Instagram のカルーセルの上限。X は 4 枚までなので、X には先頭から 4 枚ではなく「多すぎます」と出す）
export const MAX_IMAGES_PER_POST = 10;

// 利用者ごとに置ける合計の大きさ。Supabase Free の Storage は全体で 1GB
export const USER_QUOTA_BYTES = 100 * 1024 * 1024;

// 投稿に添えないまま置ける枚数（上げたまま保存しなかった画像。1 日で消える）
export const MAX_UNATTACHED = 20;

// 代わりの文（alt）の上限。X・Threads・Instagram とも 1,000 字
export const MAX_ALT_LENGTH = 1000;

// 送ってから画像を消すまでの日数（DB の cleanup_media_candidates と同じ）
export const KEEP_AFTER_SENT_DAYS = 30;

// 画面のプレビューの署名 URL の長さ（秒）
export const PREVIEW_URL_SECONDS = 60 * 60;
// SNS が画像を取りに来る署名 URL の長さ（秒）。送る直前に作る（予約の時刻とは関係しない）。
// Threads・Instagram はコンテナを作るときに取りに来て、処理に数十秒〜数分かかることがあるので、余裕を見て 1 時間
export const SNS_FETCH_URL_SECONDS = 60 * 60;

// 保存先のパス: <利用者の ID>/<乱数>.jpg
export function mediaPath(ownerId: string, id: string): string {
  return `${ownerId}/${id}.jpg`;
}

export function isOwnMediaPath(ownerId: string, path: string): boolean {
  return new RegExp(`^${ownerId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`).test(path);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

// 画像を送るのに、つないだときにはなかった権限が要る SNS。X は 2026-10-11 に media.write を足したので、
// それより前につないだアカウントは、つなぎ直すまで画像を送れない
export const IMAGE_SCOPES: Partial<Record<SnsKey, string>> = { x: "media.write" };

export function lacksImageScope(sns: SnsKey, scopes: readonly string[]): boolean {
  const needed = IMAGE_SCOPES[sns];
  return Boolean(needed && !scopes.includes(needed));
}
