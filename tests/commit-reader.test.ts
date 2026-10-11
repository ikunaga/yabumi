// 最近のコミットを、投稿のネタの材料に整える（秘密の除外と伏せ字、上限）。本物の GitHub は呼ばない
import { describe, expect, it, vi } from "vitest";
import type { CommitDetail, CommitSummary } from "@/lib/github/api";
import { cleanMessage, digestCommit, isWorthReading, MAX_COMMITS, MAX_DETAILED_COMMITS, MAX_PATCH_CHARS_PER_FILE, readRecentCommits } from "@/lib/github/commit-reader";

// 鍵の形の文字列は、つなげて作る（GitHub の push protection で止められるため。README の「テスト」）
const fakeToken = "gh" + "p_" + "a".repeat(36);

function summary(sha: string, message = "fix: 通知が 2 回届く", over: Partial<CommitSummary> = {}): CommitSummary {
  return { sha, commit: { message, author: { date: "2026-10-10T01:00:00Z" }, committer: null }, author: { login: "alice" }, parents: [{ sha: "p" }], ...over };
}

function detail(sha: string, files: CommitDetail["files"]): CommitDetail {
  return { ...summary(sha), files };
}

describe("コミットの読み方", () => {
  it("マージと bot のコミットは材料にしない", () => {
    expect(isWorthReading(summary("a"))).toBe(true);
    expect(isWorthReading(summary("a", "Merge", { parents: [{ sha: "1" }, { sha: "2" }] }))).toBe(false);
    expect(isWorthReading(summary("a", "bump", { author: { login: "dependabot[bot]" } }))).toBe(false);
    expect(isWorthReading(summary("a", "bump", { author: { login: "x", type: "Bot" } }))).toBe(false);
  });

  it("メッセージの Co-Authored-By やメールアドレスを落とし、トークンらしき文字列を伏せる", () => {
    const m = cleanMessage(`fix: ログイン\n\n連絡先 me@example.com\ntoken ${fakeToken}\n\nCo-Authored-By: Bot <bot@example.com>`);
    expect(m).not.toContain("example.com");
    expect(m).not.toContain("Co-Authored-By");
    expect(m).not.toContain(fakeToken);
    expect(m).toContain("[伏せました]");
  });

  it("秘密が入りがちなファイルは、名前も差分も出さない。差分の中の鍵らしき文字列は伏せる", () => {
    const d = digestCommit(
      detail("abc", [
        { filename: ".env.local", status: "modified", additions: 1, deletions: 0, patch: "+API_KEY=xxx" },
        { filename: "ios/AuthKey.p8", status: "added", additions: 5, deletions: 0, patch: "+-----BEGIN PRIVATE KEY-----" },
        { filename: "pnpm-lock.yaml", status: "modified", additions: 100, deletions: 3, patch: "+lock" },
        { filename: "src/notify.ts", status: "modified", additions: 3, deletions: 1, patch: `@@\n-send()\n+if (!sent) send()\n+const t = "${fakeToken}"` },
      ]),
      100_000,
    );
    expect(d.files.map((f) => f.path)).toEqual(["src/notify.ts"]);
    expect(d.patch).toContain("if (!sent) send()");
    expect(d.patch).not.toContain(fakeToken);
    expect(d.patch).not.toContain("API_KEY");
    expect(d.patch).not.toContain("BEGIN PRIVATE KEY");
  });

  it("差分は 1 ファイルの上限で切り、残りの文字数を超えない", () => {
    const big = "+x".repeat(MAX_PATCH_CHARS_PER_FILE);
    const d = digestCommit(detail("abc", [{ filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: big }]), 100_000);
    expect(d.patchTruncated).toBe(true);
    expect(d.patch.length).toBeLessThan(MAX_PATCH_CHARS_PER_FILE + 100);
    const none = digestCommit(detail("abc", [{ filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" }]), 0);
    expect(none.patch).toBe("");
  });

  it("新しいものから上限まで読み、差分は先頭の数件だけ取りにいく", async () => {
    const list = Array.from({ length: MAX_COMMITS + 5 }, (_, i) => summary(`sha${i}`));
    const get = vi.fn(async (sha: string) => detail(sha, [{ filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" }]));
    const r = await readRecentCommits({ list: async () => list, get }, new Date());
    expect(r.commits).toHaveLength(MAX_COMMITS);
    expect(r.truncated).toBe(true);
    expect(get).toHaveBeenCalledTimes(MAX_DETAILED_COMMITS);
    expect(r.commits[0].patch).toContain("+a");
    expect(r.commits[MAX_COMMITS - 1].patch).toBe("");
  });

  it("詳細が読めないコミットは、メッセージだけ使う", async () => {
    const r = await readRecentCommits({ list: async () => [summary("a", "feat: 共有")], get: async () => Promise.reject(new Error("404")) }, new Date());
    expect(r.commits).toEqual([expect.objectContaining({ sha: "a", message: "feat: 共有", files: [], patch: "" })]);
  });
});
