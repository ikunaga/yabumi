import { NextResponse, type NextRequest } from "next/server";
import { exchangeUserCode, listUserInstallations } from "@/lib/github/api";
import { authorizeUrl, GITHUB_PATHS, GITHUB_STATE_COOKIE, githubConfig } from "@/lib/github/config";
import { syncInstallations } from "@/lib/github/installations";
import { verifyOAuthState } from "@/lib/sns/oauth-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// GitHub からの戻り先（Callback URL）。インストールのあと、または利用者の認可のあとに来る。
// URL の installation_id は偽造できるので信用しない。利用者の認可コードでトークンを取り、
// その利用者が使えるインストール（/user/installations）だけを記録する。利用者のトークンは保存しない
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const cookie = request.cookies.get(GITHUB_STATE_COOKIE)?.value;
  const saved = verifyOAuthState(cookie, params.get("state"), userId);
  if (!saved) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("github_error", "state");
    return NextResponse.redirect(url);
  }
  const back = new URL(`/projects/${saved.projectId}/github`, request.url);
  const finish = (url: URL) => {
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: GITHUB_STATE_COOKIE, path: GITHUB_PATHS.callback });
    return res;
  };

  const cfg = githubConfig();
  if (params.get("setup_action") === "request") {
    // オーガニゼーションへのインストールで、管理者の承認待ち
    back.searchParams.set("error", "pending_approval");
    return finish(back);
  }
  const code = params.get("code");
  if (!code) {
    if (params.get("error") === "access_denied") {
      back.searchParams.set("error", "denied");
      return finish(back);
    }
    // インストール時の認可をしない設定のときは、ここで認可へ回す（同じ state と cookie のまま）
    return NextResponse.redirect(authorizeUrl(cfg, saved.state));
  }

  try {
    const userToken = await exchangeUserCode(cfg.clientId, cfg.clientSecret, code);
    const installations = await listUserInstallations(userToken);
    const count = await syncInstallations(createAdminClient(), userId, cfg.appId, installations);
    back.searchParams.set(count > 0 ? "connected" : "error", count > 0 ? "1" : "no_installation");
  } catch (e) {
    console.error("[github] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("error", "failed");
  }
  return finish(back);
}
