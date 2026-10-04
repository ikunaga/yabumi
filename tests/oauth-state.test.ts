import { describe, expect, it } from "vitest";
import { newOAuthState, OAUTH_STATE_MAX_AGE, serializeOAuthState, verifyOAuthState } from "@/lib/sns/oauth-state";

const user = "11111111-1111-4111-8111-111111111111";
const project = "22222222-2222-4222-8222-222222222222";

describe("OAuth の state", () => {
  it("cookie と戻ってきた state が一致し、同じ利用者なら通す", () => {
    const s = newOAuthState(user, project, 1000);
    const result = verifyOAuthState(serializeOAuthState(s), s.state, user, 2000);
    expect(result?.projectId).toBe(project);
  });

  it("state が違えば通さない（CSRF）", () => {
    const s = newOAuthState(user, project);
    const other = newOAuthState(user, project);
    expect(verifyOAuthState(serializeOAuthState(s), other.state, user)).toBeNull();
    expect(verifyOAuthState(serializeOAuthState(s), null, user)).toBeNull();
    expect(verifyOAuthState(undefined, s.state, user)).toBeNull();
  });

  it("始めた人と違う利用者なら通さない", () => {
    const s = newOAuthState(user, project);
    expect(verifyOAuthState(serializeOAuthState(s), s.state, "33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("期限切れは通さない", () => {
    const s = newOAuthState(user, project, 0);
    expect(verifyOAuthState(serializeOAuthState(s), s.state, user, OAUTH_STATE_MAX_AGE * 1000 + 1)).toBeNull();
  });

  it("壊れた cookie は通さない", () => {
    expect(verifyOAuthState("not-json", "x", user)).toBeNull();
    const bad = Buffer.from(JSON.stringify({ state: "x", userId: user, projectId: "../evil", createdAt: Date.now() })).toString("base64url");
    expect(verifyOAuthState(bad, "x", user)).toBeNull();
  });
});
