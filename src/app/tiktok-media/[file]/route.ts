import { downloadMedia } from "@/lib/media/store";
import { resolveTicket, shrinkJpeg, tokenFromFile } from "@/lib/sns/tiktok/media";
import { createAdminClient } from "@/lib/supabase/admin";

// TikTok に写真を渡す入口（https://yabumi.app/tiktok-media/<トークン>.jpg。docs/design/tiktok.md の 2.）。
// TikTok は 3xx を返す URL を取りに来ないので、ここは転送をせず、画像か 404 だけを返す。
// 末尾が .jpg なので、src/proxy.ts（ログインの確かめ・独自ドメインへの転送）を通らない
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

async function serve(file: string, withBody: boolean): Promise<Response> {
  const token = tokenFromFile(file);
  if (!token) return notFound();
  const admin = createAdminClient();
  const path = await resolveTicket(admin, token);
  if (!path) return notFound();
  try {
    const jpeg = shrinkJpeg(await downloadMedia(admin, path));
    return new Response(withBody ? Buffer.from(jpeg) : null, {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  } catch (e) {
    console.error("[tiktok] 画像を返せませんでした", e instanceof Error ? e.message : e);
    return notFound();
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/tiktok-media/[file]">) {
  const { file } = await ctx.params;
  return serve(file, true);
}

export async function HEAD(_request: Request, ctx: RouteContext<"/tiktok-media/[file]">) {
  const { file } = await ctx.params;
  return serve(file, false);
}
