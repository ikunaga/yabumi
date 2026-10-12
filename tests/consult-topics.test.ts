import { describe, expect, it } from "vitest";
import { CONSULT_TOPICS } from "@/lib/ai/consult";
import { CONSULT_TOPIC_META, consultTopicMeta, summarizeConsultThread } from "@/lib/ai/consult-topics";

describe("AI と相談の入口", () => {
  it("相談の入口と、名前・見出しの表が同じ入口を持つ", () => {
    expect(Object.keys(CONSULT_TOPIC_META).sort()).toEqual(Object.keys(CONSULT_TOPICS).sort());
  });

  it("ロードマップ・指標から始めた相談は、その入口の見出しと戻り先を持つ", () => {
    expect(consultTopicMeta("roadmap")?.entry).toMatchObject({ title: "ロードマップを AI と作る", back: { path: "roadmap" } });
    expect(consultTopicMeta("review")?.entry).toMatchObject({ title: "AI と振り返る", back: { path: "metrics" } });
    expect(consultTopicMeta("what_to_post")?.entry).toBeUndefined();
  });

  it("一覧では入口ごとの名前で見分ける。知らない入口は null", () => {
    expect(consultTopicMeta("roadmap")?.listTitle).toBe("ロードマップづくり");
    expect(consultTopicMeta("review")?.listTitle).toBe("振り返り");
    expect(consultTopicMeta("toString")).toBeNull();
    expect(consultTopicMeta(null)).toBeNull();
  });
});

describe("これまでの相談の一覧の名前", () => {
  it("入口の名前に、最後に採用した案の名前を添える。採用した数も数える", () => {
    expect(
      summarizeConsultThread([
        { role: "user", kind: "start", topic: "roadmap" },
        { role: "assistant", option: "4 週間で 8 本" },
        { role: "user", kind: "adopt", title: "4 週間で 12 本" },
        { role: "assistant", option: "週 3 本" },
        { role: "user", kind: "adopt", title: "週 3 本" },
      ]),
    ).toEqual({ topicTitle: "ロードマップづくり", title: "週 3 本", adopted: 2 });
  });

  it("まだ選んでいなければ、最後の案を「など（まだ選んでいない）」で。前の形の提案も読む", () => {
    expect(summarizeConsultThread([{ role: "user", kind: "start", topic: "review" }, { role: "assistant", option: "来週のやること" }]).title).toBe("来週のやること など（まだ選んでいない）");
    expect(summarizeConsultThread([{ role: "user", kind: "start", topic: "roadmap" }, { role: "assistant", legacy: "1 か月で 12 本" }]).title).toBe("1 か月で 12 本 など（まだ選んでいない）");
  });

  it("書いて始めた相談は、最初の発言（40 字まで、改行はつめる）", () => {
    const s = summarizeConsultThread([{ role: "user", kind: "text", text: "Threads で\n反応がない。" + "あ".repeat(50) }]);
    expect(s.topicTitle).toBeNull();
    expect(s.title).toBe(`Threads で 反応がない。${"あ".repeat(24)}…`);
  });
});
