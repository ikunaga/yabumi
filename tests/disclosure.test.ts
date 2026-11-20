// 開く欄の共通の部品（src/components/ui/disclosure.tsx。2026-11-20 オーナーの指示・案 E）:
// <details> と <summary> で組むこと（キーボード・読み上げで開け閉めできる）、件数・開いた状態・地の色の出し分け、
// 画面に「▸」「▶」の開く欄が残っていないこと
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisclosureBox } from "@/components/ui/disclosure";

type Props = Parameters<typeof DisclosureBox>[0];
const html = (props: Partial<Omit<Props, "children">>) =>
  renderToStaticMarkup(createElement(DisclosureBox, { label: "つないでいない SNS を表示", ...props } as Props, createElement("p", null, "中身")));

describe("DisclosureBox", () => {
  it("details と summary で組み、中身は summary の後ろに出す", () => {
    const h = html({});
    expect(h.startsWith("<details")).toBe(true);
    expect(h).toMatch(/<summary[^>]*>.*つないでいない SNS を表示.*<\/summary><div[^>]*><p>中身<\/p><\/div><\/details>$/);
    expect(h).not.toContain(" open=");
  });

  it("件数は括弧で添え、無いときは出さない", () => {
    expect(html({ count: 5 })).toContain("つないでいない SNS を表示<span class=\"num\">（5）</span>");
    expect(html({})).not.toContain("（");
    expect(html({ count: 0 })).toContain("（0）");
  });

  it("open・id を details に渡す", () => {
    const h = html({ open: true, id: "goal-form" });
    const tag = h.slice(0, h.indexOf(">") + 1);
    expect(tag).toContain('id="goal-form"');
    expect(tag).toContain('open=""');
  });

  it("地は bg-subtle、bg-subtle の面に置くときは bg-surface にする", () => {
    expect(html({})).toContain("bg-subtle hover:bg-subtle-hover");
    expect(html({ onSubtle: true })).toContain("bg-surface hover:bg-subtle");
  });

  it("枠は一段濃い border-input（ライトで地と区別がつくように）", () => {
    expect(html({})).toContain("border-input");
  });

  it("size=sm は高さを抑えて文字を小さくし、中身を補足の文の見た目にする", () => {
    const sm = html({ size: "sm" });
    expect(sm).toContain("py-1.5 text-xs");
    expect(sm).toContain('<div class="mt-2 text-[14px] leading-[1.75] text-muted"><p>中身</p></div>');
    expect(html({})).toContain('<div class="mt-2"><p>中身</p></div>');
    expect(html({ size: "sm", bodyClassName: "mt-3" })).toContain('<div class="mt-3">');
  });
});

describe("画面の開く欄", () => {
  // 案 E にそろえた（対象外: トップのよくある質問・メニュー類（DismissableDetails）・アカウント設計の SNS ごとの行（右端に DisclosureChevron））
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
    });
  const ALLOWED = new Set([
    "src/app/page.tsx",
    "src/components/ui/disclosure.tsx",
    "src/components/ui/dismissable-details.tsx",
    "src/components/plan/profile-fields.tsx",
  ]);

  it("help.tsx の「くわしく」の Disclosure は無くし、DisclosureBox にそろえた", () => {
    const uses = files("src").filter((p) => /<Disclosure[\s>]/.test(readFileSync(p, "utf8")));
    expect(uses).toEqual([]);
  });

  it("<details> を直接書くのは、決めた例外のファイルだけ", () => {
    const raw = files("src")
      .filter((p) => /<details[\s>]/.test(readFileSync(p, "utf8")))
      .filter((p) => !ALLOWED.has(p));
    expect(raw).toEqual([]);
  });
});
