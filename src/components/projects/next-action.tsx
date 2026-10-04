import { Button, ButtonLink } from "@/components/ui/button";
import { skipPlan } from "@/lib/plan/actions";
import { STEPS, stepHref } from "@/lib/projects/next-step";

// 「いまやること」: 各プロジェクト画面の最上部に 1 つだけ出す
export function NextAction({ stepIndex, projectId }: { stepIndex: number; projectId: string }) {
  const step = STEPS[stepIndex];
  const rest = STEPS.slice(stepIndex + 1);
  const href = step.available ? stepHref(step.key, projectId) : null;

  return (
    <div>
      <section aria-labelledby="next-action-title" className="rounded-lg border border-border bg-surface max-sm:border-0">
        <div className="flex items-center gap-6 rounded-t-[7px] bg-primary px-7 py-[22px] text-on-primary max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5 max-sm:rounded-lg max-sm:p-5">
          <div className="flex flex-1 flex-col gap-1.5">
            <p className="text-xs tracking-[0.15em] text-on-primary-muted max-sm:text-[11px]">
              いまやること ・ {stepIndex + 1} / {STEPS.length}
            </p>
            <h2 id="next-action-title" className="text-xl leading-snug font-bold max-sm:text-[19px]">
              {step.title}
            </h2>
            <p className="text-[14px] leading-[1.7] text-on-primary-muted max-sm:text-sm">{step.description}</p>
          </div>
          <div className="flex flex-col items-center gap-1 max-sm:mt-1 max-sm:items-stretch">
            {href ? (
              <ButtonLink href={href} variant="inverse" className="px-6 max-sm:h-12">
                {step.cta}
              </ButtonLink>
            ) : (
              <>
                <Button variant="inverse" className="px-6 max-sm:h-12" disabled>
                  {step.cta}
                </Button>
                <span className="text-xs text-on-primary-muted">準備中</span>
              </>
            )}
            {/* 設計は飛ばして先へ進める */}
            {step.key === "plan" && (
              <form action={skipPlan.bind(null, projectId)}>
                <button type="submit" className="mt-1 text-xs text-on-primary-muted underline hover:text-on-primary max-sm:w-full max-sm:py-1">
                  あとで設計する（先に SNS をつなぐ）
                </button>
              </form>
            )}
          </div>
        </div>
        <ol className="grid grid-cols-3 text-[14px] max-sm:hidden">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === stepIndex ? "step" : undefined}
              className={`flex gap-2.5 px-7 py-4 ${i < STEPS.length - 1 ? "border-r border-line" : ""} ${i === stepIndex ? "font-bold" : "text-muted"}`}
            >
              <span className={i === stepIndex ? "text-primary" : ""}>{i + 1}</span>
              <span>{s.shortTitle}</span>
            </li>
          ))}
        </ol>
      </section>
      {rest.length > 0 && (
        <p className="mt-4 text-[14px] text-muted sm:hidden">
          次:{" "}
          {rest.map((s, i) => (
            <span key={s.key}>
              {i > 0 && " → "}
              {s.key === "firstPost" ? "最初の投稿" : s.shortTitle}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
