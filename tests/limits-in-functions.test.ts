// サーバー専用の関数の上限は、関数の中の定数（20261117140000。セキュリティ確認の DB-L2）。画面やメッセージに出す TS の値とそろっていること
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MAX_IMAGE_BYTES, MAX_UNATTACHED, USER_QUOTA_BYTES } from "@/lib/media/rules";
import { MAX_PENDING_TICKETS } from "@/lib/media/store";
import { MAX_PENDING_VIDEO_TICKETS, MAX_UNATTACHED_VIDEOS, MAX_VIDEO_BYTES, VIDEO_GLOBAL_QUOTA_BYTES, VIDEO_MONTH_LIMIT, VIDEO_USER_QUOTA_BYTES } from "@/lib/media/video-rules";
import { YOUTUBE_GLOBAL_DAILY_UPLOADS, YOUTUBE_USER_DAILY_UPLOADS } from "@/lib/sns/youtube/config";

const sql = readFileSync(new URL("../supabase/migrations/20261117140000_limits_in_functions.sql", import.meta.url), "utf8");

// 関数の本体から、定数の値を読む
function constants(fn: string): Record<string, number> {
  const start = sql.indexOf(`create function public.${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  const body = sql.slice(start, sql.indexOf("$$;", start));
  return Object.fromEntries([...body.matchAll(/(c_\w+) constant (?:integer|bigint) := (\d+);/g)].map((m) => [m[1], Number(m[2])]));
}

describe("関数の中の上限と TS の値", () => {
  it("YouTube のアップロード", () => {
    expect(constants("reserve_youtube_upload")).toEqual({ c_global_daily: YOUTUBE_GLOBAL_DAILY_UPLOADS, c_user_daily: YOUTUBE_USER_DAILY_UPLOADS });
  });

  it("動画の引換券", () => {
    expect(constants("video_upload_check")).toEqual({
      c_max_pending: MAX_PENDING_VIDEO_TICKETS,
      c_max_unattached: MAX_UNATTACHED_VIDEOS,
      c_quota_bytes: VIDEO_USER_QUOTA_BYTES,
      c_max_file_bytes: MAX_VIDEO_BYTES,
      c_month_limit: VIDEO_MONTH_LIMIT,
      c_global_quota_bytes: VIDEO_GLOBAL_QUOTA_BYTES,
    });
  });

  it("画像の引換券", () => {
    expect(constants("issue_media_upload_ticket")).toEqual({
      c_max_pending: MAX_PENDING_TICKETS,
      c_max_unattached: MAX_UNATTACHED,
      c_quota_bytes: USER_QUOTA_BYTES,
      c_max_file_bytes: MAX_IMAGE_BYTES,
    });
  });

  it("上限を引数で受けない（呼び出す側から変えられない）", () => {
    expect(sql).not.toMatch(/p_(max|quota|month|global|user)_\w+\s+(integer|bigint)/);
  });
});

describe("本文を上限の大きさまでだけ読む（readLimitedText。セキュリティ確認の L3）", () => {
  it("Content-Length が上限を超えていれば読まず、書いていなくても読んだ量で止める。上限までは読む", async () => {
    const { readLimitedText } = await import("@/lib/http/limited-body");
    const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers, duplex: "half" } as RequestInit);
    expect(await readLimitedText(post("あいう"), 9)).toBe("あいう");
    expect(await readLimitedText(post("あいう"), 8)).toBeNull();
    expect(await readLimitedText(new Request("http://x/", { method: "POST", body: "a", headers: { "content-length": "100" } }), 10)).toBeNull();
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(6)); c.enqueue(new Uint8Array(6)); c.close(); } });
    expect(await readLimitedText(post(stream), 10)).toBeNull();
    expect(await readLimitedText(new Request("http://x/"), 10)).toBe("");
  });
});
