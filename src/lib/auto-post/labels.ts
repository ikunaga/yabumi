import type { AutoKind, AutoRunReason, AutoRunStatus, AutoStopReason, TargetMode } from "./types";

// 自動の投稿の画面の言葉（画面の担当はここを使う。用語をそろえるため）

export const KIND_LABELS: Record<AutoKind, string> = {
  series: "シリーズ",
  product: "商品・サービスの紹介",
  notes: "ネタ帳のメモから",
  pillars: "柱ごとの定番",
  rerun: "伸びた投稿の言い直し",
  events: "お知らせ・季節",
  commits: "開発の進み",
};

export const TARGET_MODE_LABELS: Record<TargetMode, string> = {
  auto: "自動で送る",
  review: "確かめて送る",
  by_hand: "手で投稿",
};

export const RUN_STATUS_LABELS: Record<AutoRunStatus, string> = {
  waiting: "作る前",
  generating: "作っています",
  scheduled: "予約",
  review: "確かめ待ち",
  held: "下書きに回した",
  skipped: "飛ばした",
  canceled: "止めた",
};

export const RUN_REASON_TEXT: Record<AutoRunReason, string> = {
  no_material: "使える材料がありませんでした",
  cannot_write: "材料だけでは書けませんでした",
  check_failed: "送る前の確かめで引っかかりました",
  similar: "前の投稿と似ています",
  made_up: "事実か確かめたいところがあります",
  avoid: "アカウント設計の「やらないこと」に当たります",
  too_long: "字数の上限を超えました",
  ai_limit: "AI の今月の枠を使い切りました",
  daily_limit: "今日の自動の投稿の上限に届きました",
  disconnected: "SNS のつながりが切れています",
  error: "うまく作れませんでした",
  user_skipped: "飛ばしました",
  plan_paused: "止めました",
};

export const STOP_REASON_TEXT: Record<AutoStopReason, string> = {
  fail_streak: "2 回続けて送れませんでした",
  disconnected: "SNS のつながりが切れています",
  materials_out: "材料を使い切りました",
  operator: "運営者が止めました",
};
