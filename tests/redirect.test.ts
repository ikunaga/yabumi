import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("自サイト内のパスはそのまま通す", () => {
    expect(safeNextPath("/projects/abc")).toBe("/projects/abc");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "projects", "", undefined, null, 1])(
    "外部や不正な値 %s は既定のパスに置き換える",
    (value) => {
      expect(safeNextPath(value)).toBe("/projects");
    },
  );
});
