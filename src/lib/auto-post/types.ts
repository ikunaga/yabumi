import type { SnsKey } from "@/lib/sns";

// 自動の投稿の型（docs/design/auto-post.md の 2.2。DB は 20261116100000_auto_post）。
// 画面（実装担当3）・入口と案（実装担当1）・ジョブ（実装担当2）の境目。使い方は src/lib/auto-post/README.md

// 使い道（2.1）。段階 A で選べるのは AUTO_KINDS_STAGE_A。rerun（伸びた投稿の言い直し）と commits（開発の進み）は段階 B
export type AutoKind = "series" | "product" | "notes" | "pillars" | "rerun" | "events" | "commits";
export const AUTO_KINDS: AutoKind[] = ["series", "product", "notes", "pillars", "events", "rerun", "commits"];
export const AUTO_KINDS_STAGE_A: AutoKind[] = ["series", "product", "notes", "pillars", "events"];

// SNS ごとの送り方。auto: 自動で送る / review: 確かめて送る（中身を見て承認したものだけ送る） / by_hand: 手で投稿（下書きに置く）
export type TargetMode = "auto" | "review" | "by_hand";

// SNS ごとに選べる送り方（4.1 の規約の調査。DB の save_auto_plan と同じ決まり）。先頭が初期値
export const TARGET_MODES: Record<SnsKey, TargetMode[]> = {
  threads: ["auto", "review"],
  instagram: ["auto", "review"],
  facebook: ["auto", "review"],
  x: ["review"],
  tiktok: ["review"],
  youtube: ["review"],
  note: ["by_hand"],
  substack: ["by_hand"],
};

// 段階 A で自動の投稿の送り先に選べる SNS（TikTok・YouTube は段階 C。docs/design/auto-post.md の 2.9）
export const AUTO_SNS_STAGE_A: SnsKey[] = ["threads", "facebook", "instagram", "x", "note", "substack"];

export type AutoTargets = Partial<Record<SnsKey, TargetMode>>;

// くり返しの規則。曜日は ISO（1 = 月〜7 = 日）、時刻は日本時間の HH:MM（15 分刻み）、every_weeks は 1〜4、start は数え始めの日（YYYY-MM-DD）
export type AutoSchedule = { weekdays: number[]; time: string; every_weeks: 1 | 2 | 3 | 4; start: string };

// 使い道ごとの材料の選び方。どれも省略できる（省略は「おまかせ」）
// - format_id: シリーズのフォーマット（series のとき必須）
// - destination_ids: 紹介する行き先（product。空ならすべてを順に）
// - note_order: ネタ帳のメモの選び方（notes。old_first: 古い順 / photo_first: 写真つきを先に）
// - skip_if_empty: お知らせ・季節で、予定がなければ季節のあいさつをせずに飛ばす（events）
export type AutoMaterials = {
  format_id?: string;
  destination_ids?: string[];
  note_order?: "old_first" | "photo_first";
  skip_if_empty?: boolean;
};

export type AutoPlanStatus = "active" | "paused" | "stopped";
// yabumi が止めた理由（status が stopped のとき）。画面の文は STOP_REASON_TEXT
export type AutoStopReason = "fail_streak" | "disconnected" | "materials_out" | "operator";

export type AutoPlan = {
  id: string;
  projectId: string;
  name: string;
  kind: AutoKind;
  materials: AutoMaterials;
  targets: AutoTargets;
  xLink: "never" | "always";
  schedule: AutoSchedule;
  tone: string;
  leadHours: number;
  firstReview: boolean;
  status: AutoPlanStatus;
  stopReason: AutoStopReason | null;
  failStreak: number;
  consentedAt: string;
  createdAt: string;
  updatedAt: string;
};

// 保存するときに画面が渡すもの（id は直すときだけ。consent は「AI が作った文を確かめずに送る」の同意のチェック。保存のたびに要る）
export type AutoPlanInput = {
  id?: string;
  name: string;
  kind: AutoKind;
  materials: AutoMaterials;
  targets: AutoTargets;
  xLink: "never" | "always";
  schedule: AutoSchedule;
  tone: string;
  leadHours: number;
  consent: boolean;
};

// 自動の回の状態（DB の auto_runs.status）
// waiting: 作る前 / generating: 作っている / scheduled: 予約にした（確かめて送る SNS は承認待ちのことがある） /
// review: 最初の回の確かめ待ち（A3） / held: 下書きに回した / skipped: 飛ばした / canceled: 利用者が止めた・飛ばした
export type AutoRunStatus = "waiting" | "generating" | "scheduled" | "review" | "held" | "skipped" | "canceled";

export type AutoRunReason =
  | "no_material"
  | "cannot_write"
  | "check_failed"
  | "similar"
  | "made_up"
  | "avoid"
  | "too_long"
  | "ai_limit"
  | "daily_limit"
  | "disconnected"
  | "error"
  | "user_skipped"
  | "plan_paused";

export type AutoRun = {
  id: string;
  planId: string;
  dueAt: string;
  generateAt: string;
  status: AutoRunStatus;
  postId: string | null;
  reason: AutoRunReason | null;
  reasonDetail: string | null;
};

// 確かめる画面に出す、配信先ごとの送る中身（DB の auto_target_previews）。fingerprint は承認のときにそのまま返す
export type AutoTargetPreview = {
  targetId: string;
  sns: SnsKey;
  status: string;
  title: string | null;
  body: string;
  fingerprint: string;
  approvedAt: string | null;
};

// 確かめ待ち（一覧の上の「確かめ待ち n 件」と確かめる画面）。kind:
// - first_review: 最初の回の確かめ（A3）。reviewAutoRun で、送る（中の確かめ待ちの SNS もまとめて承認）か送らないかを決める
// - approval: 確かめて送る SNS（X など）の承認待ち。approveAutoTarget・declineAutoTarget で SNS ごとに決める
export type AutoReviewItem = {
  kind: "first_review" | "approval";
  runId: string;
  planId: string;
  planName: string;
  postId: string;
  dueAt: string;
  targets: AutoTargetPreview[];
};

// カレンダーと概要に出す、これからの自動の回（作る前の回は postId が null）
export type UpcomingAutoRun = {
  runId: string;
  planId: string;
  planName: string;
  dueAt: string;
  status: AutoRunStatus;
  postId: string | null;
  sns: SnsKey[];
};

// お知らせ・季節の予定
export type ProjectEvent = { id: string; onDate: string; body: string };

// 見本の 1 回（保存しない）。SNS ごとの文と、チェックで引っかかったところ
export type AutoSample = {
  texts: Partial<Record<SnsKey, string>>;
  materialLabel: string;
  issues: { kind: AutoRunReason; detail: string }[];
};

// アクションの結果。error は画面にそのまま出せる文
export type AutoResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
