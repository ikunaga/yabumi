import { NextResponse, type NextRequest } from "next/server";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { verifyOAuthState } from "@/lib/sns/oauth-state";
import { exchangeCode, fetchMe } from "@/lib/sns/x/api";
import { X_PATHS, xConfig } from "@/lib/sns/x/config";
import { X_STATE_COOKIE } from "@/lib/sns/x/cookie";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// X の認可画面からの戻り先（Callback URI）
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const saved = verifyOAuthState(request.cookies.get(X_STATE_COOKIE)?.value, params.get("state"), userId);

  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: X_STATE_COOKIE, path: X_PATHS.callback });
    return response;
  };

  if (!saved || !saved.codeVerifier) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("sns_error", "state");
    return finish(url);
  }

  const back = new URL(`/projects/${saved.projectId}`, request.url);
  const code = params.get("code");
  if (!code) {
    back.searchParams.set("sns", "x");
    back.searchParams.set("sns_error", params.get("error") === "access_denied" ? "denied" : "failed");
    return finish(back);
  }

  try {
    const tokens = await exchangeCode(xConfig(), code, saved.codeVerifier);
    if (!tokens.scopes.includes("tweet.write")) throw new Error("tweet.write の権限がありません");
    // 自分の ID とユーザー名を読む（$0.010。つなぐたびに 1 回）
    const profile = await fetchMe(tokens.accessToken);

    const admin = createAdminClient();
    const accountId = await saveConnectedAccount(admin, {
      ownerId: userId,
      sns: "x",
      externalId: profile.id,
      displayName: profile.name,
      handle: profile.username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });
    // つなぐときの費用も記録する（上限では止めない）
    const { error: usageError } = await admin.rpc("reserve_sns_spend", {
      p_owner_id: userId,
      p_sns: "x",
      p_post_target_id: null as unknown as string,
      p_operation: "user_read",
      p_cost_usd: X_PRICE_USD.user_read,
      p_budget_usd: null as unknown as number,
    });
    if (usageError) console.error("[x] 費用の記録に失敗しました", usageError.message);

    const { error } = await supabase
      .from("project_social_accounts")
      .upsert({ project_id: saved.projectId, social_account_id: accountId }, { ignoreDuplicates: true });
    if (error) throw error;
  } catch (e) {
    console.error("[x] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("sns", "x");
    back.searchParams.set("sns_error", "failed");
    return finish(back);
  }

  back.searchParams.set("connected", "x");
  return finish(back);
}
