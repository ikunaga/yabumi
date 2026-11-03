// 口調を SNS ごとに変える（src/lib/plan/pillars.ts の toneFor・tonePromptLines）: 前の形の読み替え、知らない SNS、AI に渡す口調の切り替え。本物の AI は呼ばない
import { describe, expect, it } from "vitest";
import { buildAiCheckRequest } from "@/lib/ai/ai-check";
import { buildImageBriefRequest } from "@/lib/ai/image-brief";
import { buildPhotoIdeasRequest } from "@/lib/ai/photo";
import { toSectionValue } from "@/lib/ai/plan-coach-schema";
import { ideaContextText, type IdeaContext } from "@/lib/ai/post-ideas";
import { describeSection } from "@/lib/plan/describe";
import { hasToneBySns, toneFor, tonePromptLines } from "@/lib/plan/pillars";
import { normalizePlan, parseSectionForm, sectionSchemas } from "@/lib/plan/schema";

const plan = normalizePlan(
  {
    pillars: {
      items: [{ name: "開発の状況", share: 50, example: "", sns: [] }],
      tone: "です・ます調で丁寧に",
      toneBySns: { instagram: "くだけた口調で、絵文字を少し", x: "短く言い切る" },
      avoid: "",
    },
  },
  "",
);
const p = plan.pillars;
const textOf = (req: { messages: { content: unknown }[] }) => (req.messages[0].content as { text: string }[])[0].text;

describe("前の形の読み替えと、知らない SNS", () => {
  it("toneBySns のない設計（前の版）は空として読み、どの SNS も共通の口調", () => {
    const old = normalizePlan({ pillars: { items: [{ name: "a", share: null, example: "" }], tone: "です・ます調", avoid: "" } }, "");
    expect(old.pillars.toneBySns).toEqual({});
    expect(old.pillars.items).toHaveLength(1);
    expect(toneFor(old.pillars, "instagram")).toBe("です・ます調");
    expect(hasToneBySns(old.pillars)).toBe(false);
  });

  it("知らない SNS・空の口調・文字でない値は捨て、ほかは残す（セクションは空にならない）", () => {
    const v = sectionSchemas.pillars.parse({ items: [{ name: "a", share: null, example: "" }], tone: "共通", toneBySns: { mastodon: "x", threads: "  ", instagram: "くだけて", x: 3 } });
    expect(v.toneBySns).toEqual({ instagram: "くだけて" });
    expect(v.items).toHaveLength(1);
  });

  it("フォームの tone-<SNS> を読む。空欄は保存しない", () => {
    const f = new FormData();
    f.set("tone", "共通");
    f.set("tone-instagram", "くだけて");
    f.set("tone-x", " ");
    f.set("tone-bogus", "読まない");
    const r = parseSectionForm("pillars", f);
    expect(r.success).toBe(true);
    expect(r.data!.toneBySns).toEqual({ instagram: "くだけて" });
  });

  it("300 字を超える SNS ごとの口調は、ほかの欄と同じく保存できない", () => {
    const f = new FormData();
    f.set("tone-x", "あ".repeat(301));
    expect(parseSectionForm("pillars", f).success).toBe(false);
  });

  it("AI の案（AI と考える・相談）の toneBySns も読む。ない案は空", () => {
    const v = toSectionValue("pillars", { items: [{ name: "a", share: null, example: "" }], tone: "共通", toneBySns: { instagram: "くだけて", mastodon: "?" }, avoid: "" }) as typeof p;
    expect(v.toneBySns).toEqual({ instagram: "くだけて" });
    const none = toSectionValue("pillars", { items: [{ name: "a", share: null, example: "" }], tone: "共通", avoid: "" }) as typeof p;
    expect(none.toneBySns).toEqual({});
  });

  it("設計の案の表示に、SNS ごとの口調を添える", () => {
    const rows = describeSection("pillars", p);
    expect(rows).toContainEqual({ label: "Instagram の口調", text: "くだけた口調で、絵文字を少し" });
    expect(rows).toContainEqual({ label: "X の口調", text: "短く言い切る" });
  });
});

describe("AI に渡す口調の切り替え", () => {
  it("送り先の SNS の口調があればそれ、なければ共通", () => {
    expect(toneFor(p, "instagram")).toBe("くだけた口調で、絵文字を少し");
    expect(toneFor(p, "threads")).toBe("です・ます調で丁寧に");
  });

  it("送り先のどれにも SNS ごとの口調がなければ、前と同じ 1 行", () => {
    expect(tonePromptLines(p, ["threads"])).toEqual(["口調: です・ます調で丁寧に"]);
    expect(tonePromptLines({ tone: "", toneBySns: {} }, ["x"])).toEqual(["口調: （未設定）"]);
  });

  it("送り先ごとに、その SNS の口調（なければ共通）を並べる", () => {
    const lines = tonePromptLines(p, ["x", "threads"]);
    expect(lines.slice(1)).toEqual(["- X（x）: 短く言い切る", "- Threads（threads）: です・ます調で丁寧に"]);
    expect(lines.join("\n")).not.toContain("絵文字");
  });

  it("送り先がわからなければ、共通と SNS ごとの口調を全部", () => {
    const text = tonePromptLines(p, []).join("\n");
    expect(text).toContain("口調（共通）: です・ます調で丁寧に");
    expect(text).toContain("- Instagram（instagram）: くだけた口調で、絵文字を少し");
  });

  const ctx = (sns: IdeaContext["sns"]): IdeaContext => ({ project: { name: "yabumi", description: "", targetAudience: "", productType: "app" }, plan, sns });

  it("ネタを出す・AI で投稿に整える（ideaContextText）", () => {
    const ig = ideaContextText(ctx(["instagram"]));
    expect(ig).toContain("- Instagram（instagram）: くだけた口調で、絵文字を少し");
    expect(ig).not.toContain("短く言い切る");
    expect(ideaContextText(ctx(["threads"]))).toContain("口調: です・ます調で丁寧に");
  });

  it("AI の見直し・画像の文字の案・絵の説明の案", () => {
    expect(textOf(buildAiCheckRequest({ projectName: "p", plan, sns: ["x"] }, [{ sns: "x", text: "本文" }]))).toContain("- X（x）: 短く言い切る");
    expect(textOf(buildImageBriefRequest({ projectName: "p", plan, sns: ["instagram"] }, "本文"))).toContain("くだけた口調で、絵文字を少し");
    const photo = textOf(buildPhotoIdeasRequest({ projectName: "p", plan, sns: ["threads"] }, "本文"));
    expect(photo).toContain("口調: です・ます調で丁寧に");
    expect(photo).not.toContain("短く言い切る");
  });

  it("口調が決まっていない見直しは、前と同じ書き方", () => {
    const empty = normalizePlan(null, "");
    expect(textOf(buildAiCheckRequest({ projectName: "p", plan: empty, sns: ["x"] }, [{ sns: "x", text: "本文" }]))).toContain("口調: （未設定。です・ます調か、くだけた口調かの一方にそろっていればよい）");
  });
});
