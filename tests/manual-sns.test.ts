// 手で投稿する SNS（note・Substack）のルール
import { describe, expect, it } from "vitest";
import { normalizeCoachTurn } from "@/lib/ai/plan-coach-schema";
import { checkTarget, isManualSns, MANUAL_SNS_KEYS, manualComposeUrl, SNS_KEYS } from "@/lib/sns";

describe("手で投稿する SNS", () => {
  it("note と Substack は手で投稿する SNS で、並びの最後", () => {
    expect(MANUAL_SNS_KEYS).toEqual(["note", "substack"]);
    expect(SNS_KEYS.slice(-2)).toEqual(["note", "substack"]);
    expect(isManualSns("threads")).toBe(false);
  });

  it("長文の SNS はタイトルが必要。文字数の上限はない", () => {
    const long = "あ".repeat(20000);
    expect(checkTarget("note", long).issues).toEqual(["needs_title"]);
    expect(checkTarget("note", long, undefined, "タイトル").issues).toEqual([]);
    expect(checkTarget("substack", long, undefined, "Title").maxLength).toBeNull();
    // 自動の SNS にはタイトルを求めない
    expect(checkTarget("threads", "こんにちは").issues).toEqual([]);
  });

  it("投稿の画面の URL。Substack は登録したプロフィールから作る", () => {
    expect(manualComposeUrl("note")).toBe("https://note.com/notes/new");
    expect(manualComposeUrl("substack", "https://masa.substack.com/")).toBe("https://masa.substack.com/publish/post");
    expect(manualComposeUrl("substack", "https://news.example.com")).toBe("https://news.example.com/publish/post");
    expect(manualComposeUrl("substack", "https://substack.com/@masa")).toBe("https://substack.com/home");
    expect(manualComposeUrl("substack", null)).toBe("https://substack.com/home");
    expect(manualComposeUrl("threads")).toBeNull();
  });

  it("AI の案の「SNS ごとの役割」に note と Substack を入れられる", () => {
    const t = normalizeCoachTurn({
      message: "案です",
      choices: [],
      proposal: {
        section: "cadence",
        recommended: 0,
        reason: "",
        options: [{ title: "a", summary: "", pros: [], cons: [], value_json: JSON.stringify({ frequency: "週 2 回", roles: [{ sns: "note", role: "月 1 の振り返り" }, { sns: "substack", role: "英語のお知らせ" }] }) }],
      },
    });
    expect(t!.proposal!.options[0].value).toEqual({ frequency: "週 2 回", roles: { note: "月 1 の振り返り", substack: "英語のお知らせ" } });
  });
});
