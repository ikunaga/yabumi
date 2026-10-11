import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "@/lib/canonical-host";

const prod = { appUrl: "https://yabumi.app", vercelEnv: "production" };

describe("本番の URL への転送", () => {
  it("本番の vercel.app のアドレスは、パスとクエリを保ったまま APP_URL へ", () => {
    expect(canonicalRedirect(new URL("https://yabumi.vercel.app/projects/1?tab=a"), prod)?.toString()).toBe("https://yabumi.app/projects/1?tab=a");
  });

  it("すでに APP_URL なら転送しない", () => {
    expect(canonicalRedirect(new URL("https://yabumi.app/projects"), prod)).toBeNull();
  });

  it("プレビューとローカルは転送しない", () => {
    expect(canonicalRedirect(new URL("https://yabumi-git-x.vercel.app/"), { ...prod, vercelEnv: "preview" })).toBeNull();
    expect(canonicalRedirect(new URL("https://localhost:3100/"), { appUrl: "https://localhost:3100" })).toBeNull();
  });

  it("vercel.app ではないホスト（www など）はここでは扱わない", () => {
    expect(canonicalRedirect(new URL("https://www.yabumi.app/"), prod)).toBeNull();
  });

  it("外から POST で届くもの（予約ジョブ、Threads の通知）は転送しない", () => {
    expect(canonicalRedirect(new URL("https://yabumi.vercel.app/api/jobs/publish"), prod)).toBeNull();
    expect(canonicalRedirect(new URL("https://yabumi.vercel.app/sns/threads/uninstall"), prod)).toBeNull();
    expect(canonicalRedirect(new URL("https://yabumi.vercel.app/sns/threads/delete"), prod)).toBeNull();
    expect(canonicalRedirect(new URL("https://yabumi.vercel.app/sns/threads/callback?code=1"), prod)?.host).toBe("yabumi.app");
  });

  it("APP_URL がまだ vercel.app のときは何もしない", () => {
    expect(canonicalRedirect(new URL("https://yabumi.vercel.app/"), { appUrl: "https://yabumi.vercel.app", vercelEnv: "production" })).toBeNull();
  });
});
