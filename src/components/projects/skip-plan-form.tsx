"use client";

import { guardAction } from "@/lib/client-errors";
import { useActionState } from "react";
import { skipPlan } from "@/lib/plan/actions";

// 「方針はあとにして、SNS をつなぐ」（概要の「いまのタスク」の帯）。保存に失敗したときは、ボタンの下に理由を出す
export function SkipPlanForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(guardAction(skipPlan.bind(null, projectId), (m) => ({ error: m })), {});
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-muted hover:text-fg hover:underline disabled:opacity-60 max-sm:w-full max-sm:py-1"
      >
        方針はあとにして、SNS をつなぐ
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
