import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { PlanData, ProfileOverrideField } from "./schema";

// 名前とプロフィールを SNS ごとに変える（要求 F15、決定 D26。docs/architecture.md の 4.8）。
// 共通（profile の displayName など）を土台にし、bySns に入っている項目だけ上書きする。
// 画面からも読むので、サーバー専用のものを import しない

type Profile = PlanData["profile"];

// SNS ごとのプロフィールの決まり（各社の公式のヘルプ、2026-10-12 に確認。出典と、公式で確かめられなかった値は architecture.md の 4.8）。
// 決まりは変わることがあるので、合わないときは保存を止めずに画面で知らせるだけにする
export type ProfileRule = {
  // ユーザー名。null は矢書では確かめない
  handle: {
    min: number;
    max: number;
    pattern: RegExp;
    chars: string;
    // 文字の種類のほかの決まり（合わなければ理由を返す）
    extra?: (h: string) => string | null;
    // 変えるときの注意
    note?: string;
  } | null;
  displayNameMax: number | null;
  bioMax: number | null;
  // リンク先の置き場所の説明
  linkNote: string;
};

const noSymbolAtEnds = (h: string) => (/^[._\-·]|[._\-·]$/u.test(h) ? "記号（. _ - ·）は最初と最後に使えません" : null);

export const PROFILE_RULES: Record<SnsKey, ProfileRule> = {
  x: {
    handle: {
      min: 4,
      max: 15,
      pattern: /^[A-Za-z0-9_]+$/,
      chars: "半角の英字・数字・_（アンダースコア）",
      extra: (h) => (/admin|twitter/i.test(h) ? "「Admin」や「Twitter」を含む名前は使えません" : null),
      note: "いつでも変えられます（認証済みのマークは、変えると確認し直しになります）",
    },
    displayNameMax: 50,
    bioMax: 160,
    linkNote: "プロフィールの「ウェブサイト」に 1 つ",
  },
  instagram: {
    handle: { min: 1, max: 30, pattern: /^[A-Za-z0-9._]+$/, chars: "半角の英字・数字・.（ピリオド）・_", note: "変えてから 14 日は、前のユーザーネームに戻せます" },
    displayNameMax: null,
    bioMax: 150,
    linkNote: "プロフィールのリンクに 5 つまで",
  },
  threads: {
    handle: {
      min: 1,
      max: 30,
      pattern: /^[A-Za-z0-9._]+$/,
      chars: "半角の英字・数字・.・_",
      note: "Instagram とつないだ Threads は、Instagram と同じユーザー名になります。Instagram から切り離した Threads と、Instagram なしで作った Threads だけ、別の名前にできます",
    },
    displayNameMax: null,
    bioMax: 150,
    linkNote: "プロフィールのリンクに 5 つまで（自己紹介文とリンクは Instagram と別に決められます）",
  },
  facebook: {
    handle: { min: 5, max: 50, pattern: /^[A-Za-z0-9.]+$/, chars: "半角の英字・数字・.（ピリオド）", note: "Facebook ページを作る場合だけ。ピリオドと大文字・小文字の違いは、同じ名前として扱われます" },
    displayNameMax: null,
    bioMax: null,
    linkNote: "ページの「ウェブサイト」",
  },
  tiktok: {
    handle: {
      min: 2,
      max: 24,
      pattern: /^[A-Za-z0-9._]+$/,
      chars: "半角の英字・数字・.・_",
      extra: (h) => (h.endsWith(".") ? "最後にピリオドは使えません" : null),
      note: "ユーザー名は 30 日に 1 回、表示名は 7 日に 1 回だけ変えられます",
    },
    displayNameMax: 30,
    bioMax: 80,
    linkNote: "プロフィールのウェブサイトに 1 つ（ビジネスアカウントか、フォロワー 1,000 人以上の個人アカウントだけ）",
  },
  youtube: {
    handle: {
      min: 3,
      max: 30,
      pattern: /^[\p{L}\p{N}._\-·]+$/u,
      chars: "英字・数字（日本語の文字も可）・. _ - ·",
      extra: noSymbolAtEnds,
      note: "ハンドルとチャンネル名は、それぞれ 14 日に 2 回まで変えられます",
    },
    displayNameMax: null,
    bioMax: 1000,
    linkNote: "チャンネルの「リンク」に 14 個まで（1 つ目が登録ボタンの横に出ます）",
  },
  note: {
    handle: { min: 3, max: 16, pattern: /^[a-z0-9_]+$/, chars: "半角の小文字の英字・数字・_", note: "note ID を変えると、記事の URL もすべて変わり、前のリンクが切れます" },
    displayNameMax: 50,
    bioMax: 140,
    linkNote: "プロフィールの SNS の欄（X・Instagram など）と、自分のサイト",
  },
  substack: {
    handle: { min: 4, max: 32, pattern: /^[A-Za-z0-9]+$/, chars: "半角の英字・数字" },
    displayNameMax: null,
    bioMax: null,
    linkNote: "プロフィールのウェブサイトと SNS のリンク",
  },
};

const filled = (s: string | undefined | null): s is string => Boolean(s && s.trim());

export function normalizeHandle(h: string): string {
  return h.trim().replace(/^@/, "");
}

export type EffectiveProfile = { displayName: string; handle: string; bio: string; link: string; overridden: ProfileOverrideField[] };

// その SNS で実際に使う名前とプロフィール（上書きがなければ共通）
export function effectiveProfile(p: Profile, sns: SnsKey): EffectiveProfile {
  const o = p.bySns[sns];
  const overridden: ProfileOverrideField[] = [];
  const pick = (f: ProfileOverrideField, common: string) => {
    if (filled(o?.[f])) {
      overridden.push(f);
      return o[f].trim();
    }
    return common.trim();
  };
  const displayName = pick("displayName", p.displayName);
  const bio = pick("bio", p.bio);
  const link = pick("link", p.link);
  // Threads は、上書きがなければ Instagram と同じユーザー名（Instagram とつないだ Threads は同じになるため）
  const handle = sns === "threads" ? pick("handle", effectiveProfile(p, "instagram").handle) : pick("handle", p.handle);
  return { displayName, handle: normalizeHandle(handle), bio, link, overridden };
}

export function hasOverride(p: Profile, sns: SnsKey): boolean {
  return effectiveProfile(p, sns).overridden.length > 0;
}

// 文字数（絵文字などを 1 字と数える）
export function charCount(s: string): number {
  return [...s].length;
}

export type ProfileIssue = { field: ProfileOverrideField; message: string };

// その SNS の決まりに合わないところ（保存は止めず、画面で知らせる）
export function profileIssues(p: Profile, sns: SnsKey): ProfileIssue[] {
  const rule = PROFILE_RULES[sns];
  const e = effectiveProfile(p, sns);
  const label = SNS[sns].label;
  const issues: ProfileIssue[] = [];
  if (rule.handle && e.handle) {
    const n = charCount(e.handle);
    if (n > rule.handle.max) issues.push({ field: "handle", message: `${label} のユーザー名は ${rule.handle.max} 字までです（いまは ${n} 字）` });
    else if (n < rule.handle.min) issues.push({ field: "handle", message: `${label} のユーザー名は ${rule.handle.min} 字以上です（いまは ${n} 字）` });
    if (!rule.handle.pattern.test(e.handle)) issues.push({ field: "handle", message: `${label} のユーザー名に使えるのは ${rule.handle.chars} です` });
    else {
      const extra = rule.handle.extra?.(e.handle);
      if (extra) issues.push({ field: "handle", message: `${label} のユーザー名: ${extra}` });
    }
  }
  if (rule.displayNameMax && charCount(e.displayName) > rule.displayNameMax) {
    issues.push({ field: "displayName", message: `${label} の表示名は ${rule.displayNameMax} 字までです（いまは ${charCount(e.displayName)} 字）` });
  }
  if (rule.bioMax && charCount(e.bio) > rule.bioMax) {
    issues.push({ field: "bio", message: `${label} の自己紹介文は ${rule.bioMax} 字までです（いまは ${charCount(e.bio)} 字）` });
  }
  return issues;
}

// SNS ごとの欄を並べる SNS: 6 の「SNS ごとの役割」に書いた SNS、つないだ SNS、すでに上書きがある SNS（画面の順）。
// ほかは折りたたみに入れる
export function profileTargetSns(plan: Pick<PlanData, "profile" | "cadence">, connected: SnsKey[]): SnsKey[] {
  return SNS_KEYS.filter((s) => filled(plan.cadence.roles[s]) || connected.includes(s) || hasOverride(plan.profile, s));
}

export type HandleMismatch = { sns: SnsKey; planned: string; actual: string };

// つないだアカウントの実際のユーザー名と、設計のユーザー名が違う SNS
export function handleMismatches(p: Profile, accounts: { sns: SnsKey; handle: string }[]): HandleMismatch[] {
  const out: HandleMismatch[] = [];
  for (const a of accounts) {
    if (!PROFILE_RULES[a.sns].handle) continue;
    const actual = normalizeHandle(a.handle);
    if (!actual) continue;
    const planned = effectiveProfile(p, a.sns).handle;
    if (planned.toLowerCase() === actual.toLowerCase()) continue;
    if (out.some((m) => m.sns === a.sns)) continue;
    out.push({ sns: a.sns, planned, actual });
  }
  return out;
}
