"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { reviseFromChoiceAction } from "@/lib/goals/actions";
import type { GoalRisk, ReviseChoice } from "@/lib/goals/risk";
import { paceText, restateTarget, RISK_TITLE } from "@/lib/goals/risk";
import type { GoalMetric } from "@/lib/goals/schema";
import { formatMetric, md } from "@/lib/goals/view";

// ロードマップの「届かない見込み」（2026-11-19 オーナーの決定。docs/design/goals-model.md の 13.）。
// いまの差と、届くのに要るペースを数字で出し、「立て直す（AI と相談）」と「目標を見直す」（AI なしで、計算した案から選ぶ）を置く

export function GoalRiskPanel({
  projectId,
  goalId,
  metric,
  metricName,
  statement,
  endsOn,
  risk,
  choices,
  rescueHref,
  openRevise = false,
}: {
  projectId: string;
  goalId: string;
  metric: GoalMetric;
  metricName: string;
  statement: string;
  endsOn: string;
  risk: GoalRisk;
  choices: ReviseChoice[];
  // 立て直す相談の入口（AI が使えないときは null で「準備中」）
  rescueHref: string | null;
  openRevise?: boolean;
}) {
  const [open, setOpen] = useState(openRevise && choices.length > 0);
  const f = (v: number) => formatMetric(metric, v);
  return (
    <div id="goal-risk" className="scroll-mt-20">
    <Card className="flex flex-col gap-3 px-6 py-5 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <p className="text-[16px] font-bold">
          <span className="text-signal">● 要確認</span> {RISK_TITLE[risk.level]}
        </p>
        <p className="num text-[14px] text-muted">
          {metricName}: いま {f(risk.value)} / 目標 {f(risk.target)}。このままだと期限（{md(endsOn)}）に {f(risk.projected)} の見込み
        </p>
        <p className="num text-[14px] text-muted">{paceText(metric, risk)}</p>
      </div>
      {!open && (
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          {rescueHref ? (
            <ButtonLink href={rescueHref} size="sm">
              立て直す（AI と相談）
            </ButtonLink>
          ) : (
            <NotReadyButton size="sm">立て直す（AI と相談）</NotReadyButton>
          )}
          {choices.length > 0 && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
              目標を見直す
            </Button>
          )}
        </div>
      )}
      {open && (
        <ReviseChoices projectId={projectId} goalId={goalId} metric={metric} statement={statement} endsOn={endsOn} risk={risk} choices={choices} onClose={() => setOpen(false)} />
      )}
    </Card>
    </div>
  );
}

type ChoiceKind = ReviseChoice["kind"] | "keep";

function ReviseChoices({
  projectId,
  goalId,
  metric,
  statement,
  endsOn,
  risk,
  choices,
  onClose,
}: {
  projectId: string;
  goalId: string;
  metric: GoalMetric;
  statement: string;
  endsOn: string;
  risk: GoalRisk;
  choices: ReviseChoice[];
  onClose: () => void;
}) {
  const router = useRouter();
  const f = (v: number) => formatMetric(metric, v);
  const textFor = (k: ChoiceKind) => {
    const c = choices.find((x) => x.kind === k);
    return c?.kind === "lower" ? restateTarget(statement, risk.target, c.target) : statement;
  };
  const [pick, setPick] = useState<ChoiceKind>(choices[0]?.kind ?? "keep");
  const [text, setText] = useState(textFor(choices[0]?.kind ?? "keep"));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const options: { kind: ChoiceKind; title: string; good: string; bad: string; note?: string }[] = [
    ...choices.map((c) =>
      c.kind === "lower"
        ? { kind: c.kind, title: `目標を ${f(risk.target)} から ${f(c.target)} に下げる`, good: "いまのペースで届く見込みになり、続けやすい", bad: "期限までに目指す成果は少なくなる" }
        : {
            kind: c.kind,
            title: `期限を ${c.weeks} 週のばす（${md(endsOn)} → ${md(c.endsOn)}）`,
            good: "目標の値はそのまま",
            bad: "結果が出るまでが長くなる",
            note: c.reachable ? undefined : `${c.weeks} 週のばしても、いまのペースでは届かない見込みです`,
          },
    ),
    { kind: "keep", title: "このまま続ける", good: "目標を変えない", bad: "このままだと届かない見込みのまま。やり方を変えるなら「立て直す」へ" },
  ];

  function choose(k: ChoiceKind) {
    setPick(k);
    setText(textFor(k));
    setError(null);
  }

  function submit() {
    if (pick === "keep") return onClose();
    start(async () => {
      const r = await reviseFromChoiceAction(projectId, goalId, pick, text);
      if (r.error) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-bold">どう見直しますか</legend>
        {options.map((o) => (
          <label
            key={o.kind}
            className={`flex cursor-pointer gap-3 rounded-md border px-4 py-3 ${pick === o.kind ? "border-primary" : "border-line"}`}
          >
            <input type="radio" name="revise-choice" className="mt-1 size-4 shrink-0 accent-[var(--primary)]" checked={pick === o.kind} onChange={() => choose(o.kind)} />
            <span className="flex flex-col gap-0.5 text-[14px]">
              <b className="num text-[15px]">{o.title}</b>
              <span className="text-muted">よい点: {o.good}</span>
              <span className="text-muted">気になる点: {o.bad}</span>
              {o.note && <span className="text-muted">{o.note}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {pick !== "keep" && (
        <Field label="目標の文" htmlFor="revise-statement" hint="数字を変えたら、文も合わせて編集できます。120 字まで">
          <Input id="revise-statement" value={text} maxLength={120} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || (pick !== "keep" && !text.trim())} onClick={submit}>
          {pending ? "見直しています…" : pick === "keep" ? "このまま続ける" : "見直す"}
        </Button>
        <Button type="button" size="sm" variant="text" disabled={pending} onClick={onClose}>
          やめる
        </Button>
      </div>
    </div>
  );
}
