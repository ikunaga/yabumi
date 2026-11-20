// 投稿のフォーマットの画像の設定（docs/design/format-image.md の 1.・5.1）: 読み方・保存の形・穴の決まり・埋め方
import { describe, expect, it } from "vitest";
import { answerSlotName, cleanFormatImage, fillImageText, formatPhotoTexts, hasUnfilled, imageSlotNames, imageSummary, needsAiScene, readFormatImage, usesAnswer } from "@/lib/post-formats/image";
import { checkFormat, FormatError } from "@/lib/post-formats/store";
import { EMPTY_SERIES, readRoundValues, type FormatSeries } from "@/lib/post-formats/series";

const BODY = "連想映画クイズ\n{キーワード}\nこの 5 つから連想する映画は？{ひとこと}";
const SERIES: FormatSeries = { answer: { name: "映画", instruction: "だれでも知っている映画" }, slots: { キーワード: "連想できる言葉を 5 つ" } };
const base = { prompt: "{ひとこと}の雰囲気の机", scene: "fill", style: "illustration", size: "auto", headline: null };

describe("答えと使える穴", () => {
  it("シリーズの答えの名前を使える。答えの決まりがないシリーズは「答え」、シリーズでなければ使えない", () => {
    expect(answerSlotName(SERIES)).toBe("映画");
    expect(answerSlotName({ answer: null, slots: { キーワード: "" } })).toBe("答え");
    expect(answerSlotName(EMPTY_SERIES)).toBeNull();
    expect(imageSlotNames(BODY, SERIES)).toEqual(["キーワード", "ひとこと", "映画"]);
    expect(imageSlotNames(BODY, EMPTY_SERIES)).toEqual(["キーワード", "ひとこと"]);
  });
});

describe("保存の形（cleanFormatImage）", () => {
  it("絵の説明が空なら画像なし。形の違う値は既定にそろえる", () => {
    expect(cleanFormatImage(null, BODY, SERIES)).toEqual({ image: null });
    expect(cleanFormatImage({ ...base, prompt: "  " }, BODY, SERIES)).toEqual({ image: null });
    expect(cleanFormatImage({ prompt: "机の上", scene: "x", style: 1, size: "huge", headline: "  " }, BODY, EMPTY_SERIES).image).toEqual({ prompt: "机の上", scene: "fill", style: "photo", size: "auto", headline: null, label: null, look: null });
  });

  it("型の文にない穴・空の {} は断る。長すぎる絵の説明・見出しも断る", () => {
    expect(cleanFormatImage({ ...base, prompt: "{ない空欄}の机" }, BODY, SERIES).problem).toContain("{ない空欄}");
    expect(cleanFormatImage({ ...base, headline: "{ない空欄}" }, BODY, SERIES).problem).toContain("{ない空欄}");
    expect(cleanFormatImage({ ...base, prompt: "{}の机" }, BODY, SERIES).problem).toContain("空欄の名前");
    expect(cleanFormatImage({ ...base, prompt: "あ".repeat(601) }, BODY, SERIES).problem).toContain("600");
    expect(cleanFormatImage({ ...base, headline: "あ".repeat(41) }, BODY, SERIES).problem).toContain("40");
    // シリーズでなければ答えは使えない
    expect(cleanFormatImage({ ...base, prompt: "{映画}" }, BODY, EMPTY_SERIES).problem).toContain("{映画}");
  });

  it("答えか AI が埋める空欄を使っても、絵の説明のつくり方は選んだとおりに保存する（2026-11-20 から固定しない）。使っているかは needsAiScene で見る", () => {
    expect(cleanFormatImage({ ...base, prompt: "{映画}を思わせる小物", scene: "fill" }, BODY, SERIES).image?.scene).toBe("fill");
    expect(cleanFormatImage({ ...base, prompt: "{キーワード}が並ぶ机", scene: "ai" }, BODY, SERIES).image?.scene).toBe("ai");
    expect(cleanFormatImage({ ...base, prompt: "{ひとこと}の机", scene: "fill" }, BODY, SERIES).image?.scene).toBe("fill");
    expect(needsAiScene({ prompt: "{映画}を思わせる小物", headline: null }, BODY, SERIES)).toBe(true);
    expect(needsAiScene({ prompt: "{キーワード}", headline: null }, BODY, SERIES)).toBe(true);
    expect(needsAiScene({ prompt: "{ひとこと}", headline: null }, BODY, SERIES)).toBe(false);
    expect(usesAnswer("{映画}の小物", BODY, SERIES)).toBe(true);
    expect(usesAnswer("{キーワード}", BODY, SERIES)).toBe(false);
  });

  it("checkFormat は image を必ず入れる（なければ {}）。型の文にない穴は FormatError", () => {
    expect(checkFormat({ name: "a", body: BODY }).image).toEqual({});
    expect(checkFormat({ name: "a", body: BODY, series: SERIES, image: { ...base, prompt: "{映画}" } }).image).toMatchObject({ prompt: "{映画}", scene: "fill" });
    expect(() => checkFormat({ name: "a", body: BODY, image: { ...base, prompt: "{ない}" } })).toThrow(FormatError);
  });
});

describe("埋め方", () => {
  it("穴の言葉と答えを入れ、埋まらない穴は【】で残す", () => {
    const answer = { name: "映画", value: "ローマの休日" };
    expect(fillImageText("{映画}と{キーワード}、{ひとこと}", { キーワード: "王女・スクーター" }, answer)).toBe("ローマの休日と王女・スクーター、【ひとこと】");
    expect(hasUnfilled("ローマの休日と【ひとこと】")).toBe(true);
    expect(hasUnfilled("ローマの休日")).toBe(false);
    // 答えの名前が型の文の穴と同じなら、穴の言葉を先に使う
    expect(fillImageText("{映画}", { 映画: "空欄に入れた言葉" }, answer)).toBe("空欄に入れた言葉");
  });

  it("DB から読んだ値をそろえ、一覧の 1 行を作る", () => {
    expect(readFormatImage({})).toBeNull();
    const img = readFormatImage({ ...base, scene: "ai", headline: "連想映画クイズ" })!;
    expect(imageSummary(img)).toBe("画像: イラスト・AI が絵の説明を書く・見出しあり");
    expect(imageSummary({ ...img, style: "photo", scene: "fill", headline: null })).toBe("画像: 写真");
  });
});

describe("③ の帯の絵の説明と見出し", () => {
  it("この回の穴の言葉と答えで埋める。答えはシリーズのときだけ", () => {
    const image = { prompt: "{映画}を思わせる{キーワード}", scene: "ai" as const, style: "photo" as const, size: "auto" as const, headline: "連想映画クイズ {ひとこと}", label: null, look: null };
    expect(formatPhotoTexts({ body: BODY, series: SERIES, image }, { キーワード: "王女", ひとこと: "第 3 回" }, "ローマの休日")).toEqual({ text: "ローマの休日を思わせる王女", headline: "連想映画クイズ 第 3 回", label: null });
    expect(formatPhotoTexts({ body: BODY, series: EMPTY_SERIES, image: { ...image, headline: null } }, {}, "ローマの休日")).toEqual({ text: "【映画】を思わせる【キーワード】", headline: null, label: null });
  });

  it("記録の穴の言葉は文字の値だけ読む", () => {
    expect(readRoundValues({ a: "x", b: 1, c: null })).toEqual({ a: "x" });
    expect(readRoundValues(["x"])).toEqual({});
  });
});

describe("見出しの上の小さい文（label。2026-11-20 オーナーの指示。見出しを 2 段にする）", () => {
  const withHead = { ...base, headline: "この画像から連想される映画は？", label: "連想映画クイズ" };
  it("20 字まで。型の文にない空欄は断る。空欄の言葉は使える", () => {
    expect(cleanFormatImage(withHead, BODY, SERIES).image?.label).toBe("連想映画クイズ");
    expect(cleanFormatImage({ ...withHead, label: "あ".repeat(21) }, BODY, SERIES).problem).toContain("20 字まで");
    expect(cleanFormatImage({ ...withHead, label: "{ない空欄}" }, BODY, SERIES).problem).toContain("{ない空欄}");
    expect(cleanFormatImage({ ...withHead, label: "{ひとこと}" }, BODY, SERIES).image?.label).toBe("{ひとこと}");
    expect(cleanFormatImage({ ...withHead, label: "  " }, BODY, SERIES).image?.label).toBeNull();
  });
  it("帯に渡すとき、空欄を埋める。見出しがなければ小さい文も描かない", () => {
    const image = { ...withHead, scene: "fill" as const, style: "photo" as const, size: "auto" as const, label: "連想映画クイズ {ひとこと}", look: null };
    expect(formatPhotoTexts({ body: BODY, series: SERIES, image }, { ひとこと: "第 3 回" }, "ローマの休日").label).toBe("連想映画クイズ 第 3 回");
    expect(formatPhotoTexts({ body: BODY, series: SERIES, image: { ...image, headline: null } }, {}, "ローマの休日").label).toBeNull();
  });
});

describe("見出しの見た目（look。2026-11-21。フォーマットで決めたとおりに）", () => {
  const look = { palette: "kinari", brand: "#e4572e", font: "mincho", textStyle: "band" };
  it("見出しがあるときだけ持つ。形の違う見た目は捨てる", () => {
    expect(readFormatImage({ ...base, headline: "今週の豆", look })?.look).toEqual(look);
    expect(readFormatImage({ ...base, headline: null, look })?.look).toBeNull();
    expect(readFormatImage({ ...base, headline: "今週の豆", look: { ...look, palette: "rainbow" } })?.look).toBeNull();
    expect(cleanFormatImage({ ...base, headline: "今週の豆", look }, BODY, SERIES).image?.look).toEqual(look);
  });
});
