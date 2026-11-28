import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("自サイト内のパスはそのまま通す", () => {
    expect(safeNextPath("/projects/abc")).toBe("/projects/abc");
  });

  it("通知のリンク（確認の画面と ?run=）はそのまま通す", () => {
    expect(safeNextPath("/projects/abc/auto/review?run=0b6f4c1e-2d1a-4c8e-9f00-1a2b3c4d5e6f")).toBe("/projects/abc/auto/review?run=0b6f4c1e-2d1a-4c8e-9f00-1a2b3c4d5e6f");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r//evil.example", "/a\\b", "projects", "", undefined, null, 1])(
    "外部や不正な値 %s は既定のパスに置き換える",
    (value) => {
      expect(safeNextPath(value)).toBe("/projects");
    },
  );
});
