// やることの種類と、押したときの行き先（src/lib/roadmap/todo-kind.ts。docs/architecture.md の 4.42）
import { describe, expect, it } from "vitest";
import { inferTodoKind, todoAction, todoKindOf } from "@/lib/roadmap/todo-kind";

const base = "/projects/p1";
const item = (title: string, kind: ReturnType<typeof inferTodoKind>, detail = "") => ({ id: "i1", title, detail, kind, weekStart: "2026-11-02" });

describe("種類を推す（種類のない前のやること）", () => {
  it("投稿した回数を追うものは投稿", () => {
    expect(inferTodoKind({ kpi: "posts", title: "週の振り返りも兼ねて 1 本" })).toBe("post");
  });

  it("振り返り・数字を見るものは振り返り（投稿という言葉があっても）", () => {
    expect(inferTodoKind({ title: "4週間の振り返り", detail: "投稿の回数とストアへのクリックを見る" })).toBe("review");
    expect(inferTodoKind({ title: "先週の数字を見る" })).toBe("review");
    expect(inferTodoKind({ title: "反応を見直す" })).toBe("review");
  });

  it("行き先の画面が決まる設定は設定。見直しでも設定の画面が決まればそちら", () => {
    expect(inferTodoKind({ title: "プロフィールを整える" })).toBe("setup");
    expect(inferTodoKind({ title: "App Store のデータをつなぐ" })).toBe("setup");
    // ストアの側でするやること（yabumi の画面では進まない）は設定にしない
    expect(inferTodoKind({ title: "ストアのページを直す" })).toBe("other");
    expect(inferTodoKind({ title: "ハッシュタグを見直す" })).toBe("setup");
    expect(inferTodoKind({ title: "Threads をつなぐ" })).toBe("setup");
    expect(inferTodoKind({ title: "SNS をつなぐ" })).toBe("setup");
  });

  it("投稿の言葉があれば投稿、どれでもなければ other", () => {
    expect(inferTodoKind({ title: "新メニューの写真を載せる" })).toBe("post");
    expect(inferTodoKind({ title: "顧客の声を集める" })).toBe("other");
  });

  it("保存した種類があればそれを使う。決まった値のほかは推す", () => {
    expect(todoKindOf({ title: "顧客の声を集める", kind: "setup" })).toBe("setup");
    expect(todoKindOf({ title: "先週の数字を見る", kind: "publish" })).toBe("review");
    expect(todoKindOf({ title: "先週の数字を見る", kind: null })).toBe("review");
  });
});

describe("押したときの行き先", () => {
  it("投稿は投稿をつくる（やることに結びつける）", () => {
    expect(todoAction(base, item("1 本書く", "post"), { aiEnabled: true })).toEqual({ kind: "post", href: "/projects/p1/compose?item=i1", label: "投稿をつくる" });
  });

  it("振り返りは AI と振り返る。AI が使えなければ分析（4 週・1 か月なら 30 日）", () => {
    expect(todoAction(base, item("4週間の振り返り", "review"), { aiEnabled: true })).toEqual({ kind: "review", href: "/projects/p1/consult/new?start=review&item=i1", label: "AI と振り返る" });
    expect(todoAction(base, item("4週間の振り返り", "review"), { aiEnabled: false }).href).toBe("/projects/p1/metrics?days=30");
    expect(todoAction(base, item("先週の数字を見る", "review"), { aiEnabled: false })).toEqual({ kind: "review", href: "/projects/p1/metrics", label: "分析を見る" });
  });

  it("設定は中身に合う画面。決まらなければロードマップのその行", () => {
    expect(todoAction(base, item("プロフィールを整える", "setup"), { aiEnabled: true })).toEqual({ kind: "setup", href: "/projects/p1/plan?open=profile#plan-profile-head", label: "プロフィールの案を見る" });
    expect(todoAction(base, item("App Store をつなぐ", "setup"), { aiEnabled: true }).href).toBe("/projects/p1/stores");
    expect(todoAction(base, item("短縮リンクを作る", "setup"), { aiEnabled: true }).href).toBe("/projects/p1/links");
    expect(todoAction(base, item("SNS をつなぐ", "setup"), { aiEnabled: true }).href).toBe("/projects/p1/edit#sns");
    expect(todoAction(base, item("顧客の声を集める", "setup"), { aiEnabled: true })).toEqual({ kind: "other", href: "/projects/p1/roadmap#item-i1", label: "ロードマップで見る" });
  });

  // 2026-11-12 PMO の本番での通しテスト: 「Instagram のプロフィールに置く」の横の「プロフィールを開く」が、Instagram が開くと読めた
  it("プロフィールに置くリンクのやることは、設計の「名前とプロフィール」の「置くリンクを見る」。SNS が開くと読める名前にしない", () => {
    const a = todoAction(base, item("ddy の App Store ページの短縮リンクを、Instagram のプロフィールに置く", "setup"), { aiEnabled: true });
    expect(a).toEqual({ kind: "setup", href: "/projects/p1/plan?open=profile#plan-profile-head", label: "置くリンクを見る" });
    expect(todoAction(base, item("自己紹介に予約ページの URL を入れる", "setup"), { aiEnabled: true }).label).toBe("置くリンクを見る");
    // プロフィールでない短縮リンクのやることは、短縮リンクの画面のまま
    expect(todoAction(base, item("短縮リンクを作る", "setup"), { aiEnabled: true }).label).toBe("短縮リンクを開く");
    for (const t of ["プロフィールを整える", "Instagram のプロフィールに置く", "アイコンを変える"]) {
      expect(todoAction(base, item(t, "setup"), { aiEnabled: true }).label).not.toMatch(/Instagram|X|Threads|を開く$/);
    }
  });

  // 2026-11-12 PMO の本番での通しテスト: 「ストアを開く」「GitHub を開く」は App Store・GitHub が開くと読め、押してもすることにつながらなかった
  it("ストア・GitHub は、つなぐやることだけ yabumi のつなぐ画面（「ストアをつなぐ」「GitHub をつなぐ」）。ストア・GitHub の側でするやることは行き先を作らない", () => {
    expect(todoAction(base, item("App Store の数字を yabumi に取り込む", "setup"), { aiEnabled: true })).toEqual({ kind: "setup", href: "/projects/p1/stores", label: "ストアをつなぐ" });
    expect(todoAction(base, item("RevenueCat をつないで課金を見る", "setup"), { aiEnabled: true }).label).toBe("ストアをつなぐ");
    expect(todoAction(base, item("GitHub のリポジトリをつなぐ", "setup"), { aiEnabled: true })).toEqual({ kind: "setup", href: "/projects/p1/github", label: "GitHub をつなぐ" });
    for (const t of ["App Store のスクリーンショットを差し替える", "ストアのページを直す", "Google Play の説明を直す", "GitHub のリポジトリの README を整える"]) {
      expect(todoAction(base, item(t, "setup"), { aiEnabled: true })).toEqual({ kind: "other", href: "/projects/p1/roadmap#item-i1", label: "ロードマップで見る" });
    }
  });

  it("ほかはロードマップのその行（済みにする・やらないができる所）", () => {
    expect(todoAction(base, item("顧客の声を集める", "other"), { aiEnabled: true }).href).toBe("/projects/p1/roadmap#item-i1");
  });
});
