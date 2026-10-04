import { NextResponse, type NextRequest } from "next/server";
import { getProject } from "@/lib/projects/queries";
import { newOAuthState, OAUTH_STATE_MAX_AGE, serializeOAuthState } from "@/lib/sns/oauth-state";
import { authorizeUrl } from "@/lib/sns/threads/api";
import { appUrl, THREADS_PATHS, threadsConfig, threadsConfigured } from "@/lib/sns/threads/config";
import { THREADS_STATE_COOKIE } from "@/lib/sns/threads/cookie";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// 「つなぐ」: state を cookie に入れて Threads の認可画面へ送る
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  if (!isUuid(projectId)) return NextResponse.redirect(new URL("/projects", request.url));
  const back = new URL(`/projects/${projectId}`, request.url);

  if (!threadsConfigured()) {
    back.searchParams.set("sns_error", "not_configured");
    return NextResponse.redirect(back);
  }

  // state の cookie はホストごとに分かれるので、コールバック URL と同じホスト（APP_URL）で始める。
  // 127.0.0.1 で開いていた場合は localhost に移る（ログインし直しになる）
  const origin = new URL(appUrl()).origin;
  if (request.nextUrl.origin !== origin) {
    return NextResponse.redirect(new URL(`${THREADS_PATHS.connect}${request.nextUrl.search}`, origin));
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));
  // 自分のプロジェクトであること（RLS で他人のものは読めない）
  if (!(await getProject(projectId))) return NextResponse.redirect(new URL("/projects", request.url));

  const state = newOAuthState(userId, projectId);
  const response = NextResponse.redirect(authorizeUrl(threadsConfig(), state.state));
  response.cookies.set(THREADS_STATE_COOKIE, serializeOAuthState(state), {
    httpOnly: true,
    secure: true,
    // Threads から戻るのはトップレベルの GET なので lax で送られる
    sameSite: "lax",
    path: THREADS_PATHS.callback,
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return response;
}
