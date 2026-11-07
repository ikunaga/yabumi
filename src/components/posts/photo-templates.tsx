"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { addPhotoTemplate, deletePhotoTemplate, setDefaultPhotoTemplate, updatePhotoTemplate, type TemplatesResult } from "@/lib/photo-templates/actions";
import { MAX_PHOTO_TEMPLATES, MAX_TEMPLATE_NAME, type PhotoTemplate } from "@/lib/photo-templates/schema";
import { Choice } from "./maker-parts";

// 絵の説明のフォーマット（docs/architecture.md の 4.25 の ②）。選ぶ欄と、畳んだ「管理」（例から追加・名前を変える・いつも使う・削除）。
// 一覧の正はサーバー。操作のたびにサーバーが返した一覧に入れ替える
export function PhotoTemplatePicker({
  projectId,
  templates,
  examples,
  selectedId,
  onSelect,
  onChange,
}: {
  projectId: string;
  templates: PhotoTemplate[];
  examples: { name: string; body: string }[];
  selectedId: string | null;
  onSelect: (t: PhotoTemplate | null) => void;
  onChange: (r: TemplatesResult) => void;
}) {
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const run = (fn: () => Promise<TemplatesResult>) => start(async () => onChange(await fn()));
  const left = MAX_PHOTO_TEMPLATES - templates.length;
  const addable = examples.filter((e) => !templates.some((t) => t.name === e.name));

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-[14px] font-bold">フォーマット</legend>
      <div className="flex flex-wrap gap-2">
        <Choice on={selectedId === null} onClick={() => onSelect(null)}>
          なし
        </Choice>
        {templates.map((t) => (
          <Choice key={t.id} on={selectedId === t.id} onClick={() => onSelect(t)}>
            {t.name}
            {t.isDefault && <span className="ml-1 text-xs font-normal text-muted">いつも</span>}
          </Choice>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted">
          フォーマットを管理（<span className="num">{templates.length}</span> / {MAX_PHOTO_TEMPLATES}）
        </summary>
        <div className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
          {templates.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-col gap-1.5 py-2">
                  {renaming?.id === t.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="フォーマットの名前"
                        value={renaming.name}
                        maxLength={MAX_TEMPLATE_NAME}
                        onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                        className="min-w-0 flex-1 py-1.5 text-sm"
                      />
                      <Button size="sm" disabled={pending || !renaming.name.trim()} onClick={() => run(async () => (setRenaming(null), updatePhotoTemplate(projectId, t.id, { name: renaming.name, body: t.body })))}>
                        保存する
                      </Button>
                      <Button size="sm" variant="text" onClick={() => setRenaming(null)}>
                        やめる
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-bold">{t.name}</span>
                      <label className="flex items-center gap-1.5 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={t.isDefault}
                          disabled={pending}
                          onChange={() => run(() => setDefaultPhotoTemplate(projectId, t.isDefault ? null : t.id))}
                          className="size-4 accent-[var(--primary)]"
                        />
                        いつも使う
                      </label>
                      <span className="ml-auto flex gap-1">
                        <Button size="sm" variant="text" onClick={() => setRenaming({ id: t.id, name: t.name })}>
                          名前を変える
                        </Button>
                        {confirmDelete === t.id ? (
                          <>
                            <Button size="sm" variant="danger" disabled={pending} onClick={() => run(async () => (setConfirmDelete(null), deletePhotoTemplate(projectId, t.id)))}>
                              本当に削除する
                            </Button>
                            <Button size="sm" variant="text" onClick={() => setConfirmDelete(null)}>
                              やめる
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="text" onClick={() => setConfirmDelete(t.id)}>
                            削除する
                          </Button>
                        )}
                      </span>
                    </div>
                  )}
                  <p className="line-clamp-2 text-xs leading-[1.7] text-muted">{t.body}</p>
                </li>
              ))}
            </ul>
          )}
          {addable.length > 0 && left > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold">例から追加</span>
              <div className="flex flex-wrap gap-2">
                {addable.map((e) => (
                  <Button key={e.name} size="sm" variant="secondary" disabled={pending} onClick={() => run(() => addPhotoTemplate(projectId, e))}>
                    ＋ {e.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs leading-[1.7] text-muted">
            本文に {"{場面}"} を入れると、AI の案や書いた場面がそこに入ります。いまの絵の説明は、下の「フォーマットとして保存」で足せます。
          </p>
        </div>
      </details>
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
      <Input aria-label="フォーマットの名前" value={name} maxLength={MAX_TEMPLATE_NAME} onChange={(e) => setName(e.target.value)} placeholder="名前（例: 店内の雰囲気）" className="min-w-0 flex-1 py-1.5 text-sm" />
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
