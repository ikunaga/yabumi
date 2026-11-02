"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { notesForCompose } from "@/lib/notes/actions";
import { MAX_NOTES_PER_POST, type IdeaNote } from "@/lib/notes/rules";
import { formatShort } from "@/lib/time";

export type NoteInsertMode = "append" | "replace";

// 「投稿をつくる」の「ネタ帳から」。まだ投稿にしていないメモ（新しい順）から選ぶと、本文にそのメモが入り、写真があれば画像に添える（AI は使わない）。
// 本文がもう書いてあるときは、下に足すか置き換えるかを選ぶ。続けて選べば、選んだ順に下に足す
export function NotePicker({
  projectId,
  bodyHasText,
  pickedIds,
  onPick,
  onClose,
}: {
  projectId: string;
  bodyHasText: boolean;
  pickedIds: string[];
  // 失敗したら理由を返す
  onPick: (note: IdeaNote, mode: NoteInsertMode) => Promise<string | null>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<IdeaNote[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<NoteInsertMode>("append");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void notesForCompose(projectId).then((r) => {
      if (!alive) return;
      if (r.notes) setNotes(r.notes);
      else setLoadError(r.error ?? "ネタ帳を読み込めませんでした。");
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const left = (notes ?? []).filter((n) => !pickedIds.includes(n.id));
  const full = pickedIds.length >= MAX_NOTES_PER_POST;

  async function pick(note: IdeaNote) {
    setError(null);
    setBusy(note.id);
    const err = await onPick(note, bodyHasText ? mode : "append");
    setBusy(null);
    if (err) setError(err);
  }

  return (
    <section id="compose-notes" aria-labelledby="compose-notes-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="compose-notes-heading" className="text-[16px] font-bold">
          ネタ帳から選ぶ
          {notes && <span className="ml-2 text-[13px] font-normal text-faint">まだ投稿にしていないメモ {notes.length} 件</span>}
        </h2>
        <Button type="button" variant="text" size="sm" onClick={onClose}>
          閉じる
        </Button>
      </div>

      {bodyHasText && left.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
          <legend className="sr-only">本文がもう書いてあるとき</legend>
          <span className="text-[13px] text-muted">本文がもう書いてあります:</span>
          {(
            [
              ["append", "下に足す"],
              ["replace", "置き換える"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="note-mode" value={v} checked={mode === v} onChange={() => setMode(v)} className="accent-[var(--primary)]" />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {loadError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {loadError}
        </p>
      ) : notes === null ? (
        <p className="text-[14px] text-muted">読み込んでいます…</p>
      ) : notes.length === 0 ? (
        <p className="text-[14px] text-muted">ネタ帳にメモがありません。「＋ メモ」から書けます。</p>
      ) : left.length === 0 ? (
        <p className="text-[14px] text-muted">まだ投稿にしていないメモは、全部本文に入れました。</p>
      ) : (
        <ul className="flex max-h-[360px] flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
          {left.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-3 py-2.5">
              {n.image?.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- メモの画像のプレビュー（署名つき URL）
                <img src={n.image.previewUrl} alt="" className="size-11 shrink-0 rounded-sm border border-line object-cover" />
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="line-clamp-2 text-[14px] leading-[1.6] break-words">{n.body || <span className="text-muted">（写真だけのメモ）</span>}</p>
                <p className="text-[12px] text-faint">
                  <span className="num">{formatShort(n.createdAt)}</span>
                  {n.image && <span className="ml-2">写真あり</span>}
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={busy !== null || full} onClick={() => void pick(n)}>
                {busy === n.id ? (n.image ? "写真を写しています…" : "入れています…") : "使う"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {full && <p className="text-[13px] text-muted">1 つの投稿に入れられるメモは {MAX_NOTES_PER_POST} 件までです。</p>}
    </section>
  );
}
