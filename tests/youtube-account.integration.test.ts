// YouTube のつながりが切れたとき・保存のときの同意・1 日の数（docs/design/youtube.md の 2.・5.・6.）。
// Google は偽物（fetch の差し替え）で、本物には送らない。取り出しは必ず postId を指定し、日時は未来にして pg_cron に拾われないようにする。
// テストの行はこのファイルの利用者だけに作る（共有のローカル DB）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { createYouTubeAdapter } from "@/lib/sns/adapters/youtube";
import { publishDueTargets, refreshDueTokens, type PublisherDeps } from "@/lib/sns/publisher";
import { consentHash } from "@/lib/sns/tiktok/send-check";
import { EMPTY_YOUTUBE_CHOICE, isShortsShape, youtubeChoiceProblem } from "@/lib/sns/youtube/choice";
import { pacificDayRange, youtubeSchedulesOnDay } from "@/lib/sns/youtube/schedule";
import { checkTarget, ISSUE_LABEL, displayLength } from "@/lib/sns";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const h = await import("./helpers/supabase");
  return { createAdminClient: () => h.adminClient() };
});
const { writeYouTubeConsent, youtubeChoiceOf } = await import("@/lib/sns/youtube/consent");

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";
let alice: TestClient;
let aliceId: string;
let projectId: string;

const adapter = createYouTubeAdapter({
  config: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://yabumi.app/sns/youtube/callback" }),
  loadTarget: async () => null,
  loadVideo: async () => null,
  reserveUpload: async () => "ok",
  userDailyUploads: 5,
  loadUpload: async () => null,
  saveUpload: async () => {},
  clearUpload: async () => {},
});
const deps = (now?: Date): PublisherDeps => ({ adapters: { youtube: adapter }, key, refreshWait: { intervalMs: 50, tries: 40 }, onlyOwner: aliceId, ...(now ? { now: () => now } : {}) });

// トークンの窓口が invalid_grant を返す偽の Google（テスト中に 7 日で許可が切れた・Google の設定で取り消された）
// Supabase への通信はそのまま通し、Google にだけ偽の答えを返す
const realFetch = globalThis.fetch;
const invalidGrant = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 });
      }
      if (url.includes("googleapis.com")) return new Response("unexpected", { status: 500 });
      return realFetch(input, init);
    }),
  );

async function connect(expiresAt: Date) {
  const accountId = await saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "youtube", externalId: `UC_${randomUUID()}`, displayName: "こむぎのパン", handle: "komugi", accessToken: "access-1", refreshToken: "refresh-1", expiresAt, scopes: [] },
    key,
  );
  await admin.from("project_social_accounts").upsert({ project_id: projectId, social_account_id: accountId, owner_id: aliceId });
  return accountId;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "YouTube" }).select("id").single()).data!.id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await deleteUser(aliceId);
});

describe("つながりが切れたとき（invalid_grant）", () => {
  it("7 日ごとの取り直しが invalid_grant なら、アカウントを期限切れにする（つなぎ直しの案内が出る）", async () => {
    const accountId = await connect(new Date(Date.now() + 3600_000));
    invalidGrant();
    const later = new Date(Date.now() + 8 * 86400_000);
    const outcomes = await refreshDueTokens(admin, deps(later));
    expect(outcomes.find((o) => o.socialAccountId === accountId)?.result).toBe("expired");
    expect((await admin.from("social_accounts").select("status").eq("id", accountId).single()).data!.status).toBe("expired");
  });

  it("送る時刻に取り直せなければ、送らずに失敗にし、理由に「つなぎ直し」を出す（要確認の「送れなかった投稿」に入る）", async () => {
    const accountId = await connect(new Date(Date.now() - 60_000));
    const { data: postId, error } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: projectId,
      p_body: "新しいパンの動画",
      p_planned_at: FUTURE,
      p_status: "scheduled",
      p_targets: [{ sns: "youtube", social_account_id: accountId }],
    });
    if (error) throw error;
    invalidGrant();
    const outcomes = await publishDueTargets(admin, deps(), { postId: postId! });
    expect(outcomes[0]).toMatchObject({ sns: "youtube", result: "failed" });
    const t = (await admin.from("post_targets").select("status, error_message").eq("post_id", postId!).single()).data!;
    expect(t.status).toBe("failed");
    expect(t.error_message).toMatch(/つながりが切れて/);
    expect(t.error_message).toMatch(/つなぎ直/);
    expect((await admin.from("social_accounts").select("status").eq("id", accountId).single()).data!.status).toBe("expired");
  });
});

describe("保存のときの同意と、1 日の数", () => {
  it("同意の記録はサーバーが時刻と指紋とチャンネル名を決めて書き、まだ上げ終えていない途中の情報は捨てる。開き直すと選んだものが戻る", async () => {
    const accountId = await connect(new Date(Date.now() + 3600_000));
    const { data: postId } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: projectId,
      p_body: "説明",
      p_planned_at: FUTURE,
      p_status: "draft",
      p_targets: [{ sns: "youtube", social_account_id: accountId, title: "新しいパン" }],
    });
    const targetId = (await admin.from("post_targets").select("id").eq("post_id", postId!).single()).data!.id;
    await admin.from("youtube_uploads").insert({ post_target_id: targetId, owner_id: aliceId, bytes_total: 10, bytes_sent: 5 });
    const choice = { privacyStatus: "unlisted" as const, madeForKids: false, syntheticMedia: true, categoryId: "27" };
    await writeYouTubeConsent(admin, { userId: aliceId, postId: postId!, title: "新しいパン", text: "説明", checked: { choice, channel: { id: "UC", title: "こむぎのパン", handle: "komugi" } } });
    const row = (await admin.from("post_target_youtube").select("*").eq("post_target_id", targetId).single()).data!;
    expect(row).toMatchObject({ privacy_status: "unlisted", made_for_kids: false, synthetic_media: true, category_id: "27", consent_channel: "こむぎのパン", consent_text_hash: consentHash("新しいパン", "説明") });
    expect(row.consented_at).toBeTruthy();
    expect((await admin.from("youtube_uploads").select("post_target_id").eq("post_target_id", targetId)).data).toEqual([]);
    expect(await youtubeChoiceOf(admin, postId!, aliceId)).toEqual(choice);
    // 他人として読んでも返らない
    expect(await youtubeChoiceOf(admin, postId!, randomUUID())).toBeNull();
  });

  it("その日（太平洋時間）の YouTube の予約を数える。送れなかった・ほかの日・いま保存している投稿は数えない", async () => {
    const accountId = await connect(new Date(Date.now() + 3600_000));
    const day = new Date("2099-03-10T20:00:00Z");
    const { start, end } = pacificDayRange(day);
    const mk = async (at: string, targetStatus = "pending") => {
      const { data: id } = await alice.rpc("save_post", {
        p_post_id: null as unknown as string,
        p_project_id: projectId,
        p_body: "動画",
        p_planned_at: at,
        p_status: "scheduled",
        p_targets: [{ sns: "youtube", social_account_id: accountId }],
      });
      if (targetStatus !== "pending") await admin.from("post_targets").update({ status: targetStatus }).eq("post_id", id!);
      return id!;
    };
    const a = await mk(new Date(start.getTime() + 60_000).toISOString());
    await mk(new Date(end.getTime() - 60_000).toISOString());
    await mk(new Date(start.getTime() + 120_000).toISOString(), "failed");
    await mk(new Date(end.getTime() + 60_000).toISOString());
    expect(await youtubeSchedulesOnDay(alice, day, null)).toBe(2);
    expect(await youtubeSchedulesOnDay(alice, day, a)).toBe(1);
  });
});

describe("決まり（画面とサーバーで同じ）", () => {
  it("太平洋時間の 1 日は 0 時から翌 0 時（夏時間の切り替わりの日は 23 時間）", () => {
    const { start, end } = pacificDayRange(new Date("2026-11-15T20:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-15T08:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-16T08:00:00.000Z");
    const spring = pacificDayRange(new Date("2026-03-08T20:00:00Z"));
    expect(spring.start.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(spring.end.toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });

  it("タイトルは必須で 100 字まで、< > は使えない。説明は全角換算で数える", () => {
    const issues = (title: string | null, text = "説明") => checkTarget("youtube", text, { images: 0, videos: 1 }, title).issues;
    expect(issues("新しいパン")).toEqual([]);
    expect(issues("")).toContain("needs_title");
    expect(issues("あ".repeat(101))).toContain("title_too_long");
    expect(issues("<b>")).toContain("angle_brackets");
    expect(issues("新しいパン", "a > b")).toContain("angle_brackets");
    expect(ISSUE_LABEL.angle_brackets).toMatch(/< と >/);
    expect(displayLength("youtube", "あいう")).toBe(3);
    expect(displayLength("youtube", "abc")).toBe(1);
    expect(issues("新しいパン", "あ".repeat(1666))).toEqual([]);
    expect(issues("新しいパン", "あ".repeat(1667))).toContain("too_long");
    // 動画がなければ送れない
    expect(checkTarget("youtube", "説明", { images: 0, videos: 0 }, "新しいパン").issues).toContain("needs_video");
  });

  it("公開範囲と子ども向けかは、選ぶまで送れない。ショートは 3 分以内の縦長か正方形", () => {
    expect(youtubeChoiceProblem(EMPTY_YOUTUBE_CHOICE)).toMatch(/公開範囲/);
    expect(youtubeChoiceProblem({ ...EMPTY_YOUTUBE_CHOICE, privacyStatus: "public" })).toMatch(/子ども向け/);
    expect(youtubeChoiceProblem({ ...EMPTY_YOUTUBE_CHOICE, privacyStatus: "public", madeForKids: false })).toBeNull();
    expect(isShortsShape({ durationMs: 60_000, width: 1080, height: 1920 })).toBe(true);
    expect(isShortsShape({ durationMs: 60_000, width: 1080, height: 1080 })).toBe(true);
    expect(isShortsShape({ durationMs: 181_000, width: 1080, height: 1920 })).toBe(false);
    expect(isShortsShape({ durationMs: 60_000, width: 1920, height: 1080 })).toBe(false);
  });
});
