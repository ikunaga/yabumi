import { projectSettingsHref } from "@/lib/projects/paths";
import { NextResponse, type NextRequest } from "next/server";
import { revokeDeps } from "@/lib/sns/adapters";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { linkAccountToProject, replacedCookie, type ReplacedAccount } from "@/lib/sns/link";
import { verifyOAuthState } from "@/lib/sns/oauth-state";
import { exchangeCode, fetchMyChannel, revokeToken, YOUTUBE_SCOPES } from "@/lib/sns/youtube/api";
import { YOUTUBE_PATHS, YOUTUBE_STATE_COOKIE, youtubeConfig } from "@/lib/sns/youtube/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Google の同意の画面からの戻り先（docs/design/youtube.md の 2.1）。state を確かめてから、コードをトークンに換える。
// 利用者は一部のスコープだけを許可できるので、2 つとも許可されていなければつながない。チャンネルがないアカウントもつながない
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const saved = verifyOAuthState(request.cookies.get(YOUTUBE_STATE_COOKIE)?.value, params.get("state"), userId);

  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: YOUTUBE_STATE_COOKIE, path: YOUTUBE_PATHS.callback });
    return response;
  };

  if (!saved || !saved.codeVerifier) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("sns_error", "state");
    return finish(url);
  }

  const back = new URL(projectSettingsHref(saved.projectId), request.url);
  back.searchParams.set("sns", "youtube");
  const code = params.get("code");
  if (!code) {
    back.searchParams.set("sns_error", params.get("error") === "access_denied" ? "denied" : "failed");
    return finish(back);
  }

  let replaced: ReplacedAccount[] = [];
  try {
    const tokens = await exchangeCode(youtubeConfig(), code, saved.codeVerifier);
    // つながないときは、もらったトークンを Google の側でも取り消す（yabumi に残さない）
    const giveBack = () => revokeToken(tokens.refreshToken ?? tokens.accessToken).catch(() => undefined);
    if (!YOUTUBE_SCOPES.every((s) => tokens.scopes.includes(s)) || !tokens.refreshToken) {
      await giveBack();
      back.searchParams.set("sns_error", "scope");
      return finish(back);
    }
    const channel = await fetchMyChannel(tokens.accessToken);
    if (!channel) {
      await giveBack();
      back.searchParams.set("sns_error", "no_channel");
      return finish(back);
    }
    const admin = createAdminClient();
    const accountId = await saveConnectedAccount(admin, {
      ownerId: userId,
      sns: "youtube",
      externalId: channel.id,
      displayName: channel.title,
      handle: channel.handle,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });
    replaced = await linkAccountToProject(admin, { ownerId: userId, projectId: saved.projectId, accountId }, revokeDeps());
  } catch (e) {
    console.error("[youtube] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("sns_error", "failed");
    return finish(back);
  }

  back.searchParams.delete("sns");
  back.searchParams.set("connected", "youtube");
  const response = finish(back);
  if (replaced.length) response.cookies.set(replacedCookie(saved.projectId, replaced));
  return response;
}
