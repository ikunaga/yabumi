import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, GITHUB_PATHS, GITHUB_STATE_COOKIE, githubConfig, githubConfigured, installUrl } from "@/lib/github/config";
import { getProject } from "@/lib/projects/queries";
import { newOAuthState, OAUTH_STATE_MAX_AGE, serializeOAuthState } from "@/lib/sns/oauth-state";
import { appUrl } from "@/lib/sns/threads/config";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// 「GitHub をつなぐ」: state を cookie に入れて、GitHub App のインストール画面へ送る。
// mode=sync のときはインストールせず、利用者の認可だけ（インストール済みのものを読み込み直す）
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  if (!isUuid(projectId)) return NextResponse.redirect(new URL("/projects", request.url));
  const back = new URL(`/projects/${projectId}/github`, request.url);
  if (!githubConfigured()) {
    back.searchParams.set("error", "not_configured");
    return NextResponse.redirect(back);
  }

  // state の cookie はホストごとなので、コールバック URL と同じホスト（APP_URL）で始める
  const origin = new URL(appUrl()).origin;
  if (request.nextUrl.origin !== origin) {
    return NextResponse.redirect(new URL(`${GITHUB_PATHS.install}${request.nextUrl.search}`, origin));
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));
  if (!(await getProject(projectId))) return NextResponse.redirect(new URL("/projects", request.url));

  const cfg = githubConfig();
  const state = newOAuthState(userId, projectId);
  const target = request.nextUrl.searchParams.get("mode") === "sync" ? authorizeUrl(cfg, state.state) : installUrl(cfg, state.state);
  const response = NextResponse.redirect(target);
  response.cookies.set(GITHUB_STATE_COOKIE, serializeOAuthState(state), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: GITHUB_PATHS.callback,
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return response;
}
