import { NextResponse, type NextRequest } from "next/server";
import { getProject } from "@/lib/projects/queries";
import { newOAuthState, OAUTH_STATE_MAX_AGE, serializeOAuthState } from "@/lib/sns/oauth-state";
import { authorizeUrl, newCodeVerifier } from "@/lib/sns/x/api";
import { X_PATHS, xConfig, xConfigured, xOrigin } from "@/lib/sns/x/config";
import { X_STATE_COOKIE } from "@/lib/sns/x/cookie";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// 「つなぐ」: state と PKCE の verifier を cookie に入れて X の認可画面へ送る
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  if (!isUuid(projectId)) return NextResponse.redirect(new URL("/projects", request.url));
  const back = new URL(`/projects/${projectId}`, request.url);
  back.searchParams.set("sns", "x");

  if (!xConfigured()) {
    back.searchParams.set("sns_error", "not_configured");
    return NextResponse.redirect(back);
  }

  // cookie はホストごとに分かれるので、コールバック URL と同じホスト（ふだんは APP_URL）で始める
  const origin = new URL(xOrigin()).origin;
  if (request.nextUrl.origin !== origin) {
    return NextResponse.redirect(new URL(`${X_PATHS.connect}${request.nextUrl.search}`, origin));
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));
  if (!(await getProject(projectId))) return NextResponse.redirect(new URL("/projects", request.url));

  const verifier = newCodeVerifier();
  const state = newOAuthState(userId, projectId, Date.now(), verifier);
  const response = NextResponse.redirect(authorizeUrl(xConfig(), state.state, verifier));
  response.cookies.set(X_STATE_COOKIE, serializeOAuthState(state), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: X_PATHS.callback,
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return response;
}
