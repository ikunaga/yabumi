import { NextResponse } from "next/server";
import { headlineInput, initialHeadline } from "@/lib/media/headline";
import { SERVER_FONTS } from "@/lib/media/server-fonts";
import { renderTemplateJpeg } from "@/lib/media/template-render-server";
import { FONT_KEYS, type FontKey } from "@/lib/media/templates";
import { currentOperatorEmail } from "@/lib/waitlist/operator-server";

// サーバーで見出しを描けるかの試し（docs/design/auto-sample-image.md の 11.。段取り ④。Vercel の Preview で @napi-rs/canvas と書体が動くかを確かめる）。
// 運営者（OPERATOR_ADMIN_EMAILS）だけ。ほかは 404。DB の行・AI・Storage にはつながず、決まった文字を灰色の地に描いて JPEG を返すだけ。
// ?font=gothic|rounded|mincho|hand|pen で書体を選べる
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const W = 1080;
const H = 1350;

export async function GET(req: Request) {
  const email = await currentOperatorEmail();
  if (!email) return new NextResponse("Not Found", { status: 404 });
  const q = new URL(req.url).searchParams.get("font");
  const font: FontKey = (FONT_KEYS as readonly string[]).includes(q ?? "") ? (q as FontKey) : "gothic";
  const started = performance.now();
  const settings = { ...initialHeadline({ width: W, height: H }, "yabumi", { palette: "ai", brand: "#e4572e", font, textStyle: "band" }), headline: "今朝の焙煎は、エチオピアの浅煎り" };
  const { bytes } = await renderTemplateJpeg(headlineInput(settings, SERVER_FONTS[font], { width: W, height: H }), null);
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Render-Ms": String(Math.round(performance.now() - started)) },
  });
}
