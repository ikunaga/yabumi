import { NextResponse, type NextRequest } from "next/server";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { verifyOAuthState } from "@/lib/sns/oauth-state";
import { exchangeCode, exchangeForLongLived, fetchProfile, THREADS_SCOPES } from "@/lib/sns/threads/api";
import { THREADS_PATHS, threadsConfig } from "@/lib/sns/threads/config";
import { THREADS_STATE_COOKIE } from "@/lib/sns/threads/cookie";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Threads の認可画面からの戻り先（Redirect Callback URL）
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const saved = verifyOAuthState(request.cookies.get(THREADS_STATE_COOKIE)?.value, params.get("state"), userId);

  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: THREADS_STATE_COOKIE, path: THREADS_PATHS.callback });
    return response;
  };

  if (!saved) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("sns_error", "state");
    return finish(url);
  }

  const back = new URL(`/projects/${saved.projectId}`, request.url);
  const code = params.get("code");
  if (!code) {
    // 利用者が認可画面で「キャンセル」を押したときは error=access_denied で戻る
    back.searchParams.set("sns_error", params.get("error") === "access_denied" ? "denied" : "failed");
    return finish(back);
  }

  try {
    const config = threadsConfig();
    const short = await exchangeCode(config, code);
    const long = await exchangeForLongLived(config, short.accessToken);
    const profile = await fetchProfile(long.accessToken);

    const accountId = await saveConnectedAccount(createAdminClient(), {
      ownerId: userId,
      sns: "threads",
      externalId: profile.id || short.userId,
      displayName: profile.name,
      handle: profile.username,
      accessToken: long.accessToken,
      expiresAt: long.expiresAt,
      scopes: THREADS_SCOPES,
    });

    // プロジェクトとの紐づけは利用者の権限で行う（RLS で自分のものどうしだけ）。つなぎ直しのときは既にある
    const { error } = await supabase
      .from("project_social_accounts")
      .upsert({ project_id: saved.projectId, social_account_id: accountId }, { ignoreDuplicates: true });
    if (error) throw error;
  } catch (e) {
    console.error("[threads] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("sns_error", "failed");
    return finish(back);
  }

  back.searchParams.set("connected", "threads");
  return finish(back);
}
