import { downloadMedia } from "@/lib/media/store";
import { resolveTicket, shrinkJpeg, tokenFromFile } from "@/lib/sns/tiktok/media";
import { createAdminClient } from "@/lib/supabase/admin";

// TikTok に写真を渡す入口（https://yabumi.app/tiktok-media/<トークン>.jpg。docs/design/tiktok.md の 2.）。
// TikTok は 3xx を返す URL を取りに来ないので、ここは転送をせず、画像か 404 だけを返す。
// 末尾が .jpg なので、src/proxy.ts（ログインの確かめ・独自ドメインへの転送）を通らない
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

const HEADERS = { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

// GET: 引換券を確かめ、画像を読んで縮めて返す
async function serve(file: string): Promise<Response> {
  const token = tokenFromFile(file);
  if (!token) return notFound();
  const admin = createAdminClient();
  const path = await resolveTicket(admin, token);
  if (!path) return notFound();
  try {
    const jpeg = shrinkJpeg(await downloadMedia(admin, path));
    return new Response(Buffer.from(jpeg), { status: 200, headers: { ...HEADERS, "Content-Length": String(jpeg.length) } });
  } catch (e) {
    console.error("[tiktok] 画像を返せませんでした", e instanceof Error ? e.message : e);
    return notFound();
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/tiktok-media/[file]">) {
  const { file } = await ctx.params;
  return serve(file);
}

// HEAD: 引換券を確かめるだけで、画像の読み込みと縮める処理はしない（ヘッダーだけ。何度も HEAD を送って、重い処理をさせられないように。
// セキュリティ確認の R1）。大きさは縮めるまでわからないので Content-Length は付けない
export async function HEAD(_request: Request, ctx: RouteContext<"/tiktok-media/[file]">) {
  const { file } = await ctx.params;
  const token = tokenFromFile(file);
  if (!token) return notFound();
  const path = await resolveTicket(createAdminClient(), token);
  if (!path) return notFound();
  return new Response(null, { status: 200, headers: HEADERS });
}
