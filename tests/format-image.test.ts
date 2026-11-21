// 投稿のフォーマットの画像の設定（docs/design/format-image.md の 1.・5.1）: 読み方・保存の形・変数の決まり・入れ方
import { describe, expect, it } from "vitest";
import { cleanFormatImage, fillImageText, formatPhotoTexts, hasUnfilled, imageSlotNames, imageSummary, needsAiScene, readFormatImage, usesAnswer } from "@/lib/post-formats/image";
import { checkFormat, FormatError } from "@/lib/post-formats/store";
import { EMPTY_SERIES, readRoundValues, type FormatSeries } from "@/lib/post-formats/series";

const BODY = "連想映画クイズ\n{キーワード}\nこの 5 つから連想する映画は？{ひとこと}";
const SERIES: FormatSeries = {
  vars: [
    { name: "映画", mode: "ai", instruction: "だれでも知っている映画", unique: true },
    { name: "キーワード", mode: "ai", instruction: "{映画}を連想できる言葉を 5 つ", unique: false },
    { name: "ひとこと", mode: "hand", instruction: "", unique: false },
  ],
};
const base = { prompt: "{ひとこと}の雰囲気の机", scene: "fill", style: "illustration", size: "auto", headline: null };

describe("使える変数", () => {
  it("変数の一覧のすべて（本文に書いていない変数も）を、絵の説明で使える", () => {
    expect(imageSlotNames(SERIES)).toEqual(["映画", "キーワード", "ひとこと"]);
    expect(imageSlotNames(EMPTY_SERIES)).toEqual([]);
  });

  it("画像だけで使う AI の変数も使える。使えば AI の変数として扱い、保存もできる", () => {
    const s: FormatSeries = { vars: [...SERIES.vars, { name: "絵の言葉", mode: "ai", instruction: "連想できる物を 3 つ", unique: false }] };
    expect(needsAiScene({ prompt: "{絵の言葉}の机", headline: null }, s)).toBe(true);
    expect(cleanFormatImage({ ...base, prompt: "{絵の言葉}の机" }, s).image?.prompt).toBe("{絵の言葉}の机");
    expect(cleanFormatImage({ ...base, prompt: "{絵の言葉}の机" }, SERIES).problem).toContain("{絵の言葉}");
  });
});

describe("保存の形（cleanFormatImage）", () => {
  it("絵の説明が空なら画像なし。形の違う値は既定にそろえる", () => {
    expect(cleanFormatImage(null, SERIES)).toEqual({ image: null });
    expect(cleanFormatImage({ ...base, prompt: "  " }, SERIES)).toEqual({ image: null });
    expect(cleanFormatImage({ prompt: "机の上", scene: "x", style: 1, size: "huge", headline: "  " }, EMPTY_SERIES).image).toEqual({ prompt: "机の上", scene: "fill", style: "photo", size: "auto", headline: null, label: null, look: null });
  });

  it("一覧にない変数・空の {} は断る。長すぎる絵の説明・見出しも断る", () => {
    expect(cleanFormatImage({ ...base, prompt: "{ない変数}の机" }, SERIES).problem).toContain("{ない変数}");
    expect(cleanFormatImage({ ...base, headline: "{ない変数}" }, SERIES).problem).toContain("{ない変数}");
    expect(cleanFormatImage({ ...base, prompt: "{}の机" }, SERIES).problem).toContain("変数の名前");
    expect(cleanFormatImage({ ...base, prompt: "あ".repeat(601) }, SERIES).problem).toContain("600");
    expect(cleanFormatImage({ ...base, headline: "あ".repeat(41) }, SERIES).problem).toContain("40");
    expect(cleanFormatImage({ ...base, prompt: "{映画}" }, EMPTY_SERIES).problem).toContain("{映画}");
  });

  it("AI の変数を使っても、絵の説明のつくり方は選んだとおりに保存する。使っているかは needsAiScene で見る", () => {
    expect(cleanFormatImage({ ...base, prompt: "{映画}を思わせる小物", scene: "fill" }, SERIES).image?.scene).toBe("fill");
    expect(cleanFormatImage({ ...base, prompt: "{キーワード}が並ぶ机", scene: "ai" }, SERIES).image?.scene).toBe("ai");
    expect(needsAiScene({ prompt: "{映画}を思わせる小物", headline: null }, SERIES)).toBe(true);
    expect(needsAiScene({ prompt: "{キーワード}", headline: null }, SERIES)).toBe(true);
    expect(needsAiScene({ prompt: "{ひとこと}", headline: null }, SERIES)).toBe(false);
    // 本文に出ない「重ならないようにする」変数（クイズの答え）を絵に入れると、答えがわかってしまう
    expect(usesAnswer("{映画}の小物", BODY, SERIES)).toBe(true);
    expect(usesAnswer("{キーワード}", BODY, SERIES)).toBe(false);
  });

  it("checkFormat は image を必ず入れる（なければ {}）。絵の説明に書いた知らない名前は「自分で入れる」変数になる。指示がおたがいを使うと FormatError", () => {
    expect(checkFormat({ name: "a", body: BODY }).image).toEqual({});
    expect(checkFormat({ name: "a", body: BODY, series: SERIES, image: { ...base, prompt: "{映画}" } }).image).toMatchObject({ prompt: "{映画}", scene: "fill" });
    const added = checkFormat({ name: "a", body: BODY, image: { ...base, prompt: "{絵}" } });
    expect(added.series.vars.find((v) => v.name === "絵")).toEqual({ name: "絵", mode: "hand", instruction: "", unique: false });
    const loop = { vars: [{ name: "a", mode: "ai", instruction: "{b}", unique: false }, { name: "b", mode: "ai", instruction: "{a}", unique: false }] };
    expect(() => checkFormat({ name: "a", body: "{a}{b}", series: loop })).toThrow(FormatError);
  });
});

describe("入れ方", () => {
  it("変数の言葉を入れ、入らない変数は【】で残す", () => {
    expect(fillImageText("{映画}と{キーワード}、{ひとこと}", { キーワード: "王女・スクーター", 映画: "ローマの休日" })).toBe("ローマの休日と王女・スクーター、【ひとこと】");
    expect(hasUnfilled("ローマの休日と【ひとこと】")).toBe(true);
    expect(hasUnfilled("ローマの休日")).toBe(false);
  });

  it("DB から読んだ値をそろえ、一覧の 1 行を作る", () => {
    expect(readFormatImage({})).toBeNull();
    const img = readFormatImage({ ...base, scene: "ai", headline: "連想映画クイズ" })!;
    expect(imageSummary(img)).toBe("画像: イラスト・AI が絵の説明を書く・見出しあり");
    expect(imageSummary({ ...img, style: "photo", scene: "fill", headline: null })).toBe("画像: 写真");
  });
});

describe("③ の帯の絵の説明と見出し", () => {
  it("この回の変数の言葉で入れる", () => {
    const image = { prompt: "{映画}を思わせる{キーワード}", scene: "ai" as const, style: "photo" as const, size: "auto" as const, headline: "連想映画クイズ {ひとこと}", label: null, look: null };
    expect(formatPhotoTexts({ image }, { キーワード: "王女", ひとこと: "第 3 回", 映画: "ローマの休日" })).toEqual({ text: "ローマの休日を思わせる王女", headline: "連想映画クイズ 第 3 回", label: null });
    expect(formatPhotoTexts({ image: { ...image, headline: null } }, {})).toEqual({ text: "【映画】を思わせる【キーワード】", headline: null, label: null });
  });

  it("記録の言葉は文字の値だけ読む", () => {
    expect(readRoundValues({ a: "x", b: 1, c: null })).toEqual({ a: "x" });
    expect(readRoundValues(["x"])).toEqual({});
  });
});

describe("見出しの上の小さい文（label。2026-11-20 オーナーの指示。見出しを 2 段にする）", () => {
  const withHead = { ...base, headline: "この画像から連想される映画は？", label: "連想映画クイズ" };
  it("20 字まで。一覧にない変数は断る。変数の言葉は使える", () => {
    expect(cleanFormatImage(withHead, SERIES).image?.label).toBe("連想映画クイズ");
    expect(cleanFormatImage({ ...withHead, label: "あ".repeat(21) }, SERIES).problem).toContain("20 字まで");
    expect(cleanFormatImage({ ...withHead, label: "{ない変数}" }, SERIES).problem).toContain("{ない変数}");
    expect(cleanFormatImage({ ...withHead, label: "{ひとこと}" }, SERIES).image?.label).toBe("{ひとこと}");
    expect(cleanFormatImage({ ...withHead, label: "  " }, SERIES).image?.label).toBeNull();
  });
  it("帯に渡すとき、変数を入れる。見出しがなければ小さい文も描かない", () => {
    const image = { ...withHead, scene: "fill" as const, style: "photo" as const, size: "auto" as const, label: "連想映画クイズ {ひとこと}", look: null };
    expect(formatPhotoTexts({ image }, { ひとこと: "第 3 回" }).label).toBe("連想映画クイズ 第 3 回");
    expect(formatPhotoTexts({ image: { ...image, headline: null } }, {}).label).toBeNull();
  });
});

describe("見出しの見た目（look。2026-11-21。フォーマットで決めたとおりに）", () => {
  const look = { palette: "kinari", brand: "#e4572e", font: "mincho", textStyle: "band" };
  it("見出しがあるときだけ持つ。形の違う見た目は捨てる", () => {
    expect(readFormatImage({ ...base, headline: "今週の豆", look })?.look).toEqual(look);
    expect(readFormatImage({ ...base, headline: null, look })?.look).toBeNull();
    expect(readFormatImage({ ...base, headline: "今週の豆", look: { ...look, palette: "rainbow" } })?.look).toBeNull();
    expect(cleanFormatImage({ ...base, headline: "今週の豆", look }, SERIES).image?.look).toEqual(look);
  });
});
