import { projectSettingsHref } from "@/lib/projects/paths";

// やることの種類と、押したときの行き先（docs/architecture.md の 4.42）。
// 2026-11-03 まで、やることはどれも「投稿をつくる」に移っていた（振り返り・プロフィールを整えるなど、投稿しないやることでも。オーナーの指摘）

export const TODO_KINDS = ["post", "review", "setup", "other"] as const;
export type TodoKind = (typeof TODO_KINDS)[number];

export function isTodoKind(v: unknown): v is TodoKind {
  return typeof v === "string" && (TODO_KINDS as readonly string[]).includes(v);
}

type TodoText = { kpi?: string | null; title: string; detail?: string | null };

// 設定・準備のやることの行き先（題名と説明の言葉から決める）。決まらなければ null
type SetupTarget = { path: (base: string, projectId: string) => string; label: string };
const SETUP_TARGETS: { re: RegExp; target: SetupTarget }[] = [
  { re: /プロフィール|自己紹介|アイコン|表示名|ユーザー名|ハンドル/, target: { path: (b) => `${b}/plan?open=profile#plan-profile-head`, label: "プロフィールを開く" } },
  { re: /短縮リンク/, target: { path: (b) => `${b}/links`, label: "短縮リンクを開く" } },
  { re: /ハッシュタグ/, target: { path: (b) => `${b}/plan?open=hashtags#plan-hashtags-head`, label: "設計を開く" } },
  { re: /投稿の柱|口調/, target: { path: (b) => `${b}/plan?open=pillars#plan-pillars-head`, label: "設計を開く" } },
  { re: /ストア|App Store|Google Play|アプリの紹介/i, target: { path: (b) => `${b}/stores`, label: "ストアを開く" } },
  { re: /GitHub|リポジトリ/i, target: { path: (b) => `${b}/github`, label: "GitHub を開く" } },
  { re: /行き先/, target: { path: (_, id) => `${projectSettingsHref(id)}#destinations`, label: "設定を開く" } },
  { re: /(?:SNS|アカウント|X|Threads|Instagram|Facebook|TikTok|YouTube)\s*を?\s*(?:つな|連携)|つなぎ直/i, target: { path: (_, id) => projectSettingsHref(id, "sns"), label: "SNS をつなぐ" } },
];

function setupTarget(text: string): SetupTarget | null {
  return SETUP_TARGETS.find((s) => s.re.test(text))?.target ?? null;
}

const REVIEW = /振り返|数字を見|数字を確か|分析/;
const RECHECK = /見直/;
const POST = /投稿|ポスト|リール|ストーリーズ|ショート|動画|書く|書いて|載せ|発信/;

// 種類のないやること（2026-11-03 より前に作ったもの・手で足したもの）は、数字と題名・説明から推す。
// 投稿した回数を追うものは投稿、振り返り・数字を見るものは振り返り、行き先の画面が決まる設定は設定。推せなければ other
export function inferTodoKind(item: TodoText): TodoKind {
  if (item.kpi === "posts") return "post";
  const text = `${item.title}\n${item.detail ?? ""}`;
  if (REVIEW.test(text)) return "review";
  if (setupTarget(text)) return "setup";
  if (RECHECK.test(text)) return "review";
  if (POST.test(text)) return "post";
  return "other";
}

// 保存した種類（AI が付けたもの）があればそれ、なければ推す
export function todoKindOf(item: TodoText & { kind?: string | null }): TodoKind {
  return isTodoKind(item.kind) ? item.kind : inferTodoKind(item);
}

export type TodoAction = { href: string; label: string; kind: TodoKind };

// 押したときの行き先とボタンの名前。base: /projects/<id>
export function todoAction(
  base: string,
  item: TodoText & { id: string; kind: TodoKind; weekStart: string },
  { aiEnabled }: { aiEnabled: boolean },
): TodoAction {
  const text = `${item.title}\n${item.detail ?? ""}`;
  switch (item.kind) {
    case "post":
      return { kind: "post", href: `${base}/compose?item=${item.id}`, label: "投稿をつくる" };
    case "review":
      // 分析の期間は 7 日と 30 日。4 週・1 か月の振り返りなら 30 日
      return aiEnabled
        ? { kind: "review", href: `${base}/consult/new?start=review`, label: "AI と振り返る" }
        : { kind: "review", href: `${base}/metrics${/[4４]\s*週|1\s*か月|ひと月|1\s*ヶ月|月の/.test(text) ? "?days=30" : ""}`, label: "分析を見る" };
    case "setup": {
      const t = setupTarget(text);
      if (t) return { kind: "setup", href: t.path(base, base.split("/")[2]), label: t.label };
      break;
    }
  }
  return { kind: "other", href: `${base}/roadmap#item-${item.id}`, label: "ロードマップで見る" };
}
