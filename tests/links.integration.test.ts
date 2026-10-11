// 短縮リンクとクリックの記録（docs/architecture.md の 4.22、決定 D20）。ローカルの Supabase を使う。
// 消す処理（purge_expired_data）は DB の全体に効くので、ここでは呼ばない
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShortLink, ensurePostLinks, postLinkPreview, preparePostLinks, recordClick, resolveLink, substituteForTarget } from "@/lib/links/store";
import { anonClient, adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const STORE = "https://apps.apple.com/jp/app/id123456789";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "リンク", app_store_url: STORE, app_store_provider_token: "118000" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

describe("リンク", () => {
  it("作ったリンクは本人だけが読める。利用者は自分で作れない・書き換えられない", async () => {
    const link = await createShortLink(admin, { ownerId: aliceId, projectId, destinationUrl: STORE, sns: "x", kind: "profile" });
    expect((await alice.from("short_links").select("id").eq("id", link.id)).data).toHaveLength(1);
    expect((await bob.from("short_links").select("id").eq("id", link.id)).data).toEqual([]);
    const ins = await alice.from("short_links").insert({ owner_id: aliceId, project_id: projectId, code: "Zz9yX8wV", destination_url: STORE, kind: "custom" });
    expect(ins.error?.code).toBe("42501");
    expect((await alice.from("short_links").update({ destination_url: "https://evil.example" }).eq("id", link.id)).error?.code).toBe("42501");
  });

  it("https 以外の行き先は作れない", async () => {
    await expect(createShortLink(admin, { ownerId: aliceId, projectId, destinationUrl: "javascript:alert(1)", sns: null, kind: "custom" })).rejects.toThrow();
    await expect(createShortLink(admin, { ownerId: aliceId, projectId, destinationUrl: "http://example.com", sns: null, kind: "custom" })).rejects.toThrow();
  });

  it("転送先に ct と pt を付ける。止めたリンクは止まっていると返す", async () => {
    const link = await createShortLink(admin, { ownerId: aliceId, projectId, destinationUrl: STORE, sns: "threads", kind: "custom" });
    const r = await resolveLink(admin, link.code);
    const u = new URL(r!.target);
    expect(u.searchParams.get("ct")).toBe(`threads-${link.code}`);
    expect(u.searchParams.get("pt")).toBe("118000");
    await admin.from("short_links").update({ disabled_at: new Date().toISOString() }).eq("id", link.id);
    expect((await resolveLink(admin, link.code))!.disabled).toBe(true);
    expect(await resolveLink(admin, "nope")).toBeNull();
    expect(await resolveLink(admin, "ZZZZZZZZ")).toBeNull();
  });
});

describe("クリックの記録", () => {
  it("数え、同じ人の 10 分以内の 2 回目は重複、クローラーは数えない。日ごと・端末ごとに集計する", async () => {
    const link = await createShortLink(admin, { ownerId: aliceId, projectId, destinationUrl: STORE, sns: "x", kind: "custom" });
    const base = { linkId: link.id, userAgent: IPHONE, device: "ios" as const, country: "jp", excluded: null };
    expect(await recordClick(admin, { ...base, ip: "203.0.113.5" })).toBe("counted");
    expect(await recordClick(admin, { ...base, ip: "203.0.113.5" })).toBe("duplicate");
    expect(await recordClick(admin, { ...base, ip: "203.0.113.6" })).toBe("counted");
    expect(await recordClick(admin, { ...base, ip: "203.0.113.7", excluded: "bot" })).toBe("bot");

    const { data: daily } = await alice.from("link_click_daily").select("day, device, clicks, excluded").eq("link_id", link.id);
    expect(daily).toEqual([{ day: today(), device: "ios", clicks: 2, excluded: 2 }]);
    const { data: totals } = await alice.rpc("link_click_totals", { p_project_id: projectId, p_today: today() });
    expect(totals!.find((t) => t.link_id === link.id)).toMatchObject({ clicks_7d: 2, clicks_30d: 2, clicks_total: 2, excluded_total: 2 });
    // 他人の集計は読めない
    expect((await bob.from("link_click_daily").select("link_id").eq("link_id", link.id)).data).toEqual([]);
    expect((await bob.rpc("link_click_totals", { p_project_id: projectId, p_today: today() })).data).toEqual([]);
  });

  it("IP アドレスは残さず、ハッシュだけ。国は 2 文字の大文字", async () => {
    const link = await createShortLink(admin, { ownerId: aliceId, projectId, destinationUrl: STORE, sns: "x", kind: "custom" });
    await recordClick(admin, { linkId: link.id, ip: "198.51.100.23", userAgent: IPHONE, device: "ios", country: "jp", excluded: null });
    const { data } = await admin.from("link_clicks").select("*").eq("link_id", link.id);
    expect(data).toHaveLength(1);
    const row = data![0];
    expect(JSON.stringify(row)).not.toContain("198.51.100.23");
    expect(row.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.country).toBe("JP");
  });

  it("1 クリックの記録・塩は、利用者も anon も読めない。記録の関数は呼べない", async () => {
    expect((await alice.from("link_clicks").select("*").limit(1)).error?.code).toBe("42501");
    expect((await alice.from("link_hash_salts").select("*").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("short_links").select("*").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("link_click_daily").select("*").limit(1)).error?.code).toBe("42501");
    const call = await alice.rpc("record_link_click", { p_link_id: aliceId, p_ip: "", p_user_agent: "", p_device: "ios", p_country: "", p_excluded: null as unknown as string });
    expect(call.error?.code).toBe("42501");
    expect((await anonClient().rpc("link_click_totals", { p_project_id: projectId, p_today: today() })).error?.code).toBe("42501");
  });
});

describe("投稿の本文の置き換え", () => {
  it("配信先ごとに URL ごとのリンクを用意し（2 回目は使い回し）、送る直前に置き換える。Instagram は置き換えない", async () => {
    const { data: postId } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: projectId,
      p_body: `新しくしました ${STORE}`,
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [{ sns: "threads" }, { sns: "instagram" }],
    });
    const { data: targets } = await admin.from("post_targets").select("id, sns").eq("post_id", postId!);
    const threads = targets!.find((t) => t.sns === "threads")!;
    const insta = targets!.find((t) => t.sns === "instagram")!;
    const text = `新しくしました ${STORE}`;

    const first = await ensurePostLinks(admin, { ownerId: aliceId, projectId, postTargetId: threads.id, sns: "threads", text });
    const again = await ensurePostLinks(admin, { ownerId: aliceId, projectId, postTargetId: threads.id, sns: "threads", text });
    expect(first.get(STORE)).toMatch(/\/go\/[A-Za-z0-9]{8}$|^https:\/\/[^/]+\/[A-Za-z0-9]{8}$/);
    expect(again.get(STORE)).toBe(first.get(STORE));
    expect(await substituteForTarget(admin, threads.id, "threads", text)).toBe(`新しくしました ${first.get(STORE)}`);

    expect((await ensurePostLinks(admin, { ownerId: aliceId, projectId, postTargetId: insta.id, sns: "instagram", text })).size).toBe(0);
    expect(await substituteForTarget(admin, insta.id, "instagram", text)).toBe(text);

    // 止めたリンクには置き換えない
    await admin.from("short_links").update({ disabled_at: new Date().toISOString() }).eq("post_target_id", threads.id);
    expect(await substituteForTarget(admin, threads.id, "threads", text)).toBe(text);
  });
});

describe("投稿を保存したときの用意", () => {
  it("送る前の自動の配信先にだけ用意し、オフにすると消す。手で投稿する SNS・送った配信先には触らない", async () => {
    const body = `新しくしました ${STORE}`;
    const { data: postId } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: projectId,
      p_body: body,
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [{ sns: "x" }, { sns: "threads" }, { sns: "note", title: "題" }],
    });
    const { data: targets } = await admin.from("post_targets").select("id, sns").eq("post_id", postId!);
    const id = (sns: string) => targets!.find((t) => t.sns === sns)!.id;

    await preparePostLinks(admin, { ownerId: aliceId, projectId, postId: postId!, enabled: true });
    const preview = await postLinkPreview(alice, postId!);
    expect(Object.keys(preview).sort()).toEqual(["threads", "x"]);
    expect(preview.x![0].destination).toBe(STORE);
    expect(preview.x![0].url).not.toBe(preview.threads![0].url);
    // 他人には見えない
    expect(await postLinkPreview(bob, postId!)).toEqual({});

    // X を送り済みにしてからオフにすると、送る前の Threads のリンクだけが消える
    await admin.from("post_targets").update({ status: "published" }).eq("id", id("x"));
    await preparePostLinks(admin, { ownerId: aliceId, projectId, postId: postId!, enabled: false });
    expect(Object.keys(await postLinkPreview(alice, postId!))).toEqual(["x"]);
    expect((await admin.from("short_links").select("id").eq("post_target_id", id("note"))).data).toEqual([]);

    // 他人の投稿には用意しない
    await expect(preparePostLinks(admin, { ownerId: bobId, projectId, postId: postId!, enabled: true })).rejects.toBeTruthy();
  });
});
