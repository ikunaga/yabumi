// セキュリティ確認 2026-11-06 の L2・L3（アプリの側）: cookie の書き足し、X の投稿の文の控え（写した下書きを捨てる・消えたあと）。本物の AI と X は呼ばない
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPY_RUN, X_POST_TEXT_PURGED, dropCopiedDrafts, xPostPurged, type PostIdea } from "@/lib/ai/post-ideas";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("プライバシーポリシーの cookie（L2）", () => {
  it("直前に開いていたプロジェクトの cookie を、表と cookie の条の 2 か所に書く", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("直前に開いていたプロジェクトの番号の cookie（1 年。ログアウト・退会で消す）");
    expect(privacy).toContain("用語集をプロジェクトの中から開いたときに同じ上の帯で出すため（直前に開いていたプロジェクトの番号だけ。1 年。ログアウト・退会で消す）");
    // 書いた期間とアプリの設定が合っている
    expect(read("src/lib/projects/last-project.ts")).toContain("maxAge: 60 * 60 * 24 * 365");
  });
});

describe("X の投稿の文の控え（L3）", () => {
  const idea = (texts: string[]): PostIdea => ({ pillar: "p", title: "t", angle: "a", commits: [], drafts: texts.map((text, i) => ({ sns: (["x", "threads"] as const)[i], text })) });
  const ref = "朝 6 時、店の前の道がいちばんいい匂いになる時間。この匂いのために早起きしてる人がいるらしい。";

  it(`元の文と空白を除いて ${COPY_RUN} 字以上続けて同じ下書きは捨てる。下書きのなくなったネタも捨てる`, () => {
    const copied = "朝6時、店の前の道がいちばんいい匂いになる時間。この匂いのために早起きしてる";
    const own = "朝 6 時半。オーブンを開ける前の 30 分が、いちばん静かな時間です。";
    const r = dropCopiedDrafts({ ideas: [idea([own, copied]), idea([copied])], questions: [] }, ref);
    expect(r.dropped).toBe(2);
    expect(r.value!.ideas).toHaveLength(1);
    expect(r.value!.ideas[0].drafts.map((d) => d.text)).toEqual([own]);
    expect(dropCopiedDrafts({ ideas: [idea([copied])], questions: [] }, ref)).toEqual({ value: null, dropped: 1 });
  });

  it("短く重なるだけ（決まり文句・ハッシュタグ）では捨てない。元の文がない・短いときは何もしない", () => {
    const v = { ideas: [idea(["いちばんいい匂いになる時間です。 #パン屋"])], questions: [] };
    expect(dropCopiedDrafts(v, ref)).toEqual({ value: v, dropped: 0 });
    expect(dropCopiedDrafts(v, "")).toEqual({ value: v, dropped: 0 });
  });

  it("文と気になったところが消えた控えは「消えた」とわかり、出し直しでは貼り直すよう知らせる", () => {
    expect(xPostPurged({ url: "https://x.com/a/status/1", id: "1", text: "", interest: "" })).toBe(true);
    expect(xPostPurged({ url: "https://x.com/a/status/1", id: "1", text: "", interest: "書き出し" })).toBe(false);
    expect(xPostPurged(undefined)).toBe(false);
    expect(X_POST_TEXT_PURGED).toContain("貼り直してください");
  });

  it("検索のサーバーの説明は、選んだ文が会話に残ることと、1 日ほどで消すことを書く", () => {
    const src = read("src/lib/sns/x/search-server.ts");
    expect(src).toContain("選んだ投稿の文は、ネタを出すとネタ出しの会話の控え");
    expect(src).toContain("1 日ほどで DB が消す");
  });
});
