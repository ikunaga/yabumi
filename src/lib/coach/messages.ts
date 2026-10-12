import { LEGAL } from "@/lib/legal/info";
import type { PushMessage } from "@/lib/push/send";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { CYCLE_WEEKS, remainingText, type CycleInfo, type WeekPace, type WeeklyTargets } from "./pace";

// 伴走の知らせの中身（4.27）。同じ中身を、メールとスマホの通知に配る（画面の声かけも同じ計算 pace.ts を使う）。
// スマホの通知はロック画面に出るので、投稿の本文やメールアドレスは入れない（題 30 字・本文 80 字。超えたら push 側で切る）

export type CoachMessage = { email: { subject: string; text: string }; push: PushMessage };

export type MessageContext = { appUrl: string; projectId: string; projectName: string; unsubscribeToken: string };

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

function targetsText(t: WeeklyTargets): string {
  return SNS_KEYS.filter((s) => (t[s] ?? 0) > 0)
    .map((s) => `${SNS[s].label} 週 ${t[s]} 本`)
    .join("・");
}

// メールの最後に付ける: 何のメールか、設定の変え方、ワンクリックの配信の停止、送信者と問い合わせ先（特定電子メール法の表示に沿う）
export function mailFooter(c: MessageContext): string {
  return [
    "--",
    "このメールは、矢書（やぶみ）の「伴走」のお知らせです。あなたが決めた SNS ごとの週の投稿の回数をもとに、自動で送っています。",
    `お知らせの設定（毎週の振り返りだけにする・送らない）: ${c.appUrl}/settings/notifications`,
    `このお知らせのメールを止める（ワンクリック）: ${c.appUrl}/unsubscribe?t=${c.unsubscribeToken}`,
    `送信者: 矢書（運営 ${LEGAL.operator ?? "矢書の運営者"}）`,
    `問い合わせ: ${LEGAL.contact ?? `${c.appUrl}/privacy`}`,
  ].join("\n");
}

// RFC 8058 のワンクリックの配信の停止（Gmail・Yahoo の送信者の要件）
export function unsubscribeHeaders(c: MessageContext): Record<string, string> {
  return {
    "List-Unsubscribe": `<${c.appUrl}/api/unsubscribe?t=${c.unsubscribeToken}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// 予定日を過ぎたやること（ロードマップ。予定日を過ぎたのに、結びついた投稿を予約も送信もしていない、済んでいないもの）
export type OverdueItem = { id: string; title: string; plannedOn: string };

function overdueLines(items: OverdueItem[], base: string): string[] {
  return [
    `予定日を過ぎたやることが ${items.length} 件あります（まだ投稿を予約も送信もしていません）。`,
    ...items.slice(0, 5).map((i) => `・${md(i.plannedOn)} ${i.title}`),
    ...(items.length > 5 ? [`・ほか ${items.length - 5} 件`] : []),
    `投稿をつくるか、予定を見直すか、やらないことにできます: ${base}/roadmap`,
  ];
}

// 予定日を過ぎたやることだけの知らせ（遅れそうなときの声かけの曜日でない日。同じやることは 1 回だけ）
export function overdueMessage(items: OverdueItem[], c: MessageContext): CoachMessage {
  const base = `${c.appUrl}/projects/${c.projectId}`;
  return {
    email: {
      subject: `予定日を過ぎたやることが ${items.length} 件あります（${c.projectName}）`,
      text: [`${c.projectName} のロードマップのお知らせです。`, "", ...overdueLines(items, base), "", mailFooter(c)].join("\n"),
    },
    push: {
      title: `予定日を過ぎたやることが ${items.length} 件`,
      body: `${c.projectName}: 投稿をつくるか、予定を見直しましょう`,
      url: `/projects/${c.projectId}/roadmap`,
      tag: `pace:${c.projectId}`,
    },
  };
}

// 遅れそうなとき（決めた曜日の朝に、今週まだ 1 本もない SNS があるとき）。予定日を過ぎたやることがあれば、同じ知らせに入れる（1 日に 2 通送らない）
export function behindMessage(p: WeekPace, c: MessageContext, overdue: OverdueItem[] = []): CoachMessage {
  const base = `${c.appUrl}/projects/${c.projectId}`;
  const left = remainingText(p) || "少し";
  const total = p.rows.reduce((n, r) => n + r.remaining, 0);
  return {
    email: {
      subject: `今週の投稿、あと ${left}です（${c.projectName}）`,
      text: [
        `${c.projectName} の、今週の投稿のペースのお知らせです。`,
        "",
        `今週の目標まで、あと ${left}です（送った投稿と、予約した投稿を数えています）。`,
        ...p.rows.map((r) => `・${SNS[r.sns].label}: ${r.published} / ${r.target} 本${r.scheduled ? `（予約 ${r.scheduled}）` : ""}`),
        "",
        "1 本だけでも、続けることがいちばん大事です。ネタに迷ったら:",
        `・ネタ帳から作る: ${base}/notes`,
        `・AI とネタを出す: ${base}/ideas`,
        `・投稿をつくる: ${base}/compose`,
        "",
        ...(overdue.length ? [...overdueLines(overdue, base), ""] : []),
        mailFooter(c),
      ].join("\n"),
    },
    push: {
      title: `今週の投稿、あと ${total} 本です`,
      body: `${c.projectName}: ${left}。ネタ帳や AI のネタから作れます`,
      url: `/projects/${c.projectId}`,
      tag: `pace:${c.projectId}`,
    },
  };
}

// 毎週月曜の振り返り（先週の結果・続けた週・今週の目標）。1 か月が先週で終わったら、そのまとめと次の 1 か月へのさそい
export function weeklyMessage(
  args: {
    lastWeek: { weekStart: string; targets: WeeklyTargets; published: Partial<Record<SnsKey, number>>; achieved: boolean } | null;
    thisWeekTargets: WeeklyTargets;
    streak: number;
    cycle: (CycleInfo & { achievedWeeks: number }) | null;
    justEnded: boolean;
    // 先週が予定日で、まだ投稿を予約も送信もしていない、済んでいないやることの数
    lastWeekOverdue?: number;
  },
  c: MessageContext,
): CoachMessage {
  const base = `${c.appUrl}/projects/${c.projectId}`;
  const lw = args.lastWeek;
  const lines: string[] = [`${c.projectName} の、先週の振り返りと今週の目標です。`, ""];
  if (lw) {
    lines.push(`■ 先週（${md(lw.weekStart)}〜）: ${lw.achieved ? "目標達成です。よく続けましたね。" : "目標には届きませんでした。続けていること自体が前進です。"}`);
    for (const s of SNS_KEYS.filter((k) => (lw.targets[k] ?? 0) > 0)) lines.push(`・${SNS[s].label}: ${lw.published[s] ?? 0} / ${lw.targets[s]} 本`);
    lines.push("");
  }
  if (args.streak > 0) lines.push(`■ 続けた週: ${args.streak} 週`, "");
  if (args.lastWeekOverdue) lines.push(`■ 先週、予定日を過ぎたやること: ${args.lastWeekOverdue} 件（投稿をつくるか、予定を見直す: ${base}/roadmap）`, "");
  if (args.justEnded && args.cycle) {
    lines.push(
      `■ 最初の 1 か月が終わりました（${md(args.cycle.startedOn)}〜${md(args.cycle.endsOn)}）: ${CYCLE_WEEKS} 週のうち ${args.cycle.achievedWeeks} 週で目標に届きました。`,
      `AI と振り返って、次の 1 か月の週の回数を決めましょう: ${base}/consult/new?start=month_review`,
      "",
    );
  }
  if (Object.keys(args.thisWeekTargets).length) lines.push(`■ 今週の目標: ${targetsText(args.thisWeekTargets)}`);
  lines.push(`今週の予定を立てる: ${base}`, "", mailFooter(c));
  return {
    email: { subject: args.justEnded ? `最初の 1 か月の振り返りと、次の 1 か月（${c.projectName}）` : `先週の振り返りと今週の目標（${c.projectName}）`, text: lines.join("\n") },
    push: {
      title: args.justEnded ? "最初の 1 か月が終わりました" : lw?.achieved ? "先週は目標達成です" : "今週の投稿の目標です",
      body: `${c.projectName}: ${args.streak > 0 ? `続けた週 ${args.streak} 週。` : ""}今週は ${targetsText(args.thisWeekTargets)}`,
      url: args.justEnded ? `/projects/${c.projectId}/consult/new?start=month_review` : `/projects/${c.projectId}`,
      tag: `weekly:${c.projectId}`,
    },
  };
}
