// SNS のコメント（docs/design/sns-comments.md、docs/architecture.md の 4.70）。コメントは偽物の読み方で返し、本物の SNS は呼ばない。
// 取り込みは必ずテストの利用者に絞る（共有のローカル DB のほかの人の行に触らない）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { CommentsError, type CommentsFetcher, type FetchedComment } from "@/lib/sns/comments/fetchers";
import { runSnsCommentsImport } from "@/lib/sns/comments/import";
import { anonClient, adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const NOW = new Date();
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();
const ENV = "threads,instagram,facebook";
const COLS = "id, post_target_id, sns, parent_external_id, author_name, body, is_own, commented_at, seen_at";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let threadsAccount: string;
let instagramAccount: string;
let noScopeAccount: string;

const comment = (id: string, extra: Partial<FetchedComment> = {}): FetchedComment => ({
  externalId: id,
  parentExternalId: null,
  authorName: "@someone",
  body: `本文 ${id}`,
  commentedAt: new Date(NOW.getTime() - 3600_000),
  isOwn: false,
  ...extra,
});

function fakeList(result: Awaited<ReturnType<CommentsFetcher["list"]>> | Error): CommentsFetcher {
  return { list: vi.fn(async () => (result instanceof Error ? Promise.reject(result) : result)) };
}

async function publishedTarget(sns: "threads" | "instagram", accountId: string, publishedAt: string) {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: `${sns} の投稿`,
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns, social_account_id: accountId }],
  });
  if (error) throw error;
  const { data, error: e2 } = await admin
    .from("post_targets")
    .update({ status: "published", published_at: publishedAt, external_post_id: `ext-${randomUUID()}` })
    .eq("post_id", postId!)
    .select("id, external_post_id")
    .single();
  if (e2) throw e2;
  return { postId: postId!, targetId: data!.id, externalId: data!.external_post_id! };
}

async function insertComment(targetId: string, accountId: string, ownerId: string, externalId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("sns_comments")
    .insert({ owner_id: ownerId, post_target_id: targetId, social_account_id: accountId, sns: "threads", external_id: externalId, author_name: "@x", body: "こんにちは", commented_at: hoursAgo(1), ...extra })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id;
}

const commentsOf = async (targetId: string) =>
  (await admin.from("sns_comments").select("external_id, is_own, parent_external_id, seen_at").eq("post_target_id", targetId).order("external_id")).data ?? [];
const pollOf = async (targetId: string) => (await admin.from("sns_comment_polls").select("*").eq("post_target_id", targetId).maybeSingle()).data;

const run = (fetchers: Parameters<typeof runSnsCommentsImport>[1]["fetchers"], now = NOW) =>
  runSnsCommentsImport(admin, { fetchers, key, ownerId: aliceId, commentsEnv: ENV, now: () => now });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "コメント" }).select("id").single()).data!.id;
  const account = (sns: "threads" | "instagram", scopes: string[], handle: string) =>
    saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns, externalId: `${sns}-${randomUUID()}`, displayName: "A", handle, accessToken: "t", expiresAt: new Date("2099-01-01"), scopes },
      key,
    );
  threadsAccount = await account("threads", ["threads_basic", "threads_read_replies"], "alice_th");
  instagramAccount = await account("instagram", ["instagram_business_basic", "instagram_business_manage_comments"], "alice_ig");
  noScopeAccount = await account("instagram", ["instagram_business_basic"], "alice_ig2");
  await alice.from("project_social_accounts").insert([
    { project_id: projectId, social_account_id: threadsAccount },
    { project_id: projectId, social_account_id: instagramAccount },
  ]);
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("権限（RLS・列の grant）", () => {
  it("本人は画面に要る列だけを読める。他人・ログインしていない人は読めない。出していない列は読めない", async () => {
    const { targetId } = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await insertComment(targetId, threadsAccount, aliceId, `c-${randomUUID()}`);
    const mine = await alice.from("sns_comments").select(COLS).eq("post_target_id", targetId);
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    expect((await bob.from("sns_comments").select(COLS).eq("post_target_id", targetId)).data).toEqual([]);
    expect((await anonClient().from("sns_comments").select("id").eq("post_target_id", targetId)).error).not.toBeNull();
    for (const col of ["social_account_id", "notified_at", "fetched_at", "owner_id", "external_id"]) {
      expect((await alice.from("sns_comments").select(col).eq("post_target_id", targetId)).error, col).not.toBeNull();
    }
  });

  it("利用者は足す・直す・消すができない（書くのはジョブだけ）", async () => {
    const { targetId } = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    const id = await insertComment(targetId, threadsAccount, aliceId, `c-${randomUUID()}`);
    const ins = await alice.from("sns_comments").insert({
      owner_id: aliceId,
      post_target_id: targetId,
      social_account_id: threadsAccount,
      sns: "threads",
      external_id: "forged",
      commented_at: NOW.toISOString(),
    });
    expect(ins.error).not.toBeNull();
    await alice.from("sns_comments").update({ seen_at: NOW.toISOString() }).eq("id", id);
    await alice.from("sns_comments").delete().eq("id", id);
    const row = (await admin.from("sns_comments").select("seen_at").eq("id", id).single()).data;
    expect(row).toEqual({ seen_at: null });
  });

  it("読みに行く予定の表は、本人からも読めず書けない", async () => {
    const { targetId } = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await admin.from("sns_comment_polls").insert({ post_target_id: targetId, owner_id: aliceId, next_check_at: NOW.toISOString() });
    expect((await alice.from("sns_comment_polls").select("*").eq("post_target_id", targetId)).error).not.toBeNull();
    expect((await alice.from("sns_comment_polls").insert({ post_target_id: targetId, owner_id: aliceId, next_check_at: NOW.toISOString() })).error).not.toBeNull();
  });

  it("読みに行く投稿の関数は、ログインした利用者・ログインしていない人から呼べない", async () => {
    const args = { p_scopes: { threads: "threads_read_replies" } };
    expect((await alice.rpc("due_sns_comment_targets", args)).error).not.toBeNull();
    expect((await anonClient().rpc("due_sns_comment_targets", args)).error).not.toBeNull();
  });

  it("見たことにする関数は、自分のプロジェクトの自分の行だけを変える。ログインしていない人は呼べない", async () => {
    const { postId, targetId } = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    const other = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await insertComment(targetId, threadsAccount, aliceId, `c-${randomUUID()}`);
    await insertComment(other.targetId, threadsAccount, aliceId, `c-${randomUUID()}`);
    // ほかの人がアリスのプロジェクトを指しても、何も変わらない
    expect((await bob.rpc("mark_sns_comments_seen", { p_project_id: projectId })).data).toBe(0);
    expect((await anonClient().rpc("mark_sns_comments_seen", { p_project_id: projectId })).error).not.toBeNull();
    // 投稿を指すと、その投稿の分だけ
    expect((await alice.rpc("mark_sns_comments_seen", { p_project_id: projectId, p_post_id: postId })).data).toBe(1);
    expect((await commentsOf(targetId))[0].seen_at).not.toBeNull();
    expect((await commentsOf(other.targetId))[0].seen_at).toBeNull();
  });

  it("お知らせの設定の comment_push は、本人が直せる", async () => {
    expect((await alice.from("notification_prefs").insert({ user_id: aliceId, comment_push: "off" })).error).toBeNull();
    expect((await alice.from("notification_prefs").update({ comment_push: "daily" }).eq("user_id", aliceId)).error).toBeNull();
    expect((await admin.from("notification_prefs").select("comment_push").eq("user_id", aliceId).single()).data).toEqual({ comment_push: "daily" });
    expect((await alice.from("notification_prefs").update({ comment_push: "hourly" as "daily" }).eq("user_id", aliceId)).error).not.toBeNull();
  });
});

describe("取り込み", () => {
  it("権限つきで、送ってから 7 日以内の投稿だけを読み、保存する。自分のものに印を付け、次の予定を入れる。同じ回にもう一度は読まない", async () => {
    const fresh = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    const old = await publishedTarget("threads", threadsAccount, hoursAgo(8 * 24));
    const noScope = await publishedTarget("instagram", noScopeAccount, hoursAgo(5));
    const threads = fakeList({ kind: "listed", complete: true, count: null, comments: [comment("t1"), comment("t2", { isOwn: true, parentExternalId: "t1" })] });
    const instagram = fakeList({ kind: "listed", complete: true, count: 0, comments: [] });
    const outcomes = await run({ threads, instagram });
    const ids = outcomes.map((o) => o.id);
    expect(ids).toContain(fresh.targetId);
    expect(ids).not.toContain(old.targetId);
    expect(ids).not.toContain(noScope.targetId);
    expect(await commentsOf(fresh.targetId)).toEqual([
      { external_id: "t1", is_own: false, parent_external_id: null, seen_at: null },
      { external_id: "t2", is_own: true, parent_external_id: "t1", seen_at: null },
    ]);
    const poll = await pollOf(fresh.targetId);
    expect(new Date(poll!.next_check_at).getTime()).toBeGreaterThan(NOW.getTime() + 2 * 3600_000);
    expect(new Date(poll!.next_check_at).getTime()).toBeLessThan(NOW.getTime() + 3 * 3600_000);
    // 同じ時刻にもう一度呼んでも、予定が来ていないので読まない
    const again = await run({ threads, instagram });
    expect(again.map((o) => o.id)).not.toContain(fresh.targetId);
  });

  it("SNS_COMMENTS にない SNS は読まない", async () => {
    const t = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    const threads = fakeList({ kind: "listed", complete: true, count: null, comments: [] });
    const outcomes = await runSnsCommentsImport(admin, { fetchers: { threads }, key, ownerId: aliceId, commentsEnv: "instagram", now: () => NOW });
    expect(outcomes.map((o) => o.id)).not.toContain(t.targetId);
  });

  it("見た時刻は読み直しても残る。最後まで読めたときは、返ってこなかったコメント（消された・隠された）を消す", async () => {
    const t = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await run({ threads: fakeList({ kind: "listed", complete: true, count: null, comments: [comment("a"), comment("b")] }) });
    await alice.rpc("mark_sns_comments_seen", { p_project_id: projectId, p_post_id: t.postId });
    await admin.from("sns_comment_polls").update({ next_check_at: hoursAgo(1) }).eq("post_target_id", t.targetId);
    await run({ threads: fakeList({ kind: "listed", complete: true, count: null, comments: [comment("a"), comment("c")] }) });
    const rows = await commentsOf(t.targetId);
    expect(rows.map((r) => r.external_id)).toEqual(["a", "c"]);
    expect(rows[0].seen_at).not.toBeNull();
    expect(rows[1].seen_at).toBeNull();
    // 最後まで読めなかったときは消さない
    await admin.from("sns_comment_polls").update({ next_check_at: hoursAgo(1) }).eq("post_target_id", t.targetId);
    await run({ threads: fakeList({ kind: "listed", complete: false, count: null, comments: [comment("d")] }) });
    expect((await commentsOf(t.targetId)).map((r) => r.external_id)).toEqual(["a", "c", "d"]);
  });

  it("Instagram で数が前と同じなら、一覧は読まずに次の予定だけ入れる", async () => {
    const t = await publishedTarget("instagram", instagramAccount, hoursAgo(5));
    await admin.from("sns_comment_polls").insert({ post_target_id: t.targetId, owner_id: aliceId, next_check_at: hoursAgo(1), last_count: 2 });
    const instagram = fakeList({ kind: "unchanged", count: 2 });
    const outcomes = await run({ instagram });
    expect(outcomes.find((o) => o.id === t.targetId)?.result).toBe("unchanged");
    expect(vi.mocked(instagram.list).mock.calls[0][2].lastCount).toBe(2);
    expect((await pollOf(t.targetId))!.last_checked_at).not.toBeNull();
  });

  it("権限がないと言われたら止める。投稿が消えていたら、コメントを消して止める。回数の上限は 6 時間あける", async () => {
    const perm = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await run({ threads: fakeList(new CommentsError("no permission", 403, "permission")) });
    expect((await pollOf(perm.targetId))!.stopped).toBe(true);

    const gone = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await insertComment(gone.targetId, threadsAccount, aliceId, "x1");
    await admin.from("sns_comment_polls").upsert({ post_target_id: gone.targetId, owner_id: aliceId, next_check_at: hoursAgo(1) });
    await admin.from("sns_comment_polls").update({ stopped: true }).eq("owner_id", aliceId).neq("post_target_id", gone.targetId);
    await run({ threads: fakeList(new CommentsError("not found", 404, "gone")) });
    expect(await commentsOf(gone.targetId)).toEqual([]);
    expect((await pollOf(gone.targetId))!.stopped).toBe(true);

    const rate = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await run({ threads: fakeList(new CommentsError("too many", 400, "rate")) });
    const next = new Date((await pollOf(rate.targetId))!.next_check_at).getTime();
    expect(next).toBeGreaterThan(NOW.getTime() + 5.5 * 3600_000);
    expect((await pollOf(rate.targetId))!.stopped).toBe(false);
  });
});

describe("消すとき", () => {
  it("投稿を取り消す（status = deleted）と、コメントと予定がすぐ消える", async () => {
    const t = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await insertComment(t.targetId, threadsAccount, aliceId, "d1");
    await admin.from("sns_comment_polls").insert({ post_target_id: t.targetId, owner_id: aliceId, next_check_at: NOW.toISOString() });
    await admin.from("post_targets").update({ status: "deleted" }).eq("id", t.targetId);
    expect(await commentsOf(t.targetId)).toEqual([]);
    expect(await pollOf(t.targetId)).toBeNull();
  });

  it("SNS の投稿 ID が消えた（X などの消された投稿の片付け）ときも消える", async () => {
    const t = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await insertComment(t.targetId, threadsAccount, aliceId, "d2");
    await admin.from("post_targets").update({ external_post_id: null }).eq("id", t.targetId);
    expect(await commentsOf(t.targetId)).toEqual([]);
  });

  it("yabumi の投稿を消すと消える", async () => {
    const t = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await insertComment(t.targetId, threadsAccount, aliceId, "d3");
    await admin.from("posts").delete().eq("id", t.postId);
    expect(await commentsOf(t.targetId)).toEqual([]);
  });

  it("SNS を外す（アカウントの行が消える）と、そのアカウントのコメントが消える", async () => {
    const sa = await saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns: "threads", externalId: `threads-${randomUUID()}`, displayName: "B", handle: "b", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: ["threads_read_replies"] },
      key,
    );
    const t = await publishedTarget("threads", sa, hoursAgo(5));
    await insertComment(t.targetId, sa, aliceId, "d4");
    await admin.from("social_accounts").delete().eq("id", sa);
    expect(await commentsOf(t.targetId)).toEqual([]);
  });

  it("30 日たったコメントは purge_expired_data で消え、新しいものは残る", async () => {
    const t = await publishedTarget("threads", threadsAccount, hoursAgo(5));
    await insertComment(t.targetId, threadsAccount, aliceId, "old", { commented_at: hoursAgo(31 * 24) });
    await insertComment(t.targetId, threadsAccount, aliceId, "new", { commented_at: hoursAgo(29 * 24) });
    expect((await admin.rpc("purge_expired_data")).error).toBeNull();
    expect((await commentsOf(t.targetId)).map((r) => r.external_id)).toEqual(["new"]);
  });

  it("退会すると消える", async () => {
    const { client, userId } = await signUpNewUser();
    const pid = (await client.from("projects").insert({ name: "退会" }).select("id").single()).data!.id;
    const sa = await saveConnectedAccount(
      admin,
      { ownerId: userId, sns: "threads", externalId: `threads-${randomUUID()}`, displayName: "C", handle: "c", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: ["threads_read_replies"] },
      key,
    );
    const { data: postId } = await client.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: pid,
      p_body: "退会の投稿",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [{ sns: "threads", social_account_id: sa }],
    });
    const target = (await admin.from("post_targets").update({ status: "published", published_at: hoursAgo(5), external_post_id: "ext-w" }).eq("post_id", postId!).select("id").single()).data!;
    await insertComment(target.id, sa, userId, "w1");
    await deleteUser(userId);
    expect((await admin.from("sns_comments").select("id", { count: "exact", head: true }).eq("owner_id", userId)).count).toBe(0);
  });
});
