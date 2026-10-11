"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { deleteProject } from "@/lib/projects/actions";

// 誤操作を防ぐため、アプリ名を入力したときだけ削除できる
export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === projectName;

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Field label={`確認のため「${projectName}」と入力してください`} htmlFor="confirm-name">
        <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Field>
      <div>
        <Button
          type="button"
          variant="danger"
          disabled={!matches || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await deleteProject(projectId);
              if (res?.error) setError(res.error);
            })
          }
          className="max-sm:h-13 max-sm:w-full"
        >
          {pending ? "削除中…" : "削除する"}
        </Button>
      </div>
    </div>
  );
}
