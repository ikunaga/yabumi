import { NextResponse, type NextRequest } from "next/server";
import { getProject } from "@/lib/projects/queries";
import { authorizeUrl } from "@/lib/sns/facebook/api";
import { FACEBOOK_PATHS, FACEBOOK_STATE_COOKIE, facebookConfig, facebookConfigured } from "@/lib/sns/facebook/config";
import { newOAuthState, OAUTH_STATE_MAX_AGE, serializeOAuthState } from "@/lib/sns/oauth-state";
import { appUrl } from "@/lib/sns/threads/config";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// 「つなぐ」: state を cookie に入れて Facebook の認可画面（ページの選択と権限）へ送る（Threads と同じ確かめ方。docs/architecture.md の 4.21）
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  if (!isUuid(projectId)) return NextResponse.redirect(new URL("/projects", request.url));
  const back = new URL(`/projects/${projectId}`, request.url);
  back.searchParams.set("sns", "facebook");

  if (!facebookConfigured()) {
    back.searchParams.set("sns_error", "not_configured");
    return NextResponse.redirect(back);
  }

  // cookie はホストごとに分かれるので、コールバック URL と同じホスト（APP_URL）で始める
  const origin = new URL(appUrl()).origin;
  if (request.nextUrl.origin !== origin) {
    return NextResponse.redirect(new URL(`${FACEBOOK_PATHS.connect}${request.nextUrl.search}`, origin));
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));
  if (!(await getProject(projectId))) return NextResponse.redirect(new URL("/projects", request.url));

  const state = newOAuthState(userId, projectId);
  const response = NextResponse.redirect(authorizeUrl(facebookConfig(), state.state));
  response.cookies.set(FACEBOOK_STATE_COOKIE, serializeOAuthState(state), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: FACEBOOK_PATHS.callback,
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return response;
}
