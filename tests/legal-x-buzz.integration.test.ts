// 2026-11-06 の版の再同意: 前の版（2026-11-03）に同意した人は、新しい版に同意するまで同意の帯が出る（src/app/(app)/layout.tsx の consentState と同じ判定）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consentVia, hasConsented, recordConsent } from "@/lib/legal/consent";
import { currentLegalVersion, todayJst } from "@/lib/legal/version";
import { deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

let alice: TestClient;
let aliceId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
});
afterAll(async () => {
  await deleteUser(aliceId);
});

describe("2026-11-06 の版の再同意", () => {
  it.runIf(todayJst() >= "2026-11-06")("前の版に同意していても、新しい版には同意していないので帯が出る。同意すると出なくなる（記録は再同意 change）", async () => {
    // あとの版（2026-11-07 など）が足されていても、前の版の同意では帯が出る
    expect(currentLegalVersion() >= "2026-11-06").toBe(true);
    await recordConsent(alice, "2026-11-03", "login");
    expect(await hasConsented(alice, currentLegalVersion())).toBe(false);
    expect(await consentVia(alice, false)).toBe("change");
    await recordConsent(alice, currentLegalVersion(), "change");
    expect(await hasConsented(alice, currentLegalVersion())).toBe(true);
  });
});
