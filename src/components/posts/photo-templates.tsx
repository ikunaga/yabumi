"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { addPhotoTemplate, type TemplatesResult } from "@/lib/photo-templates/actions";
import { MAX_TEMPLATE_NAME, type PhotoTemplate } from "@/lib/photo-templates/schema";
import { Choice } from "./maker-parts";

// 絵の説明のフォーマット（docs/architecture.md の 4.25 の ②）を選ぶ欄。作る・名前を変える・いつも使う・削除するは、
// フォーマットの画面の「絵の説明」のタブ（/projects/[id]/formats?tab=photo。2026-11-18 オーナーの了承で、ここの畳んだ「管理」から移した）
export function PhotoTemplatePicker({
  projectId,
  templates,
  selectedId,
  onSelect,
}: {
  projectId: string;
  templates: PhotoTemplate[];
  selectedId: string | null;
  onSelect: (t: PhotoTemplate | null) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-[14px] font-bold">絵の説明のフォーマット</legend>
      <div className="flex flex-wrap gap-2">
        <Choice on={selectedId === null} onClick={() => onSelect(null)}>
          なし
        </Choice>
        {templates.map((t) => (
          <Choice key={t.id} on={selectedId === t.id} onClick={() => onSelect(t)}>
            {t.name}
            {t.isDefault && <span className="ml-1 text-xs font-normal text-muted">毎回これを使う</span>}
          </Choice>
        ))}
      </div>
      <Link href={`/projects/${projectId}/formats?tab=photo`} className="self-start text-xs font-bold text-fg underline">
        フォーマットを作る・編集 →
      </Link>
    </fieldset>
  );
}

// いまの絵の説明をフォーマットとして保存する（名前を付けて）
export function SaveAsTemplate({ projectId, body, disabled, onSaved }: { projectId: string; body: string; disabled: boolean; onSaved: (r: TemplatesResult) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <Button size="sm" variant="text" disabled={disabled} onClick={() => setOpen(true)} className="self-start">
        フォーマットとして保存
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="フォーマットの名前" value={name} maxLength={MAX_TEMPLATE_NAME} onChange={(e) => setName(e.target.value)} placeholder="名前。例: 店内の雰囲気" className="min-w-0 flex-1 py-1.5 text-sm" />
      <Button
        size="sm"
        disabled={pending || !name.trim()}
        onClick={() =>
          start(async () => {
            const r = await addPhotoTemplate(projectId, { name, body });
            onSaved(r);
            if (!r.error) {
              setOpen(false);
              setName("");
            }
          })
        }
      >
        {pending ? "保存しています…" : "保存する"}
      </Button>
      <Button size="sm" variant="text" onClick={() => setOpen(false)}>
        やめる
      </Button>
    </div>
  );
}
