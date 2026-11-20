import { describe, expect, it } from "vitest";
import { buildShortenRequest } from "@/lib/ai/shorten";
import { plainIssues } from "@/lib/auto-post/checks";
import { tagReserve } from "@/lib/auto-post/checks";
import { buildAutoPostRequest } from "@/lib/auto-post/prompt";

// 自動の投稿に付けるいつものタグ（2026-11-17）: 字数とタグの数は送る文で数え、重なりは本文だけで比べる
describe("自動の投稿の本文とは別に付くタグ", () => {
  const base = { allowedUrls: [], recent: {} };

  it("字数はタグの行を足して数える（X の 140）", () => {
    const body = "あ".repeat(138);
    expect(plainIssues({ x: body }, base)).toEqual([]);
    expect(plainIssues({ x: body }, { ...base, tags: { x: ["パン屋"] } }).map((i) => i.kind)).toContain("too_long");
    expect(tagReserve("x", ["パン屋"])).toBeGreaterThan(0);
    expect(tagReserve("x", [])).toBe(0);
  });

  it("利用者が決めたタグは目安より多くても止めない。AI が本文に足したタグで目安を超えたら止める", () => {
    expect(plainIssues({ threads: "朝の話" }, { ...base, tags: { threads: ["a", "b"] } })).toEqual([]);
    expect(plainIssues({ x: "朝の話 #c" }, { ...base, tags: { x: ["a", "b"] } }).map((i) => i.detail)).toContain("x のハッシュタグが多すぎます");
  });

  it("本文にもあるタグは行に付けないので、2 回数えない", () => {
    expect(plainIssues({ x: "朝の話 #a" }, { ...base, tags: { x: ["a", "b"] } })).toEqual([]);
  });

  it("重なりは本文だけで比べる（毎回同じタグの行で「似すぎ」にしない）", () => {
    const recent = { x: ["朝四時に店の灯りがつきます。生地の様子を見て焼く順番を決めます"] };
    const body = "冬のかぼちゃパンを始めました。甘さ控えめで、朝ごはんにどうぞ";
    expect(plainIssues({ x: body }, { allowedUrls: [], recent, tags: { x: ["パン屋", "天然酵母"] } })).toEqual([]);
  });

  it("縮めるときは、タグの行の分を引いた上限と目標を伝える", () => {
    const req = buildShortenRequest([{ id: "x", sns: "x", text: "あ".repeat(135), reserve: 10 }]);
    const text = JSON.stringify(req.messages);
    expect(text).toContain("後ろに付くタグの分を引いて 130 字");
    expect(buildShortenRequest([{ id: "x", sns: "x", text: "あ".repeat(135) }]).messages.length).toBe(1);
  });

  it("AI には、別に付くタグと「本文にハッシュタグを書かない」を渡す（タグがなければ出さない）", () => {
    const req = JSON.stringify(buildAutoPostRequest({ context: "", material: "メモ", instructions: [], recentBodies: [], fixedTags: { x: ["パン屋"] }, dueAt: new Date() }).messages);
    expect(req).toContain("本文の後ろに別に付くタグ");
    expect(req).toContain("X: #パン屋");
    expect(JSON.stringify(buildAutoPostRequest({ context: "", material: "メモ", instructions: [], recentBodies: [], dueAt: new Date() }).messages)).not.toContain("別に付くタグ");
  });
});
