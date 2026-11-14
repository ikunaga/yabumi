import { projectSettingsHref } from "@/lib/projects/paths";
import { NextResponse, type NextRequest } from "next/server";
import { revokeDeps } from "@/lib/sns/adapters";
import { linkAccountToProject, replacedCookie, type ReplacedAccount } from "@/lib/sns/link";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { verifyOAuthState } from "@/lib/sns/oauth-state";
import { connectedProfile, exchangeCode } from "@/lib/sns/tiktok/api";
import { TIKTOK_PATHS, tiktokConfig } from "@/lib/sns/tiktok/config";
import { TIKTOK_STATE_COOKIE } from "@/lib/sns/tiktok/cookie";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// TikTok の認可画面からの戻り先（docs/design/tiktok.md の 1.）。state を確かめてから、コードをトークンに換える
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const saved = verifyOAuthState(request.cookies.get(TIKTOK_STATE_COOKIE)?.value, params.get("state"), userId);

  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: TIKTOK_STATE_COOKIE, path: TIKTOK_PATHS.callback });
    return response;
  };

  if (!saved) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("sns_error", "state");
    return finish(url);
  }

  const back = new URL(projectSettingsHref(saved.projectId), request.url);
  const code = params.get("code");
  if (!code) {
    back.searchParams.set("sns_error", params.get("error") === "access_denied" ? "denied" : "failed");
    return finish(back);
  }

  let replaced: ReplacedAccount[] = [];
  try {
    const tokens = await exchangeCode(tiktokConfig(), code);
    const profile = await connectedProfile(tokens);
    const admin = createAdminClient();
    const accountId = await saveConnectedAccount(admin, {
      ownerId: userId,
      sns: "tiktok",
      externalId: tokens.openId || profile.openId,
      displayName: profile.nickname,
      handle: profile.username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      // 許可されたスコープ（利用者が video.publish を外したら、下書きだけにする。docs/design/tiktok.md の 8.）
      scopes: tokens.scopes,
    });
    replaced = await linkAccountToProject(admin, { ownerId: userId, projectId: saved.projectId, accountId }, revokeDeps());
  } catch (e) {
    console.error("[tiktok] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("sns_error", "failed");
    return finish(back);
  }

  back.searchParams.set("connected", "tiktok");
  const response = finish(back);
  if (replaced.length) response.cookies.set(replacedCookie(saved.projectId, replaced));
  return response;
}
