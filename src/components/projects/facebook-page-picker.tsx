"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { selectFacebookPage } from "@/lib/sns/facebook/actions";
import type { PageSummary } from "@/lib/sns/facebook/pages";

// 管理しているページから、このプロジェクトで投稿するページを 1 つ選ぶ（1 つのプロジェクトに SNS ごとに 1 つ。docs/architecture.md の 4.6）
export function FacebookPagePicker({ projectId, choiceId, pages }: { projectId: string; choiceId: string; pages: PageSummary[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <p>投稿を作れる役割を持っているページです。このプロジェクトから投稿するページを 1 つ選んでください（あとから「つなぎ直す」で変えられます）。</p>
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-border">
        {pages.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <input
                type="radio"
                name="facebook-page"
                className="size-4 accent-[var(--primary)]"
                checked={selected === p.id}
                onChange={() => setSelected(p.id)}
              />
              <span className="font-bold">{p.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
      <Button
        type="button"
        className="self-start"
        disabled={!selected || pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            if (!selected) return;
            const res = await selectFacebookPage(projectId, choiceId, selected);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? "つないでいます…" : "このページをつなぐ"}
      </Button>
    </div>
  );
}
