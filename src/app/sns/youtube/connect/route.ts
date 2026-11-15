import { projectSettingsHref } from "@/lib/projects/paths";
import { NextResponse, type NextRequest } from "next/server";
import { getProject } from "@/lib/projects/queries";
import { newOAuthState, OAUTH_STATE_MAX_AGE, serializeOAuthState } from "@/lib/sns/oauth-state";
import { appUrl } from "@/lib/sns/threads/config";
import { authorizeUrl, newCodeVerifier } from "@/lib/sns/youtube/api";
import { YOUTUBE_PATHS, YOUTUBE_STATE_COOKIE, youtubeConfig, youtubeConfigured } from "@/lib/sns/youtube/config";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// 「つなぐ」: state と PKCE の verifier を cookie に入れて Google の同意の画面へ送る（docs/design/youtube.md の 2.1）
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  if (!isUuid(projectId)) return NextResponse.redirect(new URL("/projects", request.url));
  const back = new URL(projectSettingsHref(projectId), request.url);

  if (!youtubeConfigured()) {
    back.searchParams.set("sns_error", "not_configured");
    return NextResponse.redirect(back);
  }

  // state の cookie はホストごとに分かれるので、コールバック URL と同じホスト（APP_URL）で始める
  const origin = new URL(appUrl()).origin;
  if (request.nextUrl.origin !== origin) {
    return NextResponse.redirect(new URL(`${YOUTUBE_PATHS.connect}${request.nextUrl.search}`, origin));
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));
  // 自分のプロジェクトであること（RLS で他人のものは読めない）
  if (!(await getProject(projectId))) return NextResponse.redirect(new URL("/projects", request.url));

  const verifier = newCodeVerifier();
  const state = newOAuthState(userId, projectId, Date.now(), verifier);
  const response = NextResponse.redirect(authorizeUrl(youtubeConfig(), state.state, verifier));
  response.cookies.set(YOUTUBE_STATE_COOKIE, serializeOAuthState(state), {
    httpOnly: true,
    secure: true,
    // Google から戻るのはトップレベルの GET なので lax で送られる
    sameSite: "lax",
    path: YOUTUBE_PATHS.callback,
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return response;
}
