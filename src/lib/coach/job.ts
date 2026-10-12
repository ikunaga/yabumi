import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sectionSchemas } from "@/lib/plan/schema";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";
import { ITEM_COLUMNS, loadItemPostCounts, overdueItems, toItem, type ItemRow } from "@/lib/roadmap/load";
import { countsByWeek, parseTargets } from "./load";
import { behindMessage, overdueMessage, unsubscribeHeaders, weeklyMessage, type MessageContext, type OverdueItem } from "./messages";
import { deliverCoachMessage, ensurePrefs, unsentOverdue, wants, type DeliverDeps, type DeliverResult, type Prefs } from "./notify";
import { computeWeekPace, cycleInfo, CYCLE_WEEKS, hasTargets, isoWeekday, mondayOf, shouldNudgeBehind, streakWeeks, type SnsCounts, type WeeklyTargets } from "./pace";

// 伴走の毎日のジョブ（4.27。pg_cron が日本時間 7:00 に /api/jobs/coach を呼ぶ）:
// 最初の 1 か月の週の回数を決めたプロジェクトごとに、① 今週と先週の結果を pace_weeks に書き（続けた週を数えるため）、
// ② 決めた曜日に遅れそうなら声をかけ、③ 月曜に先週の振り返りを送る。数は counted_post_targets（4.23 の 1 か所の数え方）
type Db = SupabaseClient<Database>;

export type CoachJobOutcome = { projectId: string; behind?: DeliverResult; weekly?: DeliverResult; overdue?: DeliverResult };

// 予定日を過ぎたやることを知らせるのは、予定日から 7 日まで（それより前のものは、初めて動いたときにまとめて送らないように）
const OVERDUE_DAYS = 7;

const PAGE = 1000;

async function allRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function publishedOf(c: SnsCounts | undefined): Partial<Record<SnsKey, number>> {
  const out: Partial<Record<SnsKey, number>> = {};
  for (const s of SNS_KEYS) if (c?.[s]?.published) out[s] = c[s]!.published;
  return out;
}

function scheduledOf(c: SnsCounts | undefined): Partial<Record<SnsKey, number>> {
  const out: Partial<Record<SnsKey, number>> = {};
  for (const s of SNS_KEYS) if (c?.[s]?.scheduled) out[s] = c[s]!.scheduled;
  return out;
}

function achieved(targets: WeeklyTargets, published: Partial<Record<SnsKey, number>>): boolean {
  const keys = SNS_KEYS.filter((s) => (targets[s] ?? 0) > 0);
  return keys.length > 0 && keys.every((s) => (published[s] ?? 0) >= targets[s]!);
}

export async function runCoachJob(
  admin: Db,
  opts: { now?: Date; appUrl?: string; deadlineMs?: number; deps?: DeliverDeps; ownerId?: string } = {},
): Promise<CoachJobOutcome[]> {
  const today = toYmd(opts.now ?? new Date());
  const thisWeek = mondayOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const dow = isoWeekday(today);
  const appUrl = (opts.appUrl ?? process.env.APP_URL ?? "https://localhost:3100").replace(/\/$/, "");

  // 週の回数を決めたプロジェクト（ownerId: テストで利用者に絞る）
  const plans = await allRows((from, to) => {
    let q = admin.from("account_plans").select("project_id, data, projects!inner(owner_id, name)").order("project_id").range(from, to);
    if (opts.ownerId) q = q.eq("projects.owner_id", opts.ownerId);
    return q;
  });
  const withTargets = plans
    .map((p) => {
      const fm = sectionSchemas.first_month.safeParse((p.data as Record<string, unknown> | null)?.first_month ?? {});
      const project = p.projects as unknown as { owner_id: string; name: string };
      return fm.success && hasTargets(fm.data.weekly) ? { projectId: p.project_id, ownerId: project.owner_id, name: project.name, fm: fm.data } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // 予定日を過ぎたやることの候補（ロードマップ。週の回数を決めていないプロジェクトも）。先週の分は月曜の振り返りにも数える
  const overdueFrom = addDays(today, -OVERDUE_DAYS);
  const itemRows = await allRows((from, to) => {
    let q = admin
      .from("roadmap_items")
      .select(`${ITEM_COLUMNS}, project_id, projects!inner(owner_id, name)`)
      .eq("status", "todo")
      .gte("planned_on", overdueFrom)
      .lt("planned_on", today)
      .order("id")
      .range(from, to);
    if (opts.ownerId) q = q.eq("projects.owner_id", opts.ownerId);
    return q;
  });

  type Target = { projectId: string; ownerId: string; name: string; fm: (typeof withTargets)[number]["fm"] | null };
  const byProject = new Map<string, Target>(withTargets.map((t) => [t.projectId, t]));
  for (const r of itemRows) {
    const project = r.projects as unknown as { owner_id: string; name: string };
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, { projectId: r.project_id, ownerId: project.owner_id, name: project.name, fm: null });
  }
  const targets = [...byProject.values()];
  if (targets.length === 0) return [];

  const ids = withTargets.map((t) => t.projectId);
  const since = addDays(thisWeek, -7 * 12);
  const [counts, saved] = ids.length
    ? await Promise.all([
        allRows((from, to) => admin.rpc("post_counts_by_day", { p_project_id: null as unknown as string, p_from: lastWeek, p_to: addDays(thisWeek, 6) }).in("project_id", ids).order("project_id").order("day").order("sns").range(from, to)),
        allRows((from, to) => admin.from("pace_weeks").select("project_id, week_start, targets, achieved").in("project_id", ids).gte("week_start", since).order("project_id").order("week_start").range(from, to)),
      ])
    : [[], []];

  const prefsCache = new Map<string, Prefs>();
  const emailCache = new Map<string, string | null>();
  const outcomes: CoachJobOutcome[] = [];

  for (const t of targets) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const prefs = prefsCache.get(t.ownerId) ?? (await ensurePrefs(admin, t.ownerId));
    prefsCache.set(t.ownerId, prefs);

    // 予定日を過ぎたのに、結びついた投稿を予約も送信もしていない、済んでいないやること（roadmap/load.ts の overdueItems。概要のカードと同じ）
    const rowsOfProject = itemRows.filter((r) => r.project_id === t.projectId) as unknown as ItemRow[];
    let overdue: OverdueItem[] = [];
    if (rowsOfProject.length) {
      const weeks = rowsOfProject.map((r) => r.week_start).sort();
      const progress = await loadItemPostCounts(admin, t.projectId, weeks[0], weeks[weeks.length - 1]);
      overdue = overdueItems(
        rowsOfProject.map((r) => toItem(r, progress.get(r.id) ?? { published: 0, scheduled: 0, linkedPublished: 0, linkedScheduled: 0 })),
        today,
      ).map((i) => ({ id: i.id, title: i.title, plannedOn: i.plannedOn! }));
    }
    const lastWeekOverdue = overdue.filter((i) => i.plannedOn >= lastWeek && i.plannedOn < thisWeek).length;

    let pace: ReturnType<typeof computeWeekPace> | null = null;
    let weekly: Parameters<typeof weeklyMessage>[0] | null = null;
    if (t.fm) {
      const fm = t.fm;
      const byWeek = countsByWeek(counts.filter((c) => c.project_id === t.projectId));
      const rows = saved.filter((r) => r.project_id === t.projectId);
      const startWeek = fm.startedOn ? mondayOf(fm.startedOn) : thisWeek;

      // 先週（終わった週）の結果。目標はその週に書いた行のもの（なければ今の目標）
      const lastRow = rows.find((r) => r.week_start === lastWeek);
      const lastTargets = lastRow ? parseTargets(lastRow.targets) : fm.weekly;
      const lastPublished = publishedOf(byWeek.get(lastWeek));
      const lastAchieved = achieved(lastTargets, lastPublished);
      const thisCounts = byWeek.get(thisWeek) ?? {};
      pace = computeWeekPace({ targets: fm.weekly, counts: thisCounts, today, weekStart: thisWeek, behindWeekday: prefs.behind_weekday });

      const upserts = [{ project_id: t.projectId, owner_id: t.ownerId, week_start: thisWeek, targets: fm.weekly, published: publishedOf(thisCounts), scheduled: scheduledOf(thisCounts), achieved: pace.achieved }];
      if (lastWeek >= startWeek) upserts.push({ project_id: t.projectId, owner_id: t.ownerId, week_start: lastWeek, targets: lastTargets, published: lastPublished, scheduled: {}, achieved: lastAchieved });
      const { error } = await admin.from("pace_weeks").upsert(upserts as never, { onConflict: "project_id,week_start" });
      if (error) throw error;

      if (dow === 1 && lastWeek >= startWeek) {
        const past = rows.filter((r) => r.week_start < lastWeek).map((r) => ({ weekStart: r.week_start, achieved: r.achieved }));
        past.push({ weekStart: lastWeek, achieved: lastAchieved });
        const info = fm.startedOn ? cycleInfo(fm.startedOn, addDays(today, -1)) : null;
        // 先週で 1 か月が終わった（昨日が 1 か月の最後の日）
        const justEnded = Boolean(info && info.endsOn === addDays(today, -1));
        const cycleWeeks = info
          ? Array.from({ length: CYCLE_WEEKS }, (_, i) => addDays(mondayOf(info.startedOn), i * 7)).map((w) => (w === lastWeek ? lastAchieved : (rows.find((r) => r.week_start === w)?.achieved ?? false)))
          : [];
        weekly = {
          lastWeek: { weekStart: lastWeek, targets: lastTargets, published: lastPublished, achieved: lastAchieved },
          thisWeekTargets: fm.weekly,
          streak: streakWeeks(past, thisWeek, false),
          cycle: info ? { ...info, achievedWeeks: cycleWeeks.filter(Boolean).length } : null,
          justEnded,
          lastWeekOverdue,
        };
      }
    }

    const nudge = pace ? shouldNudgeBehind(pace, today, prefs.behind_weekday) : false;
    // まだ送っていない予定日を過ぎたやること（「遅れそうなとき」を選んだ人だけ。同じやることは 1 回だけ）
    const wantsOverdue = wants(prefs.email_mode, "behind") || wants(prefs.push_mode, "behind");
    const newOverdueIds = wantsOverdue ? await unsentOverdue(admin, t.ownerId, t.projectId, overdue.map((i) => i.id)) : [];
    const newOverdue = overdue.filter((i) => newOverdueIds.includes(i.id));
    if (!nudge && !weekly && newOverdue.length === 0) {
      outcomes.push({ projectId: t.projectId });
      continue;
    }
    if (!emailCache.has(t.ownerId)) {
      const { data } = await admin.auth.admin.getUserById(t.ownerId);
      emailCache.set(t.ownerId, data.user?.email ?? null);
    }
    const ctx: MessageContext = { appUrl, projectId: t.projectId, projectName: t.name, unsubscribeToken: prefs.unsubscribe_token };
    const common = { userId: t.ownerId, email: emailCache.get(t.ownerId) ?? null, projectId: t.projectId, prefs, headers: unsubscribeHeaders(ctx) };
    const overdueClaims = newOverdue.map((i) => ({ kind: "overdue" as const, periodKey: i.id }));
    const outcome: CoachJobOutcome = { projectId: t.projectId };

    // 1 日に 2 通送らない: 予定日を過ぎたやることは、遅れそうな日はその知らせに、月曜は振り返りに入れる（振り返りには先週の件数を書く）。
    // ほかの日は、新しく過ぎたやることがあるときだけ、それだけの知らせを送る
    if (weekly) {
      const claims = [{ kind: "weekly" as const, periodKey: thisWeek }, ...(nudge ? [] : overdueClaims)];
      outcome.weekly = await deliverCoachMessage(admin, { ...common, kind: "weekly", claims, message: weeklyMessage(weekly, ctx) }, opts.deps);
    }
    if (nudge && pace) {
      outcome.behind = await deliverCoachMessage(
        admin,
        { ...common, kind: "behind", claims: [{ kind: "behind", periodKey: thisWeek }, ...overdueClaims], message: behindMessage(pace, ctx, newOverdue) },
        opts.deps,
      );
    } else if (newOverdue.length && !weekly) {
      outcome.overdue = await deliverCoachMessage(admin, { ...common, kind: "behind", claims: overdueClaims, message: overdueMessage(newOverdue, ctx) }, opts.deps);
    }
    outcomes.push(outcome);
  }
  return outcomes;
}
