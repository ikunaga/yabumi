// 自動の投稿の「何を」「どのくらい」の案（docs/design/auto-post.md の 2.6）。AI を呼ばず、決まりで決める（費用 0）。
// DB には触れない。材料の件数・送り先・時間帯の傾向・設計の頻度の文は、呼ぶ側（core の queries）から受け取る
import { SNS, type SnsKey } from "@/lib/sns";
import { BAND_INFO, type TimeTrends } from "@/lib/metrics/time-bands";
import { timeHintOf } from "@/lib/metrics/time-hint";
import { todayJst } from "@/lib/legal/version";
import type { AutoKind, AutoSchedule } from "./types";

// 材料の件数（いま使えるもの）
export type SuggestMaterials = {
  unusedNotes: number; // ネタ帳の使っていないメモ
  unusedPhotoNotes: number; // そのうち写真つき
  seriesFormats: number; // AI が埋める空欄があるシリーズのフォーマット
  destinations: number; // 行き先の URL
};

export type KindSuggestion = { kind: Extract<AutoKind, "notes" | "series" | "product" | "pillars">; reason: string };

export type ScheduleSuggestion = {
  perWeek: number; // 7 は毎日
  label: string; // 「毎日」「週 3」
  schedule: AutoSchedule;
  reason: string; // 回数の理由 1 行
  timeReason: string; // 時刻の理由 1 行
  timeSource: "trend" | "default"; // default のときは画面の「?」に「あなたの数字がたまったら変わります」
  fromPlan: boolean; // 設計の頻度に合わせた案
};

// ===== 何を =====

// 使っていないメモが 6 件以上ならネタ帳から（2.6）
export const NOTES_ENOUGH = 6;

// おすすめは 4 つ（ネタ帳・シリーズ・商品の紹介・柱）から。お知らせ・季節はカードだけで、おすすめには出さない
export function suggestKind(m: SuggestMaterials): KindSuggestion {
  if (m.unusedNotes >= NOTES_ENOUGH) {
    const photo = m.unusedPhotoNotes > 0 ? `。写真つきは ${m.unusedPhotoNotes} 件` : "";
    return { kind: "notes", reason: `使っていないメモが ${m.unusedNotes} 件${photo}` };
  }
  if (m.seriesFormats > 0) return { kind: "series", reason: `シリーズのフォーマットが ${m.seriesFormats} つあります。毎回、前と重ならない投稿を作ります` };
  if (m.destinations > 0) return { kind: "product", reason: `行き先が ${m.destinations} 件あります。行き先と切り口を順に変えて紹介します` };
  return { kind: "pillars", reason: "アカウントの方針の投稿のテーマを順に使って、定番の投稿を作ります" };
}

// ===== どのくらい: 回数 =====

// 設計の頻度の文から、週に何回かを読む（2.6 の補足）。「毎日」「週 n」（週に n 回・週n回）が 1 通りに読めるときだけ。
// 読めない・食い違う（「X は毎日、Instagram は週 2」）ときは null。AI は呼ばない
export function parseFrequency(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = text.normalize("NFKC");
  const found = new Set<number>();
  if (/毎日|1\s*日\s*1\s*回|一日一回/.test(s)) found.add(7);
  const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };
  for (const m of s.matchAll(/週\s*に?\s*([1-7一二三四五六七])(?![0-9])\s*(?:回|本|度)?/g)) {
    // 「週 2〜3」のような幅は、読めないものとして扱う
    const after = s.slice((m.index ?? 0) + m[0].length);
    if (/^\s*[〜~\-ー－]/.test(after)) return null;
    found.add(KANJI[m[1]] ?? Number(m[1]));
  }
  return found.size === 1 ? [...found][0] : null;
}

// 回数ごとの曜日（types.ts の AutoSchedule と同じ ISO: 1 = 月〜7 = 日）。週 2 は火・金（設計の見取り図の例）
const WEEKDAYS: Record<number, number[]> = {
  1: [3],
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};

// 回数の案の並び（2.6）。2 週間以上続けられるうちで多いほうを先にする
const PER_WEEK_OPTIONS = [7, 3, 2] as const;
export const KEEP_WEEKS = 2;

export function perWeekLabel(n: number): string {
  return n >= 7 ? "毎日" : `週 ${n}`;
}

// 1 回で 1 つ使い切る材料の残り。シリーズ・商品の紹介・柱は回ごとに作るので、使い切らない（null）
function remainingOf(kind: AutoKind, m: SuggestMaterials): number | null {
  return kind === "notes" ? m.unusedNotes : null;
}

// ===== どのくらい: 時刻 =====

// 数字がないときの SNS ごとの時刻（2.6。推測: 一般的な傾向）
const DEFAULT_TIMES: Partial<Record<SnsKey, string[]>> = {
  threads: ["12:00", "19:00"],
  x: ["12:00", "19:00"],
  instagram: ["19:00"],
  facebook: ["12:00"],
};

// 数字があれば BAND_INFO.at（投稿をつくるの「この時間帯に入れる」とそろえる）。なければ送り先の初期値で多いもの（同じ数なら 19:00）
export function suggestTime(targets: SnsKey[], trends: TimeTrends | null): { time: string; reason: string; source: "trend" | "default" } {
  const hint = trends ? timeHintOf(trends) : null;
  if (hint) {
    const b = BAND_INFO[hint.band];
    return { time: b.at, reason: `これまでの投稿は${b.label}（${b.hours}）に${hint.kind === "views" ? "よく見られて" : "よくクリックされて"}います`, source: "trend" };
  }
  const count = new Map<string, number>();
  for (const sns of targets) for (const t of DEFAULT_TIMES[sns] ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  const time = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? "19:00";
  const names = targets.filter((s) => DEFAULT_TIMES[s]?.includes(time)).map((s) => SNS[s].label);
  const reason = names.length > 0 ? `${names.join("・")}でよく見られる時間帯の目安です` : "よく見られる時間帯の目安です";
  return { time, reason, source: "default" };
}

// ===== どのくらい: 3 案 =====

export type ScheduleInput = {
  kind: AutoKind;
  materials: SuggestMaterials;
  targets: SnsKey[];
  trends: TimeTrends | null;
  planFrequency: string | null; // 設計の cadence.frequency（自由な文）
  start?: string; // 数え始めの日（YYYY-MM-DD）。省略は日本時間の今日
  // 伸びた投稿から始めたとき（docs/design/winning-posts.md の 4.2）。1 つの型は週 1〜2 回にし、時刻は伸びた投稿を送った時間帯を先にする
  fromWinner?: { time: string; reason: string };
};

// 伸びた投稿から始めたときの回数の並び（毎日だと似てくる。推測）
const WINNER_PER_WEEK = [2, 1] as const;

export function suggestSchedules(input: ScheduleInput): ScheduleSuggestion[] {
  const remaining = remainingOf(input.kind, input.materials);
  const time = input.fromWinner ? { ...input.fromWinner, source: "trend" as const } : suggestTime(input.targets, input.trends);
  const fromPlan = input.fromWinner ? null : parseFrequency(input.planFrequency);
  const start = input.start ?? todayJst();

  const lasts = (n: number) => remaining === null || remaining >= n * KEEP_WEEKS;
  // 2 週間以上続けられる回数のうち多いほう。どれも足りなければ、いちばん少ない週 2
  const best = PER_WEEK_OPTIONS.find(lasts) ?? PER_WEEK_OPTIONS[PER_WEEK_OPTIONS.length - 1];
  const order: number[] = input.fromWinner ? [...WINNER_PER_WEEK] : [];
  if (fromPlan !== null) order.push(fromPlan);
  order.push(best);
  // 残りの案も、続けられるものを先に
  for (const n of [...PER_WEEK_OPTIONS].sort((a, b) => Number(lasts(b)) - Number(lasts(a)))) order.push(n);
  const picked = [...new Set(order)].slice(0, 3);

  return picked.map((n) => {
    const plan = n === fromPlan;
    let reason: string;
    if (remaining !== null) {
      const weeks = Math.floor(remaining / n);
      reason =
        weeks >= 1
          ? `メモが ${remaining} 件あるので ${weeks} 週間続けられます`
          : `メモが ${remaining} 件なので、1 週間もたずに使い切ります`;
      if (plan) reason = `アカウントの方針の頻度、${perWeekLabel(n)} に合わせました。${reason}`;
    } else {
      reason = plan
        ? `アカウントの方針の頻度、${perWeekLabel(n)} に合わせました`
        : input.fromWinner && n <= 2
          ? "同じ型を出しすぎると似てくるので、少なめにします"
          : n >= 7 ? "毎日出して、見てもらう回数を増やします" : `無理なく続けられる回数です`;
    }
    return {
      perWeek: n,
      label: perWeekLabel(n),
      schedule: { weekdays: WEEKDAYS[n], time: time.time, every_weeks: 1, start },
      reason,
      timeReason: time.reason,
      timeSource: time.source,
      fromPlan: plan,
    };
  });
}
