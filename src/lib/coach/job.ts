import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sectionSchemas } from "@/lib/plan/schema";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";
import { countsByWeek, parseTargets } from "./load";
import { behindMessage, unsubscribeHeaders, weeklyMessage, type MessageContext } from "./messages";
import { deliverCoachMessage, ensurePrefs, type DeliverDeps, type DeliverResult, type Prefs } from "./notify";
import { computeWeekPace, cycleInfo, CYCLE_WEEKS, hasTargets, isoWeekday, mondayOf, shouldNudgeBehind, streakWeeks, type SnsCounts, type WeeklyTargets } from "./pace";

// 伴走の毎日のジョブ（4.27。pg_cron が日本時間 7:00 に /api/jobs/coach を呼ぶ）:
// 最初の 1 か月の週の回数を決めたプロジェクトごとに、① 今週と先週の結果を pace_weeks に書き（続けた週を数えるため）、
// ② 決めた曜日に遅れそうなら声をかけ、③ 月曜に先週の振り返りを送る。数は counted_post_targets（4.23 の 1 か所の数え方）
type Db = SupabaseClient<Database>;

export type CoachJobOutcome = { projectId: string; behind?: DeliverResult; weekly?: DeliverResult };

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
  const targets = plans
    .map((p) => {
      const fm = sectionSchemas.first_month.safeParse((p.data as Record<string, unknown> | null)?.first_month ?? {});
      const project = p.projects as unknown as { owner_id: string; name: string };
      return fm.success && hasTargets(fm.data.weekly) ? { projectId: p.project_id, ownerId: project.owner_id, name: project.name, fm: fm.data } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (targets.length === 0) return [];

  const ids = targets.map((t) => t.projectId);
  const since = addDays(thisWeek, -7 * 12);
  const [counts, saved] = await Promise.all([
    allRows((from, to) => admin.rpc("post_counts_by_day", { p_project_id: null as unknown as string, p_from: lastWeek, p_to: addDays(thisWeek, 6) }).in("project_id", ids).order("project_id").order("day").order("sns").range(from, to)),
    allRows((from, to) => admin.from("pace_weeks").select("project_id, week_start, targets, achieved").in("project_id", ids).gte("week_start", since).order("project_id").order("week_start").range(from, to)),
  ]);

  const prefsCache = new Map<string, Prefs>();
  const emailCache = new Map<string, string | null>();
  const outcomes: CoachJobOutcome[] = [];

  for (const t of targets) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const byWeek = countsByWeek(counts.filter((c) => c.project_id === t.projectId));
    const rows = saved.filter((r) => r.project_id === t.projectId);
    const startWeek = t.fm.startedOn ? mondayOf(t.fm.startedOn) : thisWeek;

    // 先週（終わった週）の結果。目標はその週に書いた行のもの（なければ今の目標）
    const lastRow = rows.find((r) => r.week_start === lastWeek);
    const lastTargets = lastRow ? parseTargets(lastRow.targets) : t.fm.weekly;
    const lastPublished = publishedOf(byWeek.get(lastWeek));
    const lastAchieved = achieved(lastTargets, lastPublished);
    const thisCounts = byWeek.get(thisWeek) ?? {};
    const prefs = prefsCache.get(t.ownerId) ?? (await ensurePrefs(admin, t.ownerId));
    prefsCache.set(t.ownerId, prefs);
    const pace = computeWeekPace({ targets: t.fm.weekly, counts: thisCounts, today, weekStart: thisWeek, behindWeekday: prefs.behind_weekday });

    const upserts = [{ project_id: t.projectId, owner_id: t.ownerId, week_start: thisWeek, targets: t.fm.weekly, published: publishedOf(thisCounts), scheduled: scheduledOf(thisCounts), achieved: pace.achieved }];
    if (lastWeek >= startWeek) upserts.push({ project_id: t.projectId, owner_id: t.ownerId, week_start: lastWeek, targets: lastTargets, published: lastPublished, scheduled: {}, achieved: lastAchieved });
    const { error } = await admin.from("pace_weeks").upsert(upserts as never, { onConflict: "project_id,week_start" });
    if (error) throw error;

    const past = rows.filter((r) => r.week_start < lastWeek).map((r) => ({ weekStart: r.week_start, achieved: r.achieved }));
    if (lastWeek >= startWeek) past.push({ weekStart: lastWeek, achieved: lastAchieved });
    const streak = streakWeeks(past, thisWeek, false);

    const nudge = shouldNudgeBehind(pace, today, prefs.behind_weekday);
    const monday = dow === 1 && lastWeek >= startWeek;
    if (!nudge && !monday) {
      outcomes.push({ projectId: t.projectId });
      continue;
    }
    if (!emailCache.has(t.ownerId)) {
      const { data } = await admin.auth.admin.getUserById(t.ownerId);
      emailCache.set(t.ownerId, data.user?.email ?? null);
    }
    const ctx: MessageContext = { appUrl, projectId: t.projectId, projectName: t.name, unsubscribeToken: prefs.unsubscribe_token };
    const common = { userId: t.ownerId, email: emailCache.get(t.ownerId) ?? null, projectId: t.projectId, periodKey: thisWeek, prefs, headers: unsubscribeHeaders(ctx) };
    const outcome: CoachJobOutcome = { projectId: t.projectId };

    if (monday) {
      const info = t.fm.startedOn ? cycleInfo(t.fm.startedOn, addDays(today, -1)) : null;
      // 先週で 1 か月が終わった（昨日が 1 か月の最後の日）
      const justEnded = Boolean(info && info.endsOn === addDays(today, -1));
      const cycleWeeks = info
        ? Array.from({ length: CYCLE_WEEKS }, (_, i) => addDays(mondayOf(info.startedOn), i * 7)).map((w) => (w === lastWeek ? lastAchieved : (rows.find((r) => r.week_start === w)?.achieved ?? false)))
        : [];
      outcome.weekly = await deliverCoachMessage(
        admin,
        {
          ...common,
          kind: "weekly",
          message: weeklyMessage(
            { lastWeek: { weekStart: lastWeek, targets: lastTargets, published: lastPublished, achieved: lastAchieved }, thisWeekTargets: t.fm.weekly, streak, cycle: info ? { ...info, achievedWeeks: cycleWeeks.filter(Boolean).length } : null, justEnded },
            ctx,
          ),
        },
        opts.deps,
      );
    }
    if (nudge) outcome.behind = await deliverCoachMessage(admin, { ...common, kind: "behind", message: behindMessage(pace, ctx) }, opts.deps);
    outcomes.push(outcome);
  }
  return outcomes;
}
