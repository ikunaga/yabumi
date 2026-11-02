// Instagram の「プロフィールのリンクから」に使う、行き先の URL とプロフィールの短縮リンクの有無（4.37）。ローカルの Supabase を使う
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createShortLink } from "@/lib/links/store";
import { loadProfileLinkInfo } from "@/lib/posts/profile-link-info";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));

const admin = adminClient();
const STORE = "https://apps.apple.com/jp/app/id123456789";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let app: { id: string; product_type: string | null; app_store_url: string | null; play_store_url: string | null };

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  app = (await alice.from("projects").insert({ name: "プロフィールのリンク", product_type: "app", app_store_url: STORE }).select("id, product_type, app_store_url, play_store_url").single()).data!;
  await alice.from("project_destinations").insert({ project_id: app.id, kind: "site", label: "", url: "https://example.com", position: 0 });
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("プロフィールのリンクの有無", () => {
  it("アプリならストアの URL を先に、登録した行き先を続けて返す。Instagram のプロフィールのリンクは、使っているものだけ数える", async () => {
    expect(await loadProfileLinkInfo(alice, app)).toEqual({
      productType: "app",
      destinations: [
        { kind: "store", url: STORE },
        { kind: "site", url: "https://example.com" },
      ],
      hasInstagramLink: false,
    });
    // X のプロフィールのリンクは数えない
    await createShortLink(admin, { ownerId: aliceId, projectId: app.id, destinationUrl: STORE, sns: "x", kind: "profile" });
    expect((await loadProfileLinkInfo(alice, app)).hasInstagramLink).toBe(false);
    const link = await createShortLink(admin, { ownerId: aliceId, projectId: app.id, destinationUrl: STORE, sns: "instagram", kind: "profile" });
    expect((await loadProfileLinkInfo(alice, app)).hasInstagramLink).toBe(true);
    await admin.from("short_links").update({ disabled_at: new Date().toISOString() }).eq("id", link.id);
    expect((await loadProfileLinkInfo(alice, app)).hasInstagramLink).toBe(false);
  });

  it("他人のプロジェクトの行き先とリンクは読めない", async () => {
    await createShortLink(admin, { ownerId: aliceId, projectId: app.id, destinationUrl: STORE, sns: "instagram", kind: "profile" });
    expect(await loadProfileLinkInfo(bob, { ...app, product_type: "shop", app_store_url: null })).toEqual({ productType: "shop", destinations: [], hasInstagramLink: false });
  });
});
