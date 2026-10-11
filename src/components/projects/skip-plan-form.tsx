"use client";

import { useActionState } from "react";
import { skipPlan } from "@/lib/plan/actions";

// 「あとで設計する」。保存に失敗したときは、ボタンの下に理由を出す
export function SkipPlanForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(skipPlan.bind(null, projectId), {});
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="mt-1 text-xs text-on-primary-muted underline hover:text-on-primary disabled:opacity-60 max-sm:w-full max-sm:py-1"
      >
        あとで設計する（先に SNS をつなぐ）
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-on-primary">
          {state.error}
        </p>
      )}
    </form>
  );
}
