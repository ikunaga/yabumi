import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import jpeg from "jpeg-js";
import type { Database } from "@/lib/supabase/database.types";

// TikTok に写真を渡す入口（docs/design/tiktok.md の 2.）。TikTok の写真の投稿は PULL_FROM_URL だけで、所有を確かめた URL の前半
// （https://yabumi.app/tiktok-media/）の下しか取りに来ないので、yabumi の URL で画像を返す。
// - トークンは推測できない乱数（32 バイト）。DB には SHA-256 だけを持つ
// - 誰の・どの配信先の・どの画像かを結びつけ、1 時間で切れる（TikTok が取りに来る時間の上限と同じ）。送り終えたらその場で消す
// - 返すのは、トークンが指す画像が、いまもその配信先の投稿に添えてあるときだけ。それ以外はどれも同じ 404（理由は返さない）
// - TikTok の写真は 1080p までなので、長い辺 1080px に縮めた JPEG を返す（yabumi の画像は 2048px まで）

type Admin = SupabaseClient<Database>;

export const TICKET_TTL_MS = 60 * 60 * 1000;
export const TIKTOK_MAX_EDGE = 1080;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newTicketToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTicketToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// 「<トークン>.jpg」からトークンを取り出す（形が違えば null）
export function tokenFromFile(file: string): string | null {
  const m = /^(.+)\.jpg$/.exec(file);
  return m && TOKEN_PATTERN.test(m[1]) ? m[1] : null;
}

// 送る直前に、画像ごとの入口の URL を作る（並びは渡した順）。古い入口は消して作り直す
export async function issueMediaTickets(
  admin: Admin,
  args: { ownerId: string; postTargetId: string; mediaIds: string[]; baseUrl: string; now?: Date },
): Promise<string[]> {
  await clearMediaTickets(admin, args.postTargetId);
  const now = args.now ?? new Date();
  const tokens = args.mediaIds.map(() => newTicketToken());
  if (!tokens.length) return [];
  const { error } = await admin.from("tiktok_media_tickets").insert(
    tokens.map((t, i) => ({
      token_hash: hashTicketToken(t),
      owner_id: args.ownerId,
      post_target_id: args.postTargetId,
      media_id: args.mediaIds[i],
      expires_at: new Date(now.getTime() + TICKET_TTL_MS).toISOString(),
    })),
  );
  if (error) throw error;
  return tokens.map((t) => `${args.baseUrl.replace(/\/$/, "")}/tiktok-media/${t}.jpg`);
}

// 送り終えた（公開・失敗）・送るのをやめたときに、その配信先の入口を消す
export async function clearMediaTickets(admin: Admin, postTargetId: string): Promise<void> {
  const { error } = await admin.from("tiktok_media_tickets").delete().eq("post_target_id", postTargetId);
  if (error) throw error;
}

// 毎日の片付け: 期限の切れた入口を消す
export async function cleanupExpiredTickets(admin: Admin, now = new Date()): Promise<number> {
  const { data, error } = await admin.from("tiktok_media_tickets").delete().lt("expires_at", now.toISOString()).select("token_hash");
  if (error) throw error;
  return data.length;
}

// 入口のトークンから、返してよい画像の置き場所を決める。返せなければ null（呼ぶ側は 404）
export async function resolveTicket(admin: Admin, token: string, now = new Date()): Promise<string | null> {
  const { data: ticket } = await admin
    .from("tiktok_media_tickets")
    .select("owner_id, post_target_id, media_id, expires_at")
    .eq("token_hash", hashTicketToken(token))
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (!ticket) return null;
  const { data: target } = await admin.from("post_targets").select("post_id, owner_id, sns").eq("id", ticket.post_target_id).maybeSingle();
  if (!target || target.owner_id !== ticket.owner_id || target.sns !== "tiktok") return null;
  // いまもその投稿に添えてある、同じ持ち主の画像だけ（あとで外した画像は返さない）
  const { data: media } = await admin
    .from("media_files")
    .select("storage_path")
    .eq("id", ticket.media_id)
    .eq("owner_id", ticket.owner_id)
    .eq("kind", "image")
    .eq("post_id", target.post_id)
    .maybeSingle();
  return media?.storage_path ?? null;
}

// 長い辺を maxEdge までに縮めた JPEG（小さければそのまま返す）。面積の平均で縮める（ぎざぎざが出にくい）
export function shrinkJpeg(bytes: Uint8Array, maxEdge = TIKTOK_MAX_EDGE, quality = 90): Uint8Array {
  const src = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  if (scale >= 1) return bytes;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8Array(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return new Uint8Array(jpeg.encode({ data: out, width: w, height: h }, quality).data);
}
