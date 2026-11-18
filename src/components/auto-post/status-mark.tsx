import { STOP_REASON_TEXT } from "@/lib/auto-post/labels";
import type { AutoPlan } from "@/lib/auto-post/types";

// 回し方の状態の印（1.6）: ↻ 動いている（押す色ではなく文字の色）／‖ 止めている（muted）／! 止まった（朱の印だけ）。
// held: 運営者が利用者ごとに止めている（auto_post_holds）。動いている回し方も回を作らないので「運営者が止めています」と出す
export function PlanStatusMark({ plan, held = false }: { plan: Pick<AutoPlan, "status" | "stopReason">; held?: boolean }) {
  if (held && plan.status === "active")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <span aria-hidden="true">‖</span>運営者が止めています
      </span>
    );
  if (plan.status === "active")
    return (
      <span className="inline-flex items-center gap-1 text-sm font-bold text-fg">
        <span aria-hidden="true">↻</span>動いている
      </span>
    );
  if (plan.status === "paused")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <span aria-hidden="true">‖</span>止めている
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-sm font-bold">
      <span className="text-signal" aria-hidden="true">
        !
      </span>
      止まった
      {plan.stopReason && <span className="font-normal text-muted">・{STOP_REASON_TEXT[plan.stopReason]}</span>}
    </span>
  );
}
