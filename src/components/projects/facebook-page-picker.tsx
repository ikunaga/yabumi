"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { selectFacebookPages } from "@/lib/sns/facebook/actions";
import type { PageSummary } from "@/lib/sns/facebook/pages";

// 管理しているページから、矢書で投稿するページを選ぶ（いくつでも）
export function FacebookPagePicker({ projectId, choiceId, pages }: { projectId: string; choiceId: string; pages: PageSummary[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <p>投稿を作れる役割を持っているページです。矢書から投稿するページを選んでください（あとから足したり外したりできます）。</p>
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-border">
        {pages.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={selected.has(p.id)}
                onChange={(e) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    return next;
                  })
                }
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
        disabled={selected.size === 0 || pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await selectFacebookPages(projectId, choiceId, [...selected]);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? "つないでいます…" : `選んだ ${selected.size} ページをつなぐ`}
      </Button>
    </div>
  );
}
