// 利用規約・プライバシーポリシーの版を決める、ただ 1 つの場所（決定 D31。docs/legal.md の「施行したあとの変え方」）。持ち主は実装担当2。
// 版の正は LEGAL_VERSIONS だけ。②の変更をするときに人が書き換えるのは、ここに 1 件足すことだけ。施行日（version）を過ぎると、
// 今の版（currentLegalVersion）・ページの施行日（effectiveDateLabel）・変更のお知らせの終わりが自動で切り替わる。
// 新しい本文に入れ替えるデプロイは、施行日にする。施行日を 2 か所に書かない

export type LegalDoc = "terms" | "privacy";

export type LegalRevision = {
  // 施行日（日本時間の日付、ISO の形 "YYYY-MM-DD"）。これが版の名前（同意の記録もこの値で持つ）
  version: string;
  // 変わる（変わった）文書
  docs: LegalDoc[];
  // 変わる点の要約（1 行ずつ。お知らせ・帯・メール・改定の履歴に出す）
  summary: string[];
  // 利用者に不利な変更か（料金・責任・機能を外すなど。知らせる期間が 30 日以上になる。不利でなければ 14 日以上）
  adverse: boolean;
  // 知らせ始める日（ISO）。最初の制定は null
  noticeFrom: string | null;
};

// 施行日の古い順。最初の 1 件は制定（2026-10-12）。施行日が先の行は「予定の変更」（upcomingLegalChange）
export const LEGAL_VERSIONS: readonly LegalRevision[] = [
  { version: "2026-10-12", docs: ["terms", "privacy"], summary: ["制定"], adverse: false, noticeFrom: null },
];

// 知らせる期間（日）。利用者に不利でない変更は 14 日以上、不利な変更は 30 日以上（2026-10-12 オーナーの決定）
export const NOTICE_DAYS = { normal: 14, adverse: 30 } as const;

// 日本時間の今日（ISO "YYYY-MM-DD"）
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// 施行日が今日（日本時間）以前の版のうち、最新のもの
export function currentRevision(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision {
  const today = todayJst(now);
  const past = history.filter((r) => r.version <= today);
  return past.at(-1) ?? history[0];
}

// 今の版の名前（施行日の ISO）。同意の記録と再同意の比較は、これだけを使う
export function currentLegalVersion(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): string {
  return currentRevision(now, history).version;
}

// 施行日が今日より後の変更（いちばん近いもの）。なければ null。知らせ始める日の前でも返す（出すかどうかは noticeStarted で決める）
export function upcomingLegalChange(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision | null {
  const today = todayJst(now);
  return history.find((r) => r.version > today) ?? null;
}

// 知らせ始める日を過ぎているか（ページのお知らせ・帯・メールは、この日から出す）
export function noticeStarted(change: LegalRevision, now: Date = new Date()): boolean {
  return change.noticeFrom !== null && change.noticeFrom <= todayJst(now);
}

// 施行済みの版（改定の履歴。古い順）
export function publishedHistory(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision[] {
  const today = todayJst(now);
  return history.filter((r) => r.version <= today);
}

// "2026-10-12" → "2026年10月12日"
export function formatLegalDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

// ページなどに出す、今の版の施行日
export function effectiveDateLabel(now: Date = new Date()): string {
  return formatLegalDate(currentLegalVersion(now));
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

// 版の一覧の決まりを確かめる（テストで使う）。問題があれば、その説明を返す
export function historyProblems(history: readonly LegalRevision[] = LEGAL_VERSIONS): string[] {
  const problems: string[] = [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  history.forEach((r, i) => {
    if (!iso.test(r.version)) problems.push(`${r.version}: 施行日は YYYY-MM-DD で書く`);
    if (i > 0 && r.version <= history[i - 1].version) problems.push(`${r.version}: 施行日の古い順に並べる`);
    if (!r.summary.length || !r.docs.length) problems.push(`${r.version}: 要約と、変わる文書を書く`);
    if (i === 0) return;
    if (!r.noticeFrom || !iso.test(r.noticeFrom)) {
      problems.push(`${r.version}: 知らせ始める日（noticeFrom）を書く`);
      return;
    }
    const need = r.adverse ? NOTICE_DAYS.adverse : NOTICE_DAYS.normal;
    if (daysBetween(r.noticeFrom, r.version) < need) problems.push(`${r.version}: 知らせ始める日から施行日まで ${need} 日以上あける（${r.adverse ? "不利な変更" : "不利でない変更"}）`);
  });
  return problems;
}

// ログイン後の帯に出す変更。予定の変更があり、知らせ始める日を過ぎていて、その版の帯をまだ閉じていない（seenVersion と違う）ときだけ。
// 施行日を過ぎると予定の変更でなくなるので、出さない
export function legalBannerChange(now: Date, seenVersion: string | undefined, history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision | null {
  const change = upcomingLegalChange(now, history);
  if (!change || !noticeStarted(change, now) || seenVersion === change.version) return null;
  return change;
}
