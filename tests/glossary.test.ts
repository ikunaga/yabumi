// 用語集（src/lib/glossary/terms.ts。docs/architecture.md の 4.45）: 語と分類と関連のつながり、メニューに出ること
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { categoryHref, GLOSSARY_CATEGORIES, GLOSSARY_CATEGORY_IDS, GLOSSARY_KEYS, glossary, glossaryHref, illustrationSrc, isGlossaryKey, legacyGlossaryHashTarget, neighbors, type GlossaryTerm } from "@/lib/glossary/terms";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useSelectedLayoutSegment: () => null }));
vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/top-bar", () => ({ TopBar: () => null }));
vi.mock("@/components/glossary/record-read", () => ({ RecordTermRead: () => null }));
vi.mock("@/components/glossary/frame", () => ({ GlossaryFrame: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/actions", () => ({ logout: async () => {} }));
vi.mock("@/lib/auth/user", () => ({ requireUser: async () => ({ email: "a@example.com" }) }));

// 画面（<Term k=...>）と /glossary#key のリンクが使っている前からの key。変えると切れる
const EARLIER_KEYS = [
  "persona", "conversion", "kgi", "kpi", "impression", "awareness", "contentPillar", "hashtag", "toneAndManner", "roadmap", "proAccount", "facebookPage",
  "newsletter", "ownedAudience", "payPerUse", "buildInPublic", "storeListing", "shortLink", "correlation", "campaignLink", "dns", "cname", "subdomain",
];
const ADDED_KEYS = ["marketingFunnel", "tripleMedia", "ownedMedia", "earnedMedia", "paidMedia", "ugc", "organicVsAds", "seoVsSns", "snsTraits", "concept", "story", "milestone", "harm"];

describe("用語", () => {
  it("前からの key は残し、足した語もそろっている", () => {
    for (const k of [...EARLIER_KEYS, ...ADDED_KEYS]) expect(isGlossaryKey(k), k).toBe(true);
    expect(GLOSSARY_KEYS).toHaveLength(EARLIER_KEYS.length + ADDED_KEYS.length);
  });

  it("どの語も、分類のどれか 1 つにだけ入っている", () => {
    const placed = GLOSSARY_CATEGORIES.flatMap((c) => c.keys);
    expect([...placed].sort()).toEqual([...GLOSSARY_KEYS].sort());
    expect(new Set(GLOSSARY_CATEGORIES.map((c) => c.id)).size).toBe(GLOSSARY_CATEGORIES.length);
  });

  it("関連のリンク先は用語集にあり、自分自身や同じ語を 2 回は指さない", () => {
    for (const k of GLOSSARY_KEYS) {
      const related = (glossary[k] as GlossaryTerm).related ?? [];
      for (const r of related) expect(isGlossaryKey(r), `${k} → ${r}`).toBe(true);
      expect(related).not.toContain(k);
      expect(new Set(related).size).toBe(related.length);
    }
  });

  it("説明があり、表は見出しと同じ数の列がある", () => {
    for (const k of GLOSSARY_KEYS) {
      const t: GlossaryTerm = glossary[k];
      expect(t.summary.trim().length, k).toBeGreaterThan(10);
      for (const b of t.details ?? []) {
        if (b.kind === "table") for (const row of b.rows) expect(row, `${k}: ${row[0]}`).toHaveLength(b.head.length);
      }
    }
  });

  it("足した語には、オーナーが挙げた中身が入っている", () => {
    const text = (k: string) => JSON.stringify(glossary[k as keyof typeof glossary]);
    expect(text("marketingFunnel")).toMatch(/インプレッション[\s\S]*短縮リンクのクリック[\s\S]*成果/);
    expect(text("tripleMedia")).toMatch(/お店の例.*アプリの例/);
    expect(text("ugc")).toMatch(/許可/);
    expect(text("organicVsAds")).toMatch(/yabumi/);
    // 古くなる数字（利用者数など）は書かない
    expect(text("snsTraits")).not.toMatch(/万人|億人/);
    for (const sns of ["X", "Instagram", "Threads", "Facebook", "TikTok", "YouTube", "note"]) expect(text("snsTraits")).toContain(`["${sns}"`);
  });
});

describe("メニュー", () => {
  it("PC の上の帯の More の中に「Glossary 用語集」が出る", async () => {
    const { ProjectNavLinks } = await import("@/components/nav/project-nav-links");
    const html = renderToStaticMarkup(createElement(ProjectNavLinks, { projectId: "p1", variant: "bar" }));
    expect(html).toContain('href="/glossary"');
    expect(html).toMatch(/Glossary[\s\S]*用語集/);
  });

  it("プロジェクトの外のスマホのメニューにも出る", async () => {
    const { TopBarMenu } = await import("@/components/nav/top-bar-menu");
    expect(renderToStaticMarkup(createElement(TopBarMenu, { email: "a@example.com" }))).toContain('href="/glossary"');
  });
});

describe("詳細ページ（/glossary/<key>）", () => {
  it("静的な引数は全語ぶん。リンクは /glossary/<key>", async () => {
    const { generateStaticParams, dynamicParams } = await import("@/app/(app)/glossary/[key]/page");
    expect(generateStaticParams().map((p) => p.key).sort()).toEqual([...GLOSSARY_KEYS].sort());
    // 知らない key は 404
    expect(dynamicParams).toBe(false);
    expect(glossaryHref("ugc")).toBe("/glossary/ugc");
  });

  it("前と次は、同じ分類の中の並び。端は null", () => {
    for (const c of GLOSSARY_CATEGORIES) {
      c.keys.forEach((k, i) => {
        expect(neighbors(k)).toEqual({ prev: c.keys[i - 1] ?? null, next: c.keys[i + 1] ?? null });
      });
    }
    expect(neighbors("tripleMedia")).toEqual({ prev: null, next: "ownedMedia" });
  });
});

describe("図", () => {
  it("決めた語の図が描け、文字は画面の文字として入っている", async () => {
    const { GLOSSARY_DIAGRAMS } = await import("@/components/glossary/diagrams");
    for (const k of ["marketingFunnel", "tripleMedia", "organicVsAds", "seoVsSns", "snsTraits"] as const) expect(GLOSSARY_DIAGRAMS[k], k).toBeTruthy();
    const html = (k: keyof typeof GLOSSARY_DIAGRAMS) => renderToStaticMarkup(createElement(GLOSSARY_DIAGRAMS[k]!));
    expect(html("marketingFunnel")).toMatch(/知る[\s\S]*インプレッション[\s\S]*短縮リンクのクリック[\s\S]*続ける/);
    expect(html("tripleMedia")).toMatch(/オウンド[\s\S]*アーンド[\s\S]*ペイド/);
    expect(html("organicVsAds")).toMatch(/広告を出している間/);
    expect(html("seoVsSns")).toMatch(/探している人[\s\S]*タイムライン/);
    for (const label of ["X", "Instagram", "Threads", "Facebook", "TikTok", "YouTube", "note"]) expect(html("snsTraits")).toContain(label);
    // 色はトークンのクラスだけ（色コードを直接書かない）
    const src = readFileSync("src/components/glossary/diagrams.tsx", "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("挿絵", () => {
  it("全語の指示文があり、全語に public/glossary/<key>.webp（150KB 以下）がある", () => {
    const prompts = JSON.parse(readFileSync("scripts/glossary-illustrations.prompts.json", "utf8")) as { style: string; terms: Record<string, string> };
    expect(Object.keys(prompts.terms).sort()).toEqual([...GLOSSARY_KEYS].sort());
    // 文字・ロゴ・実在の人やブランドを入れない指示
    expect(prompts.style).toMatch(/no text/i);
    expect(prompts.style).toMatch(/no logos/i);
    for (const k of GLOSSARY_KEYS) {
      const file = `public${illustrationSrc(k)}`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThanOrEqual(150 * 1024);
    }
  });
});

describe("分類のページ（/glossary/c/<id>。4.49）", () => {
  it("静的な引数は全分類ぶん。知らない分類は 404", async () => {
    const { generateStaticParams, dynamicParams } = await import("@/app/(app)/glossary/c/[id]/page");
    expect(generateStaticParams().map((p) => p.id)).toEqual([...GLOSSARY_CATEGORY_IDS]);
    expect(dynamicParams).toBe(false);
    expect(categoryHref("media")).toBe("/glossary/c/media");
  });

  it("どの語も、どれかの分類のページに出る。入口のカードの代表の語は、その分類の語。分類の id は語の key と重ならない", () => {
    expect(GLOSSARY_CATEGORIES.map((c) => c.id)).toEqual([...GLOSSARY_CATEGORY_IDS]);
    const shown = new Set(GLOSSARY_CATEGORIES.flatMap((c) => c.keys));
    for (const k of GLOSSARY_KEYS) expect(shown.has(k), k).toBe(true);
    for (const c of GLOSSARY_CATEGORIES) {
      expect(c.keys).toContain(c.cover);
      expect(c.note.length).toBeGreaterThan(5);
      expect(isGlossaryKey(c.id)).toBe(false);
    }
  });

  it("前の 1 ページの用語集のリンク（# のあと）を、新しいページに移す", () => {
    expect(legacyGlossaryHashTarget("#ugc")).toBe("/glossary/ugc");
    expect(legacyGlossaryHashTarget("#marketingFunnel")).toBe("/glossary/marketingFunnel");
    expect(legacyGlossaryHashTarget("#cat-media")).toBe("/glossary/c/media");
    expect(legacyGlossaryHashTarget("#sns")).toBe("/glossary/c/sns");
    // 知らないもの・空・外への URL に見えるものは移さない
    for (const h of ["", "#", "#nope", "#cat-nope", "#//evil.example", "#https://evil.example"]) expect(legacyGlossaryHashTarget(h), h).toBeNull();
  });

  it("壊れた %（読めない）は、落ちずに移さない。読める % はほどいてから確かめる（セキュリティ確認 2026-11-06 の L5）", () => {
    for (const h of ["#%", "#%E3", "#%ZZ", "#ugc%", "#cat-%E3%81"]) expect(legacyGlossaryHashTarget(h), h).toBeNull();
    expect(legacyGlossaryHashTarget("#%75gc")).toBe("/glossary/ugc");
  });
});
