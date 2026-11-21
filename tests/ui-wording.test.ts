// 画面の文の決まり（docs/design/ui-words.md・docs/design/ui-writing.md。2026-11-20 オーナーの指示
// 「気をつけますではなく、改善の方法を」）。src の画面の文を集め、次のものを見つけたら落とす。
// - 言い換えの表の「画面で使わない言葉」
// - 40 字をこえる 1 文
// - かっこ書きの補足
// 2026-11-20 の時点で画面にあったものは tests/ui-wording.allow.json で許す。新しく足した文だけを落とす。
// 書き直して決まりに合ったら、一覧から消す（消し忘れもこのテストが落とす）。
// 一覧から消すだけなら `UI_WORDING_PRUNE=1 pnpm vitest run tests/ui-wording.test.ts` で書き換えられる。足すことはできない
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SENTENCE, collectUiTexts, parentheticals, sentenceLength, sentences, type UiText } from "./helpers/ui-text";
import { UI_WORD_RULES, UI_WORD_RULES_WITHOUT_PATTERN } from "./helpers/ui-words";

const ALLOW_PATH = "tests/ui-wording.allow.json";
// { ファイル: { 文: [許している決まり] } }。決まりは ui-words.md の ID と、long（長い文）・paren（かっこ書き）
type Allow = Record<string, Record<string, string[]>>;
const allow: Allow = JSON.parse(readFileSync(ALLOW_PATH, "utf8"));

function problems(t: UiText): string[] {
  const found = UI_WORD_RULES.filter((r) => r.pattern.test(t.text)).map((r) => r.id);
  if (sentences(t.text).some((s) => sentenceLength(s) > MAX_SENTENCE)) found.push("long");
  if (parentheticals(t.text).length > 0) found.push("paren");
  return found;
}

const texts = collectUiTexts();
const found = texts.map((t) => ({ ...t, problems: problems(t) })).filter((t) => t.problems.length > 0);

describe("画面の文の決まり", () => {
  it("画面の文を集められている（集め方が壊れていない）", () => {
    expect(texts.length).toBeGreaterThan(3000);
    const wizard = texts.filter((t) => t.file === "src/components/auto-post/plan-wizard.tsx").map((t) => t.text);
    expect(wizard).toContain("自動投稿をはじめる");
    // 文字と {式} が並んでいるところは、1 つの文につなぐ
    expect(wizard.some((t) => t.includes("時間前に文を作り") && t.startsWith("送る"))).toBe(true);
    // AI に送る指示は読まない
    expect(texts.some((t) => t.text.startsWith("あなたは「yabumi」の中で"))).toBe(false);
    // 規約・プライバシーポリシーは読まない
    expect(texts.some((t) => t.file.startsWith("src/app/privacy") || t.file.startsWith("src/app/terms"))).toBe(false);
  });

  it("新しく足した文に、言い換えの表の言葉・40 字をこえる文・かっこ書きがない", () => {
    const fresh = found
      .map((t) => {
        const ok = allow[t.file]?.[t.text] ?? [];
        return { where: `${t.file}:${t.line}`, text: t.text, problems: t.problems.filter((p) => !ok.includes(p)) };
      })
      .filter((t) => t.problems.length > 0);
    // 落ちたら: docs/design/ui-words.md の言い方に変える・1 文を 40 字までに分ける・かっこ書きを別の文にする
    expect(fresh).toEqual([]);
  });

  it("許す一覧に、もう画面にない文・もう当たらない決まりが残っていない（書き直したら一覧から消す）", () => {
    const now = new Map(found.map((t) => [`${t.file}\u0000${t.text}`, t.problems]));
    const stale: string[] = [];
    const pruned: Allow = {};
    for (const [file, entries] of Object.entries(allow)) {
      for (const [text, ids] of Object.entries(entries)) {
        const current = now.get(`${file}\u0000${text}`) ?? [];
        const keep = ids.filter((id) => current.includes(id));
        if (keep.length < ids.length) stale.push(`${file}: ${text} (${ids.filter((id) => !keep.includes(id)).join(",")})`);
        if (keep.length) (pruned[file] ??= {})[text] = keep;
      }
    }
    if (process.env.UI_WORDING_PRUNE === "1" && stale.length) writeFileSync(ALLOW_PATH, JSON.stringify(pruned, null, 1) + "\n");
    expect(stale).toEqual([]);
  });

  it("言い換えの表（ui-words.md）と、テストの言葉の一覧の ID がそろっている", () => {
    const md = readFileSync("docs/design/ui-words.md", "utf8");
    const mdIds = [...md.matchAll(/^\| ([a-z0-9]+) \|/gm)].map((m) => m[1]);
    expect([...UI_WORD_RULES.map((r) => r.id), ...UI_WORD_RULES_WITHOUT_PATTERN].sort()).toEqual([...mdIds].sort());
  });
});

describe("文の集め方と数え方", () => {
  it("文を。！？と改行で分け、空白を数えず、{…} を 2 字に数える", () => {
    expect(sentences("送ります。止めます⏎編集できます")).toEqual(["送ります。", "止めます", "編集できます"]);
    expect(sentenceLength("1 枚 約 {…} 円")).toBe(6);
  });

  it("かっこ書きを見つける。日本語のない半角のかっこ（縦横の比など）は数えない", () => {
    expect(parentheticals("文だけで送ります（写真つきのメモは、写真を添えます）。")).toHaveLength(1);
    expect(parentheticals("縦 4:5 (Instagram)")).toEqual([]);
    expect(parentheticals("画像 (任意)")).toHaveLength(1);
  });

  it("言い換えの表の形: 回数の「回」・やり直しの「直す」・画像を回すは引っかけない", () => {
    const hit = (text: string) => UI_WORD_RULES.filter((r) => r.pattern.test(text)).map((r) => r.id);
    expect(hit("次の回を飛ばす")).toContain("kai");
    // 数字のカードの名前「送った」も送信済みに（2026-11-21）。文の中の「送った」は引っかけない
    expect(hit("送った")).toContain("zumi");
    expect(hit("もう送ってあったので、送った SNS には送り直しません")).toEqual([]);
    // 最初の画面の名前は「ホーム」（2026-11-21）
    expect(hit("概要に戻る")).toContain("home");
    expect(hit("概要の「いまやること」に出します")).toContain("home");
    expect(hit("Overview")).toContain("home");
    expect(hit("ホームに戻る。アプリの概要を書きます")).toEqual([]);
    // 手で投稿する・手で出す（2026-11-21）。手動で投稿する・手で記録するは引っかけない
    expect(hit("X は手で投稿する")).toContain("shudou");
    expect(hit("手では出さないでください")).toContain("shudou");
    expect(hit("X・手で")).toContain("shudou");
    expect(hit("X は手動で投稿する。成果を手で記録する。X・手動")).toEqual([]);
    expect(hit("画像をつくれなかった回は、送らずに下書きに回します。")).toEqual(expect.arrayContaining(["kai", "mawasu"]));
    expect(hit("1 日 3 回まで。毎回付けるタグ。これまで 5 回")).toEqual([]);
    expect(hit("別のアカウントでつなぎ直すと、前のアカウントは外れます")).toEqual([]);
    expect(hit("設定で直せます")).toContain("naosu");
    expect(hit("↻ 右に 90° 回す")).toEqual([]);
    expect(hit("よく使う言い回し。ダウンロードは 1 回しかできません")).toEqual([]);
    expect(hit("画像の数を確かめ、文面を変えます")).toEqual(["tashikameru"]);
    expect(hit("送る前の確かめで引っかかった見本")).toEqual(expect.arrayContaining(["tashikame", "hikkakaru"]));
    // 動詞の「確かめる」は tashikame（名詞）には当たらない。2026-11-20 から「確認」にそろえる（tashikameru）
    expect(hit("中身を確かめてください")).toEqual(["tashikameru"]);
    expect(hit("種類")).toContain("shurui");
    expect(hit("宣伝するものの種類")).toEqual([]);
    expect(hit("時間帯の傾向・携帯で見る")).toEqual([]);
    expect(hit("「ホーム」のいまやることの帯")).toContain("obi");
    expect(hit("今月の AI の枠が、いっぱいになりました")).toContain("waku");
    expect(hit("アプリの画面を、スマホの枠に入れます。空き枠のお知らせ")).toEqual([]);
  });
});
