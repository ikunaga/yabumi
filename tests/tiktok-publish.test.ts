// TikTok に送るときの決まり・送る直前の確かめ・送信の部品（docs/design/tiktok.md の 3.〜8.）。HTTP はすべてモックし、本物の TikTok には送らない
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTikTokAdapter, type TikTokTarget } from "@/lib/sns/adapters/tiktok";
import { SnsPublishError, type PublishImage } from "@/lib/sns/adapters/types";
import { parseTikTokJson, type CreatorInfo } from "@/lib/sns/tiktok/api";
import { allowedPrivacy, commercialLabel, consentDeclaration, failureOf, photoInitBody, settingsProblem, type TikTokSettings } from "@/lib/sns/tiktok/publish";
import { checkBeforeSend, consentHash } from "@/lib/sns/tiktok/send-check";

const creator: CreatorInfo = {
  username: "komugi_bakery",
  nickname: "こむぎ",
  avatarUrl: null,
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: false,
  maxVideoPostDurationSec: 600,
};
const settings = (over: Partial<TikTokSettings> = {}): TikTokSettings => ({
  privacy_level: "PUBLIC_TO_EVERYONE",
  disable_comment: true,
  brand_organic: false,
  brand_content: false,
  post_mode: "DIRECT_POST",
  is_aigc: false,
  consent_text_hash: consentHash("新作", "本文"),
  consent_nickname: "こむぎ",
  consent_username: "komugi_bakery",
  ...over,
});

describe("公開範囲と設定の決まり", () => {
  it("審査の前は「自分だけ」しか選べない。知らない値は外す", () => {
    expect(allowedPrivacy({ privacyLevelOptions: [...creator.privacyLevelOptions, "UNKNOWN"] }, true)).toEqual(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"]);
    expect(allowedPrivacy(creator, false)).toEqual(["SELF_ONLY"]);
    expect(allowedPrivacy({ privacyLevelOptions: ["PUBLIC_TO_EVERYONE"] }, false)).toEqual([]);
  });

  it("公開範囲は選ばないと送れない。宣伝の内容はどちらかを選ぶ。ブランドコンテンツは自分だけにできない", () => {
    const allowed = allowedPrivacy(creator, true);
    const base = { privacyLevel: "PUBLIC_TO_EVERYONE", commercial: false, brandOrganic: false, brandContent: false };
    expect(settingsProblem(base, allowed)).toBeNull();
    expect(settingsProblem({ ...base, privacyLevel: null }, allowed)).toMatch(/公開範囲を選んで/);
    expect(settingsProblem({ ...base, privacyLevel: "FOLLOWER_OF_CREATOR" }, allowed)).toMatch(/選べません/);
    expect(settingsProblem({ ...base, commercial: true }, allowed)).toMatch(/どちらか|「自分のブランド」か/);
    expect(settingsProblem({ ...base, commercial: true, brandOrganic: true }, allowed)).toBeNull();
    expect(settingsProblem({ ...base, privacyLevel: "SELF_ONLY", commercial: true, brandContent: true }, allowed)).toMatch(/自分だけ/);
  });

  it("ラベルと同意の文は TikTok の決まりの文のまま", () => {
    expect(commercialLabel({ brandOrganic: true, brandContent: false })).toBe("Your photo will be labeled as 'Promotional content'");
    expect(commercialLabel({ brandOrganic: true, brandContent: true })).toBe("Your photo will be labeled as 'Paid partnership'");
    expect(commercialLabel({ brandOrganic: false, brandContent: false })).toBeNull();
    expect(consentDeclaration(false).text).toBe("By posting, you agree to TikTok's Music Usage Confirmation.");
    expect(consentDeclaration(true).links.map((l) => l.label)).toEqual(["Branded Content Policy", "Music Usage Confirmation"]);
  });
});

describe("写真の投稿の本文", () => {
  it("直接投稿は公開範囲・コメント・宣伝の印を入れ、音楽は自動で足さない", () => {
    const b = photoInitBody({ settings: settings({ brand_organic: true }), title: "新作", description: "本文", urls: ["https://yabumi.app/tiktok-media/a.jpg"] });
    expect(b).toEqual({
      post_info: { title: "新作", description: "本文", privacy_level: "PUBLIC_TO_EVERYONE", disable_comment: true, auto_add_music: false, brand_content_toggle: false, brand_organic_toggle: true },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: ["https://yabumi.app/tiktok-media/a.jpg"] },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    });
  });

  it("下書きは公開範囲を送らない。AI の印は AI で作った画像のときだけ", () => {
    const b = photoInitBody({ settings: settings({ post_mode: "MEDIA_UPLOAD", is_aigc: true }), title: "", description: "本文", urls: ["u"] });
    expect(b.post_info).toEqual({ title: "", description: "本文" });
    expect(b.post_mode).toBe("MEDIA_UPLOAD");
    expect(b.is_aigc).toBe(true);
  });

  it("失敗の理由を、やり直す・つなぎ直す・止めるに分ける", () => {
    expect(failureOf("photo_pull_failed").kind).toBe("retryable");
    expect(failureOf("access_token_invalid").kind).toBe("auth");
    expect(failureOf("spam_risk_too_many_posts")).toMatchObject({ kind: "permanent", message: expect.stringMatching(/15 本/) });
    expect(failureOf("spam_risk_too_many_pending_share").message).toMatch(/5 本/);
    expect(failureOf("something_new")).toMatchObject({ kind: "permanent", message: expect.stringContaining("something_new") });
  });
});

describe("送る直前の確かめ（予約の守り）", () => {
  const args = { settings: settings(), creator, title: "新作", description: "本文", audited: true };
  it("同意したときと同じなら送る", () => {
    expect(checkBeforeSend(args)).toBeNull();
  });
  it("同意がない・公開範囲が選べなくなった・アカウントが変わった・文が変わったときは送らない", () => {
    expect(checkBeforeSend({ ...args, settings: null })).toMatch(/同意/);
    expect(checkBeforeSend({ ...args, creator: { ...creator, privacyLevelOptions: ["SELF_ONLY"] } })).toMatch(/公開範囲/);
    expect(checkBeforeSend({ ...args, audited: false })).toMatch(/公開範囲/);
    expect(checkBeforeSend({ ...args, creator: { ...creator, nickname: "べつの人" } })).toMatch(/アカウント/);
    expect(checkBeforeSend({ ...args, creator: { ...creator, username: "someone_else" } })).toMatch(/アカウント/);
    expect(checkBeforeSend({ ...args, description: "本文を直した" })).toMatch(/変わっていた/);
    expect(checkBeforeSend({ ...args, title: "新作!" })).toMatch(/変わっていた/);
  });
  it("下書きは公開範囲を照らさない（TikTok のアプリで決める）", () => {
    expect(checkBeforeSend({ ...args, settings: settings({ post_mode: "MEDIA_UPLOAD", privacy_level: "SELF_ONLY" }), audited: false })).toBeNull();
  });
  it("指紋はタイトルと説明の区切りも含める（入れ替えても同じにならない）", () => {
    expect(consentHash("ab", "c")).not.toBe(consentHash("a", "bc"));
    expect(consentHash("新作", "本文")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ===== 送信の部品 =====
type Reply = { body: unknown; status?: number } | Error;
function scriptedFetch(replies: Reply[]) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void input;
    void init;
    const r = replies.shift();
    if (!r) throw new Error("想定より多く呼ばれました");
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

const ok = (data: unknown) => ({ body: { data, error: { code: "ok", message: "" } } });
const fail = (code: string, status = 400) => ({ body: { data: {}, error: { code, message: code } }, status });
const creatorReply = ok({ creator_username: "komugi_bakery", creator_nickname: "こむぎ", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], comment_disabled: false });
const account = { externalId: "open-1", accessToken: "token" };
const image = (id: string, aiGenerated = false): PublishImage => ({ url: `https://example.test/${id}`, altText: "", load: async () => new Uint8Array(), mediaId: id, aiGenerated });

function makeAdapter(target: TikTokTarget | null = { ownerId: "u1", title: "新作", settings: settings() }, audited = true) {
  const issueTickets = vi.fn(async ({ mediaIds }: { mediaIds: string[] }) => mediaIds.map((m) => `https://yabumi.app/tiktok-media/${m}.jpg`));
  const clearTickets = vi.fn(async () => {});
  const adapter = createTikTokAdapter({ config: () => ({ clientKey: "k", clientSecret: "s", redirectUri: "r" }), audited: () => audited, loadTarget: async () => target, issueTickets, clearTickets });
  return { adapter, issueTickets, clearTickets };
}
async function startError(adapter: ReturnType<typeof makeAdapter>["adapter"], images = [image("m1")]) {
  const e = await adapter.startPublish!(account, "本文", images, { id: "t1", rawText: "本文" }).catch((e) => e);
  expect(e).toBeInstanceOf(SnsPublishError);
  return e as SnsPublishError;
}

describe("TikTok への送信（写真）", () => {
  it("creator_info を読み直し、入口の URL で送り始め、状態を確かめて投稿の URL を返す", async () => {
    const fetch = scriptedFetch([creatorReply, ok({ publish_id: "p1" }), ok({ status: "PROCESSING_DOWNLOAD" }), ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7300] })]);
    const { adapter, issueTickets, clearTickets } = makeAdapter();
    const state = await adapter.startPublish!(account, "本文", [image("m1"), image("m2", true)], { id: "t1", rawText: "本文" });
    expect(issueTickets).toHaveBeenCalledWith({ ownerId: "u1", postTargetId: "t1", mediaIds: ["m1", "m2"] });
    const [initUrl, init] = fetch.mock.calls[1];
    expect(String(initUrl)).toBe("https://open.tiktokapis.com/v2/post/publish/content/init/");
    const sent = JSON.parse(String(init?.body));
    expect(sent.source_info.photo_images).toEqual(["https://yabumi.app/tiktok-media/m1.jpg", "https://yabumi.app/tiktok-media/m2.jpg"]);
    expect(sent.is_aigc).toBe(true); // AI で作った画像が 1 枚ある
    expect(sent.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");

    expect(await adapter.continuePublish!(account, state)).toEqual({ state });
    expect(clearTickets).not.toHaveBeenCalled();
    expect(await adapter.continuePublish!(account, state)).toEqual({ done: { externalPostId: "7300", url: "https://www.tiktok.com/@komugi_bakery/photo/7300" } });
    expect(clearTickets).toHaveBeenCalledWith("t1");
  });

  it("下書きは受信箱に届いたところで終わる（URL はない）", async () => {
    scriptedFetch([creatorReply, ok({ publish_id: "p2" }), ok({ status: "SEND_TO_USER_INBOX" })]);
    const { adapter } = makeAdapter({ ownerId: "u1", title: "新作", settings: settings({ post_mode: "MEDIA_UPLOAD", privacy_level: "SELF_ONLY" }) });
    const state = await adapter.startPublish!(account, "本文", [image("m1")], { id: "t1", rawText: "本文" });
    expect(await adapter.continuePublish!(account, state)).toEqual({ done: { externalPostId: "p2", url: null } });
  });

  it("19 桁の投稿の ID（JSON の数）を丸めずに、そのまま ID と URL にする", async () => {
    const raw = '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7412345678901234567]},"error":{"code":"ok","message":""}}';
    expect(Number("7412345678901234567").toString()).not.toBe("7412345678901234567"); // ふつうに読むと丸まる
    scriptedFetch([creatorReply, ok({ publish_id: "p9" })]);
    const { adapter } = makeAdapter();
    const state = await adapter.startPublish!(account, "本文", [image("m1")], { id: "t1", rawText: "本文" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(raw, { status: 200 })));
    expect(await adapter.continuePublish!(account, state)).toEqual({ done: { externalPostId: "7412345678901234567", url: "https://www.tiktok.com/@komugi_bakery/photo/7412345678901234567" } });
  });

  it("安全な大きさの数・文字列の ID・publish_id が数で来たときも、文字の ID にする", () => {
    expect(parseTikTokJson('{"a":[123,"7412345678901234567",-9223372036854775808],"b":1.5}')).toEqual({ a: [123, "7412345678901234567", "-9223372036854775808"], b: 1.5 });
  });

  it("公開されたが ID がまだ来ないときは、publish_id を残して URL なし", async () => {
    scriptedFetch([creatorReply, ok({ publish_id: "p3" }), ok({ status: "PUBLISH_COMPLETE" })]);
    const { adapter } = makeAdapter();
    const state = await adapter.startPublish!(account, "本文", [image("m1")], { id: "t1", rawText: "本文" });
    expect(await adapter.continuePublish!(account, state)).toEqual({ done: { externalPostId: "p3", url: null } });
  });

  it("TikTok 側の失敗は理由で分け、入口を閉じる", async () => {
    scriptedFetch([creatorReply, ok({ publish_id: "p4" }), ok({ status: "FAILED", fail_reason: "spam_risk_too_many_posts" })]);
    const { adapter, clearTickets } = makeAdapter();
    const state = await adapter.startPublish!(account, "本文", [image("m1")], { id: "t1", rawText: "本文" });
    const e = await adapter.continuePublish!(account, state).catch((e) => e);
    expect(e).toBeInstanceOf(SnsPublishError);
    expect(e.kind).toBe("permanent");
    expect(clearTickets).toHaveBeenCalledWith("t1");
  });

  it("回数の上限（429）・TikTok の障害（5xx）・通信の失敗はやり直す。送り始めで失敗したら入口を閉じる", async () => {
    for (const reply of [fail("rate_limit_exceeded", 429), fail("internal_error", 500), new Error("ECONNRESET")]) {
      scriptedFetch([creatorReply, reply]);
      const { adapter, clearTickets } = makeAdapter();
      expect((await startError(adapter)).kind).toBe("retryable");
      expect(clearTickets).toHaveBeenCalledWith("t1");
    }
  });

  it("トークンが無効ならつなぎ直し（auth）", async () => {
    scriptedFetch([fail("access_token_invalid", 401)]);
    expect((await startError(makeAdapter().adapter)).kind).toBe("auth");
  });

  it("投稿できない状態（今日の上限など）なら、creator_info の時点で送らない", async () => {
    const fetch = scriptedFetch([fail("spam_risk_too_many_posts", 403)]);
    const { adapter, issueTickets } = makeAdapter();
    const e = await startError(adapter);
    expect(e.kind).toBe("permanent");
    expect(e.message).toMatch(/15 本/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(issueTickets).not.toHaveBeenCalled();
  });

  it("同意のあとに文が変わった・同意がない・公開範囲が選べなくなったときは送らない（入口も作らない）", async () => {
    for (const [target, audited] of [
      [{ ownerId: "u1", title: "新作に直した", settings: settings() }, true],
      [{ ownerId: "u1", title: "新作", settings: null }, true],
      [{ ownerId: "u1", title: "新作", settings: settings() }, false],
    ] as const) {
      scriptedFetch([creatorReply]);
      const { adapter, issueTickets } = makeAdapter(target, audited);
      expect((await startError(adapter)).kind).toBe("permanent");
      expect(issueTickets).not.toHaveBeenCalled();
    }
  });

  it("写真がない・多すぎる・配信先がないときは、TikTok に問い合わせずに止める", async () => {
    const fetch = scriptedFetch([]);
    expect((await startError(makeAdapter().adapter, [])).message).toMatch(/写真が要ります/);
    expect((await startError(makeAdapter().adapter, Array.from({ length: 36 }, (_, i) => image(`m${i}`)))).message).toMatch(/35 枚/);
    expect((await startError(makeAdapter(null).adapter)).message).toMatch(/見つかりません/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("リフレッシュトークンで取り直し、返ってきた期限を使う。7 日たったら入れ替える", async () => {
    scriptedFetch([{ body: { access_token: "a2", refresh_token: "r2", expires_in: 7200, refresh_expires_in: 100, open_id: "open-1", scope: "video.publish" } }]);
    const now = new Date("2026-11-14T00:00:00Z");
    const t = await makeAdapter().adapter.refreshWithRefreshToken!("r1", now);
    expect(t).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: new Date("2026-11-14T02:00:00Z") });
    const { adapter } = makeAdapter();
    expect(adapter.shouldRotate!(new Date("2026-11-08T00:00:00Z"), now)).toBe(false);
    expect(adapter.shouldRotate!(new Date("2026-11-07T00:00:00Z"), now)).toBe(true);
    scriptedFetch([{ body: { error: "invalid_grant", error_description: "expired" }, status: 400 }]);
    expect(await adapter.refreshWithRefreshToken!("r1", now).catch((e) => e.kind)).toBe("auth");
  });
});
