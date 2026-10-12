// テンプレートの画像の並べ方（折り返し・大きさ合わせ・縦横比・色）。Canvas は使わず、字の幅は決まった値で測る
import { describe, expect, it } from "vitest";
import {
  PALETTES,
  TEMPLATE_KINDS,
  autoAlt,
  brandPalette,
  canvasSize,
  contrastRatio,
  defaultSizeFor,
  fitText,
  layoutTemplate,
  templateReady,
  wrapLines,
  type FontFace,
  type Measure,
  type TemplateInput,
} from "@/lib/media/templates";

// 全角は字の大きさ、半角は 0.55 倍の幅とみなす
const measure: Measure = (text, _font, size) => [...text].reduce((w, ch) => w + (/[\x20-\x7e]/.test(ch) ? size * 0.55 : size), 0);
const font: FontFace = { family: "test", weight: 700 };
const fonts = { heading: font, body: { family: "test", weight: 500 }, bodyBold: font };

const base: TemplateInput = {
  kind: "card",
  size: "portrait",
  palette: PALETTES[0],
  fonts,
  label: "新機能",
  headline: "通知の時間を自分で決められるようになりました",
  subline: "朝と夜の 2 回だけ届くようにもできます",
  footer: "かけいぼ日和",
  diagramStyle: "points",
  items: [
    { title: "朝に届く", text: "その日の予定を確かめられる" },
    { title: "夜に届く", text: "使ったお金を振り返れる" },
  ],
  screenshot: null,
};

const texts = (l: ReturnType<typeof layoutTemplate>) => l.ops.flatMap((o) => (o.type === "text" ? [o] : []));

describe("文字の折り返し", () => {
  it("幅に収まるように折り、句読点・閉じかっこを行の頭に置かない", () => {
    // 5 字で折れる幅。「。」が 6 字目に来るので、前の字ごと次の行へ送る
    expect(wrapLines("あいうえお。かき", 5 * 10, font, 10, measure)).toEqual(["あいうえ", "お。かき"]);
    expect(wrapLines("あいうえおかきく", 5 * 10, font, 10, measure)).toEqual(["あいうえお", "かきく"]);
    for (const l of wrapLines("あいうえお」かきくけこ、さ", 50, font, 10, measure)) expect("、。）」".includes([...l][0])).toBe(false);
  });

  it("開きかっこを行の終わりに残さない", () => {
    const lines = wrapLines("あいうえ「おかき」", 5 * 10, font, 10, measure);
    for (const l of lines.slice(0, -1)) expect([...l].at(-1)).not.toBe("「");
  });

  it("英数字の単語は途中で折らず、改行はそのまま残す", () => {
    const lines = wrapLines("新しい Yabumi 2.0\nです", 8 * 10, font, 10, measure);
    expect(lines.some((l) => l.includes("Yabumi"))).toBe(true);
    expect(lines.at(-1)).toBe("です");
  });

  it("行数に収まるまで小さくし、収まらなければ最後の行を「…」で切る", () => {
    const f = fitText("あ".repeat(30), { maxWidth: 100, maxLines: 2, maxSize: 20, minSize: 5, font }, measure);
    expect(f.lines.length).toBeLessThanOrEqual(2);
    expect(f.size).toBeLessThan(20);
    const cut = fitText("あ".repeat(300), { maxWidth: 100, maxLines: 2, maxSize: 20, minSize: 10, font }, measure);
    expect(cut.lines).toHaveLength(2);
    expect(cut.lines[1].endsWith("…")).toBe(true);
    expect(measure(cut.lines[1], font, cut.size)).toBeLessThanOrEqual(100);
  });
});

describe("縦横比と色", () => {
  it("送り先に Instagram・Threads・Facebook があれば縦 4:5、X だけなら横 16:9", () => {
    expect(defaultSizeFor(["x", "instagram"]).size).toBe("portrait");
    expect(defaultSizeFor(["threads"]).size).toBe("portrait");
    expect(defaultSizeFor(["x"]).size).toBe("landscape");
    expect(defaultSizeFor([]).size).toBe("portrait");
    expect(canvasSize("note", "portrait")).toEqual({ w: 1280, h: 670 });
  });

  it("どの大きさも Instagram の範囲（4:5〜1.91:1）で、長い辺は 2,048px まで", () => {
    for (const size of ["portrait", "square", "landscape"] as const) {
      const { w, h } = canvasSize("card", size);
      expect(w / h).toBeGreaterThanOrEqual(0.8);
      expect(w / h).toBeLessThanOrEqual(1.91);
      expect(Math.max(w, h)).toBeLessThanOrEqual(2048);
    }
  });

  it("用意した色の組み合わせは、文字が読める濃さの差がある（4.5:1 以上）", () => {
    for (const p of PALETTES) expect(contrastRatio(p.fg, p.bg), p.label).toBeGreaterThanOrEqual(4.5);
  });

  it("アプリの色から、白か黒の読みやすいほうの文字を選ぶ", () => {
    expect(brandPalette("#1d4ed8").fg).toBe("#ffffff");
    expect(brandPalette("#fde047").fg).toBe("#111111");
    expect(contrastRatio(brandPalette("#e4572e").fg, brandPalette("#e4572e").bg)).toBeGreaterThanOrEqual(3);
    expect(brandPalette("だめな色").bg).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("並べ方", () => {
  it("どの種類・大きさでも、文字が画像の外にはみ出さない", () => {
    for (const kind of TEMPLATE_KINDS) {
      for (const size of ["portrait", "square", "landscape"] as const) {
        for (const diagramStyle of ["points", "steps", "compare"] as const) {
          const l = layoutTemplate({ ...base, kind, size, diagramStyle, screenshot: { w: 1170, h: 2532 }, items: [...base.items, { title: "グラフ", text: "ひと月の変化が見える" }] }, measure);
          for (const t of texts(l)) {
            const w = measure(t.text, t.font, t.size);
            const left = t.align === "center" ? t.x - w / 2 : t.align === "right" ? t.x - w : t.x;
            expect(left, `${kind}/${size}/${diagramStyle}: ${t.text}`).toBeGreaterThanOrEqual(0);
            expect(left + w, `${kind}/${size}/${diagramStyle}: ${t.text}`).toBeLessThanOrEqual(l.w + 0.5);
            expect(t.y, `${kind}/${size}: ${t.text}`).toBeLessThanOrEqual(l.h);
            expect(t.y - t.size).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("見出し・ラベル・補足・名前を描く", () => {
    const all = texts(layoutTemplate(base, measure)).map((t) => t.text).join("");
    for (const s of ["新機能", "かけいぼ日和"]) expect(all).toContain(s);
    expect(all.replace(/\s/g, "")).toContain(base.headline);
  });

  it("図解は項目と番号を描き、「前と後」は 2 つまで", () => {
    const l = layoutTemplate({ ...base, kind: "diagram", headline: "通知の使い方", items: [...base.items, { title: "三つ目", text: "" }] }, measure);
    expect(texts(l).map((t) => t.text)).toEqual(expect.arrayContaining(["1", "2", "3", "朝に届く", "三つ目"]));
    const c = layoutTemplate({ ...base, kind: "diagram", diagramStyle: "compare", items: [...base.items, { title: "三つ目", text: "" }] }, measure);
    expect(texts(c).map((t) => t.text)).not.toContain("三つ目");
    expect(c.ops.filter((o) => o.type === "tri")).toHaveLength(1);
  });

  it("アプリの画面は、画像を選ぶまで見本の枠を出し、選ぶと画像を置く", () => {
    const empty = layoutTemplate({ ...base, kind: "screen" }, measure);
    expect(empty.ops.some((o) => o.type === "placeholder")).toBe(true);
    const shot = layoutTemplate({ ...base, kind: "screen", screenshot: { w: 1170, h: 2532 } }, measure);
    const img = shot.ops.find((o) => o.type === "image")!;
    expect(img).toBeDefined();
    // 縦長の画面は、縦横比を保つ
    if (img.type === "image") expect(img.w / img.h).toBeCloseTo(1170 / 2532, 2);
  });

  it("添える前に、足りないものを知らせる", () => {
    expect(templateReady({ ...base, headline: " " })).toBe("見出しを書いてください");
    expect(templateReady({ ...base, kind: "diagram", items: [{ title: "", text: "" }] })).toBe("項目を 1 つ以上書いてください");
    expect(templateReady({ ...base, kind: "screen" })).toBe("アプリの画面の画像を選んでください");
    expect(templateReady(base)).toBeNull();
  });

  it("代わりの文を、描いた文字から作る", () => {
    expect(autoAlt(base)).toBe("「通知の時間を自分で決められるようになりました」と書かれた画像。新機能。朝と夜の 2 回だけ届くようにもできます");
    expect(autoAlt({ ...base, kind: "diagram", headline: "通知の使い方" })).toBe("「通知の使い方」の図解（ポイント）。1. 朝に届く：その日の予定を確かめられる。2. 夜に届く：使ったお金を振り返れる");
    expect(autoAlt({ ...base, kind: "screen" })).toContain("アプリの画面に");
  });
});

describe("見出しの行のそろえ方", () => {
  it("最後の行に 1〜2 字だけ残るときは、字を少し小さくするか、同じ行数で最後の行を長くする。残りが長ければそのまま", () => {
    const opts = { maxWidth: 100, maxLines: 3, maxSize: 10, minSize: 10, font, balance: true };
    expect(fitText("あいうえおかきくけこさし", opts, measure).lines).toEqual(["あいうえおかきく", "けこさし"]);
    expect(fitText("あいうえおかきくけこさしすせそ", opts, measure).lines).toEqual(["あいうえおかきくけこ", "さしすせそ"]);
    // 小さくしてよいなら、意味の切れ目で 2 行に収める
    const f = fitText("通知の時間を、自分で決められました", { ...opts, minSize: 6 }, measure);
    expect(f.lines).toEqual(["通知の時間を、", "自分で決められました"]);
  });
});

describe("意味の切れ目で折る", () => {
  it("行の後ろのほうに読点があれば、そこで折る", () => {
    expect(wrapLines("通知の時間を、自分で決められます", 10 * 10, font, 10, measure)).toEqual(["通知の時間を、", "自分で決められます"]);
    // 読点が行の前のほうにあるときは、そこでは折らない
    expect(wrapLines("はい、通知の時間を自分で決められます", 10 * 10, font, 10, measure)[0]).toBe("はい、通知の時間を自");
  });
});
