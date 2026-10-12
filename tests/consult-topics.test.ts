import { describe, expect, it } from "vitest";
import { CONSULT_TOPICS } from "@/lib/ai/consult";
import { CONSULT_TOPIC_META, consultTopicMeta } from "@/lib/ai/consult-topics";

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
