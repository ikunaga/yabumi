// 自動の投稿の「画像」を、シリーズのフォーマットの画像の設定に合わせて出し分ける（2026-11-20 オーナーの指摘
// 「フォーマットで画像の細かい設定をしているのに、なぜ自動の投稿で、画像を付けるか・AI が作るかの選択肢が出てくるの？」）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoImage } from "@/lib/auto-post/types";
import { fitImageToFormat } from "@/lib/auto-post/format-image";
import { formatsBackHref, readFormatsBack } from "@/lib/post-formats/back";
import { EMPTY_IMAGE, imageSpecText } from "@/lib/post-formats/image";

vi.mock("@/lib/ai/photo-actions", () => ({ acknowledgePhoto: vi.fn() }));
// 見出しの見た目の欄は next/font を読むので、ここでは空にする（出し分けだけを見る）
vi.mock("@/components/posts/template-fields", () => ({ StyleFields: () => null, loadTemplateStyle: () => null }));
const { ImagePicker } = await import("@/components/auto-post/image-picker");

const ai: AutoImage = { source: "ai", style: "photo", size: "portrait", headline: "ai", look: { palette: "kinari", brand: "#123456", font: "gothic", textStyle: "quiet" } };
const withImage = { hasImage: true, hasHeadline: true };
const noHeadline = { hasImage: true, hasHeadline: false };
const noImage = { hasImage: false, hasHeadline: false };

describe("保存する画像の設定（fitImageToFormat）", () => {
  it("フォーマットに画像の設定があれば、選んだものにかかわらず source=format。見出しはフォーマットに見出しがあれば format", () => {
    expect(fitImageToFormat("series", withImage, null, true)).toEqual({ source: "format", style: "illustration", size: "auto", headline: "format" });
    expect(fitImageToFormat("series", noHeadline, ai, true)).toEqual({ source: "format", style: "illustration", size: "auto", headline: "none" });
    // 見出しを重ねるときは、前に選んでいた見た目を残す
    expect(fitImageToFormat("series", withImage, ai, true)?.look).toEqual(ai.look);
  });

  it("フォーマットに画像の設定がなければ「フォーマットの画像」は選べない（付けない・AI がつくるはそのまま）", () => {
    expect(fitImageToFormat("series", noImage, { ...ai, source: "format", headline: "format" }, true)).toBeNull();
    expect(fitImageToFormat("series", noImage, ai, true)).toEqual(ai);
    expect(fitImageToFormat("series", noImage, null, true)).toBeNull();
  });

  it("シリーズ以外・画像をつくれない（鍵がない）・フォーマットがわからないときは、そのまま", () => {
    for (const kind of ["notes", "pillars", "events", "product"] as const) expect(fitImageToFormat(kind, withImage, ai, true)).toEqual(ai);
    expect(fitImageToFormat("series", withImage, null, false)).toBeNull();
    expect(fitImageToFormat("series", null, ai, true)).toEqual(ai);
  });
});

describe("フォーマットの画像の設定の要約", () => {
  it("写真かイラスト・縦横・見出しの有無", () => {
    expect(imageSpecText({ ...EMPTY_IMAGE, prompt: "x", style: "photo", size: "portrait", headline: "{答え}" })).toBe("写真・縦 4:5・文字入り");
    expect(imageSpecText({ ...EMPTY_IMAGE, prompt: "x", style: "illustration", size: "auto", headline: null })).toBe("イラスト・送り先に合わせた縦横・文字なし");
  });
});

describe("フォーマットの画面から戻る先", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  it("決まった戻り先だけ（好きな URL は受け取らない）", () => {
    expect(readFormatsBack("p1", new URL(formatsBackHref("p1", { kind: "auto-new" }), "http://x").searchParams.get("back"))?.href).toBe("/projects/p1/auto/new");
    expect(readFormatsBack("p1", new URL(formatsBackHref("p1", { kind: "plan", planId: id }), "http://x").searchParams.get("back"))?.href).toBe(`/projects/p1/auto/${id}`);
    expect(readFormatsBack("p1", `plan-edit:${id}`)?.href).toBe(`/projects/p1/auto/${id}/edit`);
    for (const bad of ["https://evil.example", "//evil.example", "plan:../../x", "plan:", undefined, ["auto-new"]]) expect(readFormatsBack("p1", bad)).toBeNull();
  });
});

describe("ウィザードの「画像」の欄", () => {
  const render = (over: Partial<Parameters<typeof ImagePicker>[0]>) =>
    renderToStaticMarkup(
      createElement(ImagePicker, {
        projectId: "p1",
        kind: "series",
        formatHasImage: true,
        formatHasHeadline: true,
        formatName: "連想映画クイズ",
        formatImageSpec: "写真・縦 4:5・文字入り",
        formatsHref: "/projects/p1/formats?back=auto-new",
        value: { source: "format", style: "illustration", size: "auto", headline: "format" },
        onChange: () => {},
        photo: { enabled: true, acknowledged: true },
        onAcknowledged: () => {},
        ...over,
      }),
    );

  it("フォーマットに画像の設定があれば、選択肢は出さずに要約とフォーマットの編集への入口", () => {
    const html = render({});
    expect(html).toContain("画像と、画像に重ねる文字は、フォーマット「連想映画クイズ」で決めたとおりにつくります。");
    expect(html).toContain("写真・縦 4:5・文字入り");
    expect(html).toContain('href="/projects/p1/formats?back=auto-new"');
    expect(html).toContain("フォーマットを編集 →");
    for (const t of ["画像なしで送る", "AI がつくる", "フォーマットの画像", "重ねない", "フォーマットの見出し", "AI が書く"]) expect(html).not.toContain(t);
  });

  it("見出しのないフォーマットは「画像は」だけ", () => {
    expect(render({ formatHasHeadline: false, value: { source: "format", style: "illustration", size: "auto", headline: "none" } })).toContain("画像は、フォーマット「連想映画クイズ」で決めたとおりに");
  });

  it("フォーマットに画像の設定がなければ、そのことと設定への入口。選べるのは付けない・AI がつくるだけ", () => {
    const html = render({ formatHasImage: false, formatHasHeadline: false, formatImageSpec: null, value: null });
    expect(html).toContain("フォーマットでは、画像を決めていません。下から選んでください。");
    expect(html).toContain("フォーマットで画像を決める →");
    expect(html).toContain("画像なしで送る");
    expect(html).toContain("投稿に合う画像を AI がつくる");
    expect(html).not.toContain("フォーマットの画像");
  });

  it("シリーズ以外は今のまま（フォーマットのことは出さない）", () => {
    const html = render({ kind: "notes", formatHasImage: false, formatHasHeadline: false, value: null });
    expect(html).toContain("画像なしで送る");
    expect(html).toContain("投稿に合う画像を AI がつくる");
    expect(html).not.toContain("フォーマット");
  });

  it("画面の文に「穴」「直す」を使わない", () => {
    for (const html of [render({}), render({ formatHasImage: false, value: ai }), render({ kind: "notes", value: ai })]) {
      expect(html).not.toContain("穴");
      expect(html).not.toContain("直す");
    }
  });
});

describe("「確かめる」の画面の言葉（2026-11-20 オーナーの指摘）", () => {
  it("「何を」は選んだカードと同じ言い方。シリーズはフォーマットの名前", async () => {
    const { kindSummary } = await import("@/lib/auto-post/labels");
    expect(kindSummary("series", "連想映画クイズ")).toBe("シリーズ「連想映画クイズ」");
    expect(kindSummary("series", null)).toBe("シリーズ");
    expect(kindSummary("notes")).toBe("ネタ帳のメモから");
    expect(kindSummary("pillars", "x")).toBe("テーマを順番に");
  });

  it("見本は「テストで 1 本つくる」「テストでつくった投稿」「この投稿を 1 回目として送る」。画面の文で「見本」と言わない", async () => {
    const { readFileSync } = await import("node:fs");
    const paths = [
      "src/components/auto-post/sample-card.tsx",
      "src/components/auto-post/plan-sample.tsx",
      "src/components/auto-post/plan-wizard.tsx",
      "src/app/(app)/projects/[id]/auto/page.tsx",
      "src/app/(app)/projects/[id]/auto/[planId]/page.tsx",
      "src/lib/auto-post/actions.ts",
      "src/lib/auto-post/engine.ts",
    ];
    const files = paths.map((f) => readFileSync(f, "utf8"));
    const card = files[0];
    for (const t of ["テストで 1 本つくる", "設定どおりに 1 本つくって見せます。SNS には送りません。", "もう一度つくる", "テストでつくった投稿", "この投稿を 1 回目として送る"]) expect(card).toContain(t);
    // 画面に出る文（コメントと、サーバーの記録の console.error を除く）
    const shown = files
      .flatMap((t) => t.split("\n"))
      .filter((l) => !/^\s*(\/\/|\{\/\*|\*)/.test(l) && !l.includes("console.error"))
      .map((l) => l.replace(/\s\/\/\s.*$/, "").replace(/\{\/\*.*?\*\/\}/g, ""))
      .join("\n");
    expect(shown).not.toContain("見本");
    expect(shown).not.toContain("最初の回に");
  });

  it("プライバシーポリシーも同じ言い方（① として。過去の版の知らせの文は当時の記録のまま）", async () => {
    const { readFileSync } = await import("node:fs");
    const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
    expect(privacy).not.toContain("見本");
    expect(privacy).not.toContain("最初の回");
    expect(privacy).toContain("利用者が選んだテストでつくった投稿をそのまま 1 回目の投稿として送ったりする");
    expect(readFileSync("src/lib/legal/version.ts", "utf8")).toContain("見本はそのまま最初の回にもできます");
  });
});
