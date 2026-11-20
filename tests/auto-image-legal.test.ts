// 自動の回の画像と見出しの版（docs/legal.md の「自動の回の画像と見出しの版」。② として扱った。了承は 2026-11-20）:
// 版の並び・規約とポリシーの新しい文・作りとの一致。版は 2026-11-21（src/lib/legal/version.ts の version と同じ）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-21";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("自動の回の画像と見出しの版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("利用規約とプライバシーポリシーの版で、決まりを守っている", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toEqual(["terms", "privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-20");
    expect(rev.noticeWaived).not.toContain("【仮】");
    expect(rev.summary).toHaveLength(1);
    expect(rev.summary[0]).toContain("AI の画像をつくって添え、AI が書いた見出しを重ねられる");
    expect(rev.summary[0]).toContain("Threads・Instagram・X に AI で作ったことの印");
    expect(historyProblems()).toEqual([]);
    // 1 日 1 版で、施行済みの 2026-11-20 の版の次
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
    expect(LEGAL_VERSIONS.at(-2)!.version).toBe("2026-11-20");
  });

  it("プライバシーポリシーに、画像の設定・使い道・Anthropic と Google に送るもの・SNS に送る AI の印を書いた", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("画像の設定（どこから作るか・写真かイラストか・縦横・見出しを重ねるか・見出しの見た目〈色・書体・置き方〉）");
    expect(privacy).toContain("AI が投稿の文を作り、設定に応じて画像をつくって添え、送る前の確かめ");
    expect(privacy).toContain("自動の回の画像の場面を AI が書くときは、その回の本文と、フォーマットの絵の説明・穴に入れた言葉を送ります。");
    expect(privacy).toContain("自動の投稿では、利用者がその場で押していないときにも、設定に沿って作った絵の説明〈AI がその回の本文から書いた場面、フォーマットの穴の言葉を埋めたもの〉を送ります");
    // Threads・Instagram・X の 3 つの行に AI の印。Facebook の行は変えない（欄がない）
    expect(privacy.split("添えた画像と画像の説明文（AI で作った画像を添えたときは、AI で作ったことの印）").length - 1).toBe(3);
    expect(privacy).toContain('"投稿の本文、添えた画像または動画（Facebook が');
  });

  it("利用規約に、自動の投稿の画像と重ねた見出し・本サービスが付ける AI の印を書いた", () => {
    const terms = read("src/app/terms/page.tsx");
    expect(terms).toContain("AI が作った文（設定したときは、AI がつくった画像と、AI が書いて本サービスが画像に重ねた見出しを含みます）");
    expect(terms).toContain("SNS が仕組みを用意している範囲で（Threads・Instagram・X）、本サービスが AI で作ったことの印を付けて送ります");
  });

  it("書いたことが作りに合っている（印の欄・押していないときに送る絵の説明・見出しの書き方）", () => {
    expect(read("src/lib/sns/threads/api.ts")).toContain("is_made_with_ai");
    expect(read("src/lib/sns/instagram/api.ts")).toContain("is_ai_generated");
    expect(read("src/lib/sns/x/api.ts")).toContain("made_with_ai");
    expect(read("src/lib/sns/adapters/facebook.ts")).not.toMatch(/made_with_ai|ai_generated/);
    const image = read("src/lib/auto-post/image.ts");
    expect(image).toContain('purpose: "auto_post_scene"');
    expect(image).toContain("withAiMark");
    expect(read("src/lib/auto-post/ai-schema.ts")).toContain("headline: z.string().nullable()");
  });
});
