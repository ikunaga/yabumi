// 偽の Vercel・偽の DNS の宛先（LINK_DOMAIN_TEST_SERVER）は、本番（VERCEL_ENV=production）では使わない（2026-11-21 PM の指示）
import { describe, expect, it, vi } from "vitest";
import { testOnlyEnvInProduction } from "@/lib/env-check";
import { linkDomainTestServer } from "@/lib/links/test-server";
import { vercelConfig } from "@/lib/links/vercel";

describe("LINK_DOMAIN_TEST_SERVER", () => {
  it("開発・テストでは、偽のサーバーの宛先を使う。トークンがなくても Vercel の設定があることにする", () => {
    const env = { LINK_DOMAIN_TEST_SERVER: "http://127.0.0.1:3198/" };
    expect(linkDomainTestServer(env)).toBe("http://127.0.0.1:3198");
    expect(vercelConfig(env)).toMatchObject({ base: "http://127.0.0.1:3198", projectId: "prj_test" });
  });

  it("本番では入っていても使わず、ログに出す。本物のトークンの設定だけを使う", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { LINK_DOMAIN_TEST_SERVER: "http://127.0.0.1:3198", VERCEL_ENV: "production" };
    expect(linkDomainTestServer(env)).toBeNull();
    expect(testOnlyEnvInProduction("LINK_DOMAIN_TEST_SERVER", env)).toBe(true);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("LINK_DOMAIN_TEST_SERVER"));
    expect(vercelConfig(env)).toBeNull();
    expect(vercelConfig({ ...env, VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "prj_x" })).toEqual({ token: "t", projectId: "prj_x", teamId: undefined });
    err.mockRestore();
  });

  it("入っていなければ、いままでどおり（本物の Vercel・本物の DNS）", () => {
    expect(linkDomainTestServer({})).toBeNull();
    expect(testOnlyEnvInProduction("LINK_DOMAIN_TEST_SERVER", { VERCEL_ENV: "production" })).toBe(false);
  });
});
