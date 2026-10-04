import { timingSafeEqual } from "node:crypto";

// ジョブ API の合言葉。pg_cron が Authorization: Bearer <CRON_SECRET> を付けて呼ぶ（README の「予約投稿のジョブ」）
export function isAuthorizedJob(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const a = Buffer.from(authorization.slice("Bearer ".length));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
