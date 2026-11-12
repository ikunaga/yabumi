// 添えた画像に、あとから見出しを付ける（4.58）。入口の決まり・文字が入っているか・説明文・元のたどり方。Canvas は使わない
import { describe, expect, it } from "vitest";
import {
  headlineAction,
  headlineAlt,
  headlineAutoAlt,
  headlineInput,
  headlineUnknown,
  initialHeadline,
  paletteOf,
  textAfterEdit,
  type HeadlineSettings,
} from "@/lib/media/headline";
import { editSource, editedIds, staleAfterEdit } from "@/lib/media/image-edit";
import { PALETTES, brandPalette, templateReady } from "@/lib/media/templates";

const fonts = { heading: { family: "a", weight: 700 }, body: { family: "a", weight: 500 }, bodyBold: { family: "a", weight: 700 } };
const settings = (patch: Partial<HeadlineSettings> = {}): HeadlineSettings => ({ ...initialHeadline({ width: 1080, height: 1350 }, "お店"), headline: "秋の新作", ...patch });

describe("見出しの入口", () => {
  it("上げた写真・AI の写真は「見出しを付ける」", () => {
    expect(headlineAction({ text: false })).toBe("add");
  });
  it("文字のカード・図解・note のヘッダーには出さない", () => {
    expect(headlineAction({ text: true })).toBeNull();
  });
  it("最後に見出しを付けた画像は「見出しを直す」", () => {
    expect(headlineAction({ text: true, edit: { kind: "headline" } })).toBe("edit");
  });
  it("見出しを付けたあとに縦横を整えた・調整した画像には出さない（見出しが 2 つになる）", () => {
    expect(headlineAction({ text: true, edit: { kind: "aspect" } })).toBeNull();
    expect(headlineAction({ text: true, edit: { kind: "adjust" } })).toBeNull();
  });
  it("写真を縦横を整えた・調整したあとは「見出しを付ける」", () => {
    expect(headlineAction({ text: false, edit: { kind: "adjust" } })).toBe("add");
  });
  it("保存して開き直した画像は「見出しを付ける」を出し、重なるおそれを添える", () => {
    expect(headlineAction({})).toBe("add");
    expect(headlineUnknown({})).toBe(true);
    expect(headlineUnknown({ text: false })).toBe(false);
    expect(headlineUnknown({ text: true, edit: { kind: "headline" } })).toBe(false);
    // 開き直した画像を調整しても、わからないまま
    expect(headlineUnknown({ edit: { kind: "adjust" } })).toBe(true);
  });
});

describe("文字が入っているか", () => {
  it("見出しを付けたら入る。縦横を整える・調整するは前の画像のまま", () => {
    expect(textAfterEdit({ text: false }, "headline")).toBe(true);
    expect(textAfterEdit({}, "headline")).toBe(true);
    expect(textAfterEdit({ text: false }, "adjust")).toBe(false);
    expect(textAfterEdit({ text: true }, "aspect")).toBe(true);
    expect(textAfterEdit({}, "aspect")).toBeUndefined();
  });
});

describe("最初の設定", () => {
  it("縦横は写真にいちばん近いもの、写真は全面に敷く、下の名前はプロジェクトの名前", () => {
    const s = initialHeadline({ width: 3000, height: 4000 }, "お店");
    expect(s.size).toBe("portrait");
    expect(initialHeadline({ width: 1920, height: 1080 }, "").size).toBe("landscape");
    expect(initialHeadline({ width: 1000, height: 1000 }, "").size).toBe("square");
    expect(s.photoFit).toBe("cover");
    expect(s.footer).toBe("お店");
    expect(s.headline).toBe("");
  });
  it("色・文字の形・置き方は前回のもの", () => {
    const s = initialHeadline({ width: 10, height: 10 }, "", { palette: "brand", brand: "#336699", font: "mincho", textStyle: "band" });
    expect([s.palette, s.brand, s.font, s.textStyle]).toEqual(["brand", "#336699", "mincho", "band"]);
  });
  it("見出しが空のうちは差し替えられない", () => {
    const input = headlineInput(settings({ headline: " " }), fonts, { width: 1080, height: 1350 });
    expect(templateReady(input)).toBe("見出しを書いてください");
    expect(templateReady(headlineInput(settings(), fonts, { width: 1080, height: 1350 }))).toBeNull();
  });
  it("写真に見出しの形で描く（写真の大きさ・置き方・色）", () => {
    const input = headlineInput(settings({ photoFit: "frame", palette: "brand", brand: "#336699" }), fonts, { width: 800, height: 600 });
    expect(input.kind).toBe("screen");
    expect(input.screenshot).toEqual({ w: 800, h: 600 });
    expect(input.photoFit).toBe("frame");
    expect(input.palette).toEqual(brandPalette("#336699"));
    expect(paletteOf("ない色", "#000000")).toBe(PALETTES[0]);
  });
});

describe("説明文", () => {
  it("空なら見出しから作る", () => {
    expect(headlineAlt("", settings())).toBe("写真に「秋の新作」と添えた画像");
    expect(headlineAlt(" ", settings({ subline: "10 月から" }))).toBe("写真に「秋の新作」と添えた画像。10 月から");
  });
  it("利用者が書いた説明文は変えない", () => {
    expect(headlineAlt("店の前の栗の木", settings())).toBe("店の前の栗の木");
    expect(headlineAlt("店の前の栗の木", settings(), settings({ headline: "前" }))).toBe("店の前の栗の木");
  });
  it("前の見出しから作ったままなら、新しい見出しから作り直す", () => {
    const prev = settings({ headline: "夏の新作" });
    expect(headlineAlt(headlineAutoAlt(prev), settings(), prev)).toBe("写真に「秋の新作」と添えた画像");
  });
});

describe("見出しの元のたどり方", () => {
  const P = { id: "photo" };
  it("初めて付けるときは、いまの画像に重ねる", () => {
    expect(editSource(P, "headline")).toBe(P);
  });
  it("見出しを直すときは、見出しのない元の写真から描き直し、前の見出しの画像は消す", () => {
    const H1 = { id: "h1", original: P, edit: { kind: "headline" as const, base: P } };
    expect(editSource(H1, "headline")).toBe(P);
    expect(staleAfterEdit(H1, "headline", "h2")).toEqual(["h1"]);
  });
  it("調整した写真に付けた見出しを直しても、調整は消えない（調整した画像から描き直す）", () => {
    const A = { id: "a", original: P, edit: { kind: "adjust" as const, base: P } };
    const H = { id: "h", original: P, edit: { kind: "headline" as const, base: { id: "a" } } };
    expect(editSource(A, "headline")).toBe(A);
    expect(editSource(H, "headline").id).toBe("a");
    expect(staleAfterEdit(H, "headline", "h2")).toEqual(["h"]);
  });
  it("写真に見出しで添えた画像を元に戻すと、敷いた写真は残し、見出しの画像を消す", () => {
    const H = { id: "h", original: P, edit: { kind: "headline" as const, base: P } };
    expect(editedIds(H)).toEqual(["h"]);
  });
});
