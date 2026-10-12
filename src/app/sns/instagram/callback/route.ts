import { NextResponse, type NextRequest } from "next/server";
import { revokeDeps } from "@/lib/sns/adapters";
import { linkAccountToProject, replacedCookie, type ReplacedAccount } from "@/lib/sns/link";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { exchangeCode, exchangeForLongLived, fetchProfile, INSTAGRAM_SCOPES, PROFESSIONAL_ACCOUNT_TYPES } from "@/lib/sns/instagram/api";
import { withInsightsScope } from "@/lib/sns/insights/scopes";
import { INSTAGRAM_PATHS, INSTAGRAM_STATE_COOKIE, instagramConfig } from "@/lib/sns/instagram/config";
import { verifyOAuthState } from "@/lib/sns/oauth-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Instagram の認可画面からの戻り先（OAuth redirect URI）
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const saved = verifyOAuthState(request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value, params.get("state"), userId);
  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: INSTAGRAM_STATE_COOKIE, path: INSTAGRAM_PATHS.callback });
    return response;
  };

  if (!saved) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("sns_error", "state");
    return finish(url);
  }

  const back = new URL(`/projects/${saved.projectId}`, request.url);
  back.searchParams.set("sns", "instagram");
  const code = params.get("code");
  if (!code) {
    back.searchParams.set("sns_error", params.get("error") === "access_denied" ? "denied" : "failed");
    return finish(back);
  }

  let replaced: ReplacedAccount[] = [];
  try {
    const config = instagramConfig();
    const short = await exchangeCode(config, code);
    const long = await exchangeForLongLived(config, short.accessToken);
    const profile = await fetchProfile(long.accessToken);
    // 個人アカウントは API で投稿できない。つながずに、プロアカウントへの切り替え方を出す
    if (!PROFESSIONAL_ACCOUNT_TYPES.has(profile.accountType)) {
      back.searchParams.set("sns_error", "not_professional");
      return finish(back);
    }

    const admin = createAdminClient();
    const accountId = await saveConnectedAccount(admin, {
      ownerId: userId,
      sns: "instagram",
      externalId: profile.id || short.userId,
      displayName: profile.name,
      handle: profile.username,
      accessToken: long.accessToken,
      expiresAt: long.expiresAt,
      scopes: withInsightsScope("instagram", INSTAGRAM_SCOPES),
    });
    // プロジェクトに付ける。別の Instagram アカウントがつながっていたら付け替える（1 つのプロジェクトに SNS ごとに 1 つ）
    replaced = await linkAccountToProject(admin, { ownerId: userId, projectId: saved.projectId, accountId }, revokeDeps());
  } catch (e) {
    console.error("[instagram] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("sns_error", "failed");
    return finish(back);
  }

  back.searchParams.delete("sns");
  back.searchParams.set("connected", "instagram");
  const response = finish(back);
  // 同じ SNS の別のアカウントから付け替えたときは、戻った先で「@古い を外し、@新しい をつなぎました」と出す
  if (replaced.length) response.cookies.set(replacedCookie(saved.projectId, replaced));
  return response;
}
