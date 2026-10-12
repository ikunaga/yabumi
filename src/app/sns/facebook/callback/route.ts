import { NextResponse, type NextRequest } from "next/server";
import { revokeDeps } from "@/lib/sns/adapters";
import { linkAccountToProject, replacedCookie, type ReplacedAccount } from "@/lib/sns/link";
import { exchangeCode, exchangeForLongLived, fetchUserId, listPages } from "@/lib/sns/facebook/api";
import { FACEBOOK_PATHS, FACEBOOK_STATE_COOKIE, facebookConfig } from "@/lib/sns/facebook/config";
import { choosePages, savePageChoice } from "@/lib/sns/facebook/pages";
import { verifyOAuthState } from "@/lib/sns/oauth-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Facebook の認可画面からの戻り先。管理しているページを読み、つなぐページを選んでもらう（docs/architecture.md の 4.21）。
// 投稿を作れるページが 1 つならそのままつなぎ、2 つ以上なら選ぶ画面へ、0 なら作り方を出す
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const saved = verifyOAuthState(request.cookies.get(FACEBOOK_STATE_COOKIE)?.value, params.get("state"), userId);
  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: FACEBOOK_STATE_COOKIE, path: FACEBOOK_PATHS.callback });
    return response;
  };

  if (!saved) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("sns_error", "state");
    return finish(url);
  }

  const back = new URL(`/projects/${saved.projectId}`, request.url);
  back.searchParams.set("sns", "facebook");
  const code = params.get("code");
  if (!code) {
    back.searchParams.set("sns_error", params.get("error") === "access_denied" ? "denied" : "failed");
    return finish(back);
  }

  let replaced: ReplacedAccount[] = [];
  try {
    const config = facebookConfig();
    const userToken = await exchangeForLongLived(config, await exchangeCode(config, code));
    const [parentExternalId, pages] = await Promise.all([fetchUserId(config, userToken), listPages(config, userToken)]);
    const postable = pages.filter((p) => p.canPost);
    if (postable.length === 0) {
      back.searchParams.set("sns_error", pages.length ? "no_postable_page" : "no_pages");
      return finish(back);
    }

    const admin = createAdminClient();
    // ユーザーのトークンは保存しない。ページのトークンだけを、選ぶまでの 15 分だけ置く
    const choiceId = await savePageChoice(admin, { ownerId: userId, projectId: saved.projectId, parentExternalId, pages: postable });
    if (postable.length > 1) {
      return finish(new URL(`/projects/${saved.projectId}/connect/facebook/select?choice=${choiceId}`, request.url));
    }

    const result = await choosePages(admin, { choiceId, ownerId: userId, pageIds: [postable[0].id] });
    if (!result?.accountIds[0]) throw new Error("ページを選べませんでした");
    // プロジェクトに付ける。別のページがつながっていたら付け替える（1 つのプロジェクトに SNS ごとに 1 つ）
    replaced = await linkAccountToProject(admin, { ownerId: userId, projectId: saved.projectId, accountId: result.accountIds[0] }, revokeDeps());
  } catch (e) {
    console.error("[facebook] 接続に失敗しました", e instanceof Error ? e.message : e);
    back.searchParams.set("sns_error", "failed");
    return finish(back);
  }

  back.searchParams.delete("sns");
  back.searchParams.set("connected", "facebook");
  const response = finish(back);
  // 同じ SNS の別のアカウントから付け替えたときは、戻った先で「@古い を外し、@新しい をつなぎました」と出す
  if (replaced.length) response.cookies.set(replacedCookie(saved.projectId, replaced));
  return response;
}
