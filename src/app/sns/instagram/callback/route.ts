import { NextResponse, type NextRequest } from "next/server";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { exchangeCode, exchangeForLongLived, fetchProfile, INSTAGRAM_SCOPES, PROFESSIONAL_ACCOUNT_TYPES } from "@/lib/sns/instagram/api";
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

    const accountId = await saveConnectedAccount(createAdminClient(), {
      ownerId: userId,
      sns: "instagram",
      externalId: profile.id || short.userId,
      displayName: profile.name,
      handle: profile.username,
      accessToken: long.accessToken,
      expiresAt: long.expiresAt,
      scopes: INSTAGRAM_SCOPES,
    });
    // プロジェクトとの紐づけは利用者の権限で行う（RLS で自分のものどうしだけ）
    const { error } = await supabase
      .from("project_social_accounts")
      .upsert({ project_id: saved.projectId, social_account_id: accountId }, { ignoreDuplicates: true });
    if (error) throw error;
  } catch (e) {
    console.error("[instagram] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("sns_error", "failed");
    return finish(back);
  }

  back.searchParams.delete("sns");
  back.searchParams.set("connected", "instagram");
  return finish(back);
}
