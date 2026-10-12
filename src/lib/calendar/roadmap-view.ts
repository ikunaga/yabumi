import type { PaceStatus } from "@/lib/coach/pace";
import { KPIS } from "@/lib/metrics/kpis";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { itemProgress, type DailyTotal } from "@/lib/roadmap/schema";
import { SNS } from "@/lib/sns";

// カレンダーに出すロードマップのやることの形と、画面に出す文（F06・F10。docs/architecture.md の 4.23）。サーバーと画面の両方から読む

// 画面に渡すやること（クライアントの部品にそのまま渡す）
export type CalendarTodo = {
  id: string;
  title: string;
  detail: string;
  weekStart: string;
  plannedOn: string | null;
  status: "todo" | "done" | "skipped";
  // 「Instagram 0 / 1」のような進み具合。自動で数えられない数字・数字のないやることは null
  progress: string | null;
  // やることから作った投稿（「投稿 送信済み 1・予約 1」）。なければ null
  linked: string | null;
  // 予定日を過ぎたのに、まだ投稿をつくっていない
  overdue: boolean;
};

export type WeekGoal = { sns: string; published: number; scheduled: number; target: number; status: PaceStatus };

export type WeekBand = { weekStart: string; todos: CalendarTodo[]; goals: WeekGoal[] };


function progressText(item: RoadmapItem, daily: DailyTotal[]): string | null {
  const p = itemProgress(item, daily);
  if (!p || !item.kpi) return null;
  const label = item.kpi === "posts" ? (item.sns ? SNS[item.sns].label : "すべての SNS") : KPIS[item.kpi].label;
  const scheduled = item.kpi === "posts" && item.posts?.scheduled ? `（予約 ${item.posts.scheduled}）` : "";
  return `${label} ${Math.round(p.actual * 10) / 10} / ${p.target}${scheduled}`;
}

function linkedText(item: RoadmapItem): string | null {
  const p = item.posts;
  if (!p || p.linkedPublished + p.linkedScheduled === 0) return null;
  const parts = [p.linkedPublished ? `送信済み ${p.linkedPublished}` : "", p.linkedScheduled ? `予約 ${p.linkedScheduled}` : ""].filter(Boolean);
  return `ここから作った投稿: ${parts.join("・")}`;
}

export function toCalendarTodo(item: RoadmapItem, daily: DailyTotal[], today: string): CalendarTodo {
  const linked = (item.posts?.linkedPublished ?? 0) + (item.posts?.linkedScheduled ?? 0);
  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    weekStart: item.weekStart,
    plannedOn: item.plannedOn,
    status: item.status,
    progress: progressText(item, daily),
    linked: linkedText(item),
    overdue: item.status === "todo" && item.plannedOn !== null && item.plannedOn < today && linked === 0,
  };
}

