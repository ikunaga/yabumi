"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { discardImage } from "@/lib/media/actions";
import { uploadImageFile } from "@/lib/media/client-upload";
import { saveNote } from "@/lib/notes/actions";
import { MAX_NOTE_CHARS } from "@/lib/notes/rules";

type Project = { id: string; name: string };

// 画像は選んだらすぐに上げ始める（保存を 1 回押すだけにするため）。上げ終わる前に保存を押したら、上げ終わるのを待つ
type Picked = { previewUrl: string; upload: Promise<{ id: string } | { error: string }>; id: string | null; error: string | null };

// メモを書いて残すフォーム（「＋ メモ」と、ほかのアプリからの共有で使う。docs/architecture.md の 4.26）
export function NoteForm({
  projects,
  projectId: fixedProjectId,
  initialProjectId,
  initialBody = "",
  initialFile = null,
  notice,
  autoFocus = true,
  onSaved,
  onCancel,
}: {
  // プロジェクトの外から開いたときは選ぶ。中から開いたときは projectId を渡す
  projects: Project[];
  projectId?: string;
  // 選ぶときの最初の選択
  initialProjectId?: string;
  initialBody?: string;
  initialFile?: File | null;
  notice?: string;
  autoFocus?: boolean;
  onSaved: (projectId: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [projectId, setProjectId] = useState(fixedProjectId ?? initialProjectId ?? (projects.length === 1 ? projects[0].id : ""));
  const [picked, setPicked] = useState<Picked | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const pickedRef = useRef<Picked | null>(null);

  function pick(file: File) {
    drop();
    const p: Picked = { previewUrl: URL.createObjectURL(file), upload: Promise.resolve({ error: "" }), id: null, error: null };
    p.upload = uploadImageFile(file).then(
      (img) => {
        p.id = img.id;
        // 上げている間に外されていたら、すぐに消す
        if (pickedRef.current !== p) void discardImage(img.id);
        else setPicked({ ...p });
        return { id: img.id };
      },
      (e: unknown) => {
        p.error = e instanceof Error ? e.message : "画像を追加できませんでした。";
        if (pickedRef.current === p) setPicked({ ...p });
        return { error: p.error };
      },
    );
    pickedRef.current = p;
    setPicked(p);
  }

  // 選んだ画像を外す（上げ終わっていれば、すぐに消す）
  function drop() {
    const p = pickedRef.current;
    if (!p) return;
    URL.revokeObjectURL(p.previewUrl);
    if (p.id) void discardImage(p.id);
    pickedRef.current = null;
    setPicked(null);
  }

  // 共有で受け取った画像（開いたときに 1 回だけ上げる）
  const initialFileRef = useRef(initialFile);
  useEffect(() => {
    const f = initialFileRef.current;
    initialFileRef.current = null;
    if (f) pick(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに 1 回だけ
  }, []);

  // やめたら、上げた画像をすぐに消す（Esc などで閉じたときは、翌日の片付けで消える。4.18）
  function cancel() {
    drop();
    onCancel();
  }

  async function save() {
    setError(null);
    if (!projectId) return setError("どのプロジェクトのメモか選んでください。");
    if (!body.trim() && !picked) return setError("ひとこと書くか、画像を選んでください。");
    setSaving(true);
    let mediaId: string | null = null;
    if (picked) {
      const r = await picked.upload;
      if ("error" in r) {
        setSaving(false);
        return setError(`${r.error} 画像を外せば、文だけで残せます。`);
      }
      mediaId = r.id;
    }
    const res = await saveNote(projectId, body, mediaId);
    setSaving(false);
    if (res.error) return setError(res.error);
    if (picked) URL.revokeObjectURL(picked.previewUrl);
    onSaved(projectId);
  }

  const uploading = Boolean(picked && !picked.id && !picked.error);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {notice && <p className="text-sm leading-[1.7] text-muted">{notice}</p>}
      {!fixedProjectId && projects.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-project`} className="text-[14px] font-bold">
            どのプロジェクトのメモか
          </label>
          <select
            id={`${id}-project`}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-md border border-input bg-surface px-3 py-2.5 text-base text-fg outline-none focus:border-primary max-sm:text-[16px]"
          >
            <option value="">選んでください</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <label htmlFor={`${id}-body`} className="sr-only">
        メモ
      </label>
      <textarea
        id={`${id}-body`}
        rows={4}
        // 開いてすぐ書けるように（数秒で残すため）
        autoFocus={autoFocus}
        maxLength={MAX_NOTE_CHARS}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // PC は Ctrl / ⌘ + Enter でも保存できる
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="例: 朝の通勤中に、家計簿をつけ忘れたことに気づいた。通知の時間を選べたらいいのに"
        className="w-full resize-y rounded-md border border-input bg-surface px-3.5 py-3 text-base leading-[1.7] text-fg outline-none placeholder:text-muted focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = "";
        }}
      />
      {picked ? (
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface2 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- 選んだファイルのその場のプレビュー */}
          <img src={picked.previewUrl} alt="選んだ画像" className="size-14 shrink-0 rounded-sm object-cover" />
          <span className="min-w-0 flex-1 text-xs leading-[1.6] text-muted">
            {picked.error ? <span className="font-semibold text-danger">{picked.error}</span> : uploading ? "画像を上げています…" : "画像を添えました（撮った場所などの情報は消します）"}
          </span>
          <button type="button" onClick={drop} className="shrink-0 px-2 text-sm text-muted hover:text-fg hover:underline">
            外す
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} className="w-fit text-sm font-semibold text-primary hover:underline">
          ＋ 写真・スクリーンショットを添える（1 枚）
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? (uploading ? "画像を上げています…" : "保存しています…") : "ネタ帳に保存する"}
        </Button>
        <Button type="button" variant="text" onClick={cancel} disabled={saving}>
          やめる
        </Button>
      </div>
    </form>
  );
}
