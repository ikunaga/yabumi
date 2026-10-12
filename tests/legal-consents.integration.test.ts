// 利用規約とプライバシーポリシーへの同意の記録（決定 D31。docs/legal.md の「施行したあとの変え方」）。ローカルの Supabase を使う。
// 本人だけが読め、本人の・今日までの版だけを記録できる。日時は DB が入れ、直したり消したりはできない。退会で消える
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consentVia, hasConsented, recordConsent } from "@/lib/legal/consent";
import { currentLegalVersion } from "@/lib/legal/version";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("同意の記録", () => {
  it("同意していなければ記録し、2 回目は重ならない。どこで同意したかは、招待なら invite、前の版に同意していれば change", async () => {
    const version = currentLegalVersion();
    expect(await hasConsented(alice, version)).toBe(false);
    expect(await consentVia(alice, true)).toBe("invite");
    expect(await consentVia(alice, false)).toBe("login");
    await recordConsent(alice, version, "invite");
    await recordConsent(alice, version, "invite");
    expect(await hasConsented(alice, version)).toBe(true);
    const { data } = await alice.from("legal_consents").select("user_id, version, via, accepted_at");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ user_id: aliceId, version, via: "invite" });
    // 前の版に同意した人が、新しい版に同意するときは再同意
    expect(await consentVia(alice, true)).toBe("change");
  });

  it("他人の同意は読めない。ログインしていない人は読めず書けない", async () => {
    expect((await bob.from("legal_consents").select("id").eq("user_id", aliceId)).data).toEqual([]);
    expect((await anonClient().from("legal_consents").select("id").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("legal_consents").insert({ version: currentLegalVersion(), via: "login" })).error?.code).toBe("42501");
  });

  it("他人の同意や、先の版への同意は書けない。日時は決められず、直したり消したりもできない", async () => {
    // 持ち主は書けない列（DB が auth.uid() を入れる）
    expect((await bob.from("legal_consents").insert({ user_id: aliceId, version: currentLegalVersion(), via: "login" } as never)).error?.code).toBe("42501");
    expect((await bob.from("legal_consents").insert({ version: currentLegalVersion(), via: "login", accepted_at: "2020-01-01T00:00:00Z" } as never)).error?.code).toBe("42501");
    expect((await bob.from("legal_consents").insert({ version: "2099-01-01", via: "login" })).error?.code).toBe("42501");
    expect((await bob.from("legal_consents").insert({ version: currentLegalVersion(), via: "admin" as never })).error?.code).toBe("23514");
    await recordConsent(bob, currentLegalVersion(), "login");
    expect((await bob.from("legal_consents").update({ via: "signup" }).eq("user_id", bobId)).error?.code).toBe("42501");
    expect((await bob.from("legal_consents").delete().eq("user_id", bobId)).error?.code).toBe("42501");
    expect(await hasConsented(bob, currentLegalVersion())).toBe(true);
  });

  it("退会すると消える", async () => {
    const { client: carol, userId: carolId } = await signUpNewUser();
    await recordConsent(carol, currentLegalVersion(), "signup");
    await deleteUser(carolId);
    expect((await admin.from("legal_consents").select("id").eq("user_id", carolId)).data).toEqual([]);
  });
});
