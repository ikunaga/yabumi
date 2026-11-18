"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { addPhotoTemplate, deletePhotoTemplate, listPhotoTemplates, setDefaultPhotoTemplate, updatePhotoTemplate, type TemplatesResult } from "@/lib/photo-templates/actions";
import { MAX_PHOTO_TEMPLATES, MAX_TEMPLATE_NAME, type PhotoTemplate } from "@/lib/photo-templates/schema";

// フォーマットの画面の「絵の説明」のタブ（docs/architecture.md の 4.25 の ②）: 一覧（名前を変える・いつも使う・削除する）と例から追加。
// 前は投稿をつくるの画像の欄の中に畳んでいた（2026-11-18 オーナーの了承で移した）。一覧の正はサーバー
export function PhotoTemplateManager({ projectId }: { projectId: string }) {
  const [templates, setTemplates] = useState<PhotoTemplate[] | null>(null);
  const [examples, setExamples] = useState<{ name: string; body: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const onChange = (r: TemplatesResult) => {
    setError(r.error ?? null);
    if (r.templates) setTemplates(r.templates);
    if (r.examples) setExamples(r.examples);
  };
  useEffect(() => {
    let alive = true;
    void listPhotoTemplates(projectId).then((r) => alive && onChange(r));
    return () => {
      alive = false;
    };
  }, [projectId]);
  const run = (fn: () => Promise<TemplatesResult>) => start(async () => onChange(await fn()));
  if (templates === null) return error ? <ErrorBanner>{error}</ErrorBanner> : <p className="text-xs text-faint">読み込んでいます…</p>;
  const left = MAX_PHOTO_TEMPLATES - templates.length;
  const addable = examples.filter((e) => !templates.some((t) => t.name === e.name));

  return (
    <>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-[14px] leading-[1.7] text-muted">
          AI に画像を作ってもらうときの、絵の説明の型です。投稿をつくるの「画像」で使います（<span className="num">{templates.length}</span> / {MAX_PHOTO_TEMPLATES}）。
        </p>
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
                        <Button size="sm" variant="secondary" onClick={() => setRenaming({ id: t.id, name: t.name })}>
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
                          <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(t.id)}>
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
            本文に {"{場面}"} を入れると、AI の案や書いた場面がそこに入ります。投稿をつくるの「画像」で書いた絵の説明は、「フォーマットとして保存」で足せます。
          </p>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </>
  );
}
