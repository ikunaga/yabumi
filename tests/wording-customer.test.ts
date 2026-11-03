// 呼び方「顧客」（2026-11-03 オーナーの指摘「お客さん、て表現違和感すごい。顧客にして」）: 画面と AI への指示に「お客さん」を残さない。
// AI が書く SNS の投稿の本文・自己紹介文では「顧客」と書かず、読む人に向けた呼び方にする
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSULT_SYSTEM } from "@/lib/ai/consult-prompt";
import { PLAN_COACH_SYSTEM } from "@/lib/ai/plan-coach-prompt";
import { POST_IDEAS_SYSTEM } from "@/lib/ai/post-ideas";
import { TIDY_DRAFT_SYSTEM } from "@/lib/ai/tidy-draft";
import { GLOSSARY_CATEGORIES } from "@/lib/glossary/terms";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("呼び方「顧客」", () => {
  it("src のどこにも「お客さん」がない", () => {
    const left = files("src").filter((path) => readFileSync(path, "utf8").includes("お客さん"));
    expect(left).toEqual([]);
  });

  it("用語集の分類の名前は「顧客の流れと数字」", () => {
    expect(GLOSSARY_CATEGORIES.find((c) => c.id === "flow")?.label).toBe("顧客の流れと数字");
  });

  it("投稿を書く AI は、本文に「顧客」と書かない", () => {
    expect(POST_IDEAS_SYSTEM).toContain("下書きの本文では「顧客」と書かない");
    expect(TIDY_DRAFT_SYSTEM).toContain("投稿の本文では「顧客」と書かない");
  });

  it("利用者に話す AI は「顧客」と呼び、SNS で読む人に見せる文では書かない", () => {
    for (const system of [PLAN_COACH_SYSTEM, CONSULT_SYSTEM]) {
      expect(system).toContain("「顧客」と呼ぶ");
      expect(system).toContain("SNS で読む人に見せる文では「顧客」と書かず");
    }
  });
});
