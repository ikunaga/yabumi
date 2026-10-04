"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { connectRepo } from "@/lib/github/actions";

export type PickableRepo = { installationId: number; id: number; fullName: string; isPrivate: boolean; description: string | null };

// 読ませたリポジトリの中から、このプロジェクトのアプリのものを選ぶ
export function RepoPicker({ projectId, repos }: { projectId: string; repos: PickableRepo[] }) {
  const [selected, setSelected] = useState<string>(repos.length === 1 ? `${repos[0].installationId}:${repos[0].id}` : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[14px] font-bold">このアプリのリポジトリ</legend>
        {repos.map((r) => {
          const value = `${r.installationId}:${r.id}`;
          return (
            <label key={value} className="flex cursor-pointer gap-3 rounded-md border border-input px-3.5 py-3 has-checked:border-primary has-checked:bg-primary-soft">
              <input type="radio" name="repo" value={value} checked={selected === value} onChange={() => setSelected(value)} className="mt-1 size-4 accent-[var(--primary)]" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] font-bold break-all">
                  {r.fullName}
                  {r.isPrivate && <span className="ml-2 text-xs font-normal text-muted">非公開</span>}
                </span>
                {r.description && <span className="text-sm text-muted">{r.description}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div>
        <Button
          disabled={!selected || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const [inst, repo] = selected.split(":").map(Number);
              const res = await connectRepo(projectId, inst, repo);
              if (res.error) setError(res.error);
            })
          }
        >
          このリポジトリをつなぐ
        </Button>
      </div>
    </div>
  );
}
