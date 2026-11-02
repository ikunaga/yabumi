"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { VoiceInputButton } from "@/components/ui/voice-input";
import { discardImage } from "@/lib/media/actions";
import { uploadImageFile } from "@/lib/media/client-upload";
import { saveNote } from "@/lib/notes/actions";
import { clearDraft, readDraft, saveFailureMessage, writeDraft } from "@/lib/notes/draft";
import { MAX_NOTE_CHARS } from "@/lib/notes/rules";

type Project = { id: string; name: string };

// 画像は選んだらすぐに上げ始める（保存を 1 回押すだけにするため）。上げ終わる前に保存を押したら、上げ終わるのを待つ
type Picked = { previewUrl: string; upload: Promise<{ id: string } | { error: string }>; id: string | null; error: string | null };

// メモを書いて残すフォーム（「＋ メモ」と、ほかのアプリからの共有で使う。docs/architecture.md の 4.26）。
// 書いた本文は保存できるまでこの端末に控える（src/lib/notes/draft.ts）。閉じても次に開いたときに戻し、
// 保存に失敗したら本文を残したまま目立つ形で知らせる。控えを消すのは、保存できたときと「捨てる」を選んだときだけ
export function NoteForm({
  projects,
  projectId: fixedProjectId,
  initialProjectId,
  initialBody = "",
  initialFile = null,
  notice,
  noticeRestored = false,
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
  // notice が「保存していないメモがあります」のときは、目立つ形で出す
  noticeRestored?: boolean;
  autoFocus?: boolean;
  // imageSkipped: 本文だけで残し、画像は添えられなかった（知らせに書く）
  onSaved: (projectId: string, info: { imageSkipped: boolean }) => void;
  onCancel: () => void;
}) {
  // 書きかけの控え（開いたときに 1 回だけ読む）。共有で受け取ったものは、受け取る側（ShareReceiver）が控えに足してから渡す
  const [restored] = useState(() => (typeof window === "undefined" ? null : readDraft()));
  const restoredProject = restored?.projectId && projects.some((p) => p.id === restored.projectId) ? restored.projectId : null;
  const [body, setBody] = useState(restored && !initialBody ? restored.body : initialBody);
  const [projectId, setProjectId] = useState(
    (restored && !initialBody ? restoredProject : null) ?? fixedProjectId ?? initialProjectId ?? (projects.length === 1 ? projects[0].id : ""),
  );
  // 控えの保存先が、いま開いているプロジェクトと違うときは、保存先を選べるようにする（黙って別のプロジェクトに入れない）
  const choosable = !fixedProjectId || projectId !== fixedProjectId;
  const [reload, setReload] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
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

  function changeBody(next: string) {
    setBody(next);
    setConfirmDiscard(false);
    writeDraft(next, projectId || null);
  }

  // やめたら、上げた画像をすぐに消す（Esc などで閉じたときは、翌日の片付けで消える。4.18）。
  // 書いた本文があれば、捨ててよいかをその場で確かめる（確かめずに捨てない）
  function cancel() {
    if (body.trim() && !confirmDiscard) return setConfirmDiscard(true);
    clearDraft();
    drop();
    onCancel();
  }

  async function save() {
    setError(null);
    if (!projectId) return setError("どのプロジェクトのメモか選んでください。");
    if (!body.trim() && !picked) return setError("ひとこと書くか、画像を選んでください。");
    setSaving(true);
    let mediaId: string | null = null;
    setReload(false);
    setConfirmDiscard(false);
    writeDraft(body, projectId);
    if (picked) {
      const r = await picked.upload;
      if ("error" in r) {
        setSaving(false);
        return setError(`${r.error} 画像を外せば、文だけで残せます。`);
      }
      mediaId = r.id;
    }
    // 通信が切れていると、Next.js はつながるまで待ち続ける（押しても何も起きないように見える）ので、先に確かめる
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSaving(false);
      return setError(saveFailureMessage(null, false).message);
    }
    let res: Awaited<ReturnType<typeof saveNote>>;
    try {
      res = await saveNote(projectId, body, mediaId);
    } catch (e) {
      console.error("[NoteForm.save]", e);
      const f = saveFailureMessage(e, navigator.onLine !== false);
      setSaving(false);
      setReload(f.reload);
      return setError(f.message);
    }
    setSaving(false);
    if (res.error) return setError(`${res.error} 書いた内容はこの端末に残しています。`);
    clearDraft();
    if (picked) URL.revokeObjectURL(picked.previewUrl);
    onSaved(projectId, { imageSkipped: Boolean(res.imageSkipped) });
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
      {restored && !initialBody ? (
        <p role="status" className="rounded-md border border-line bg-surface2 px-3 py-2 text-sm leading-[1.7]">
          <span className="font-semibold">保存していないメモがあります。</span>前に書きかけたものを戻しました。保存するか、いらなければ「やめる」で捨ててください。
        </p>
      ) : noticeRestored && notice ? (
        <p role="status" className="rounded-md border border-line bg-surface2 px-3 py-2 text-sm leading-[1.7] font-semibold">
          {notice}
        </p>
      ) : (
        notice && <p className="text-sm leading-[1.7] text-muted">{notice}</p>
      )}
      {!choosable && (
        <p className="text-sm text-muted">
          保存先: <b className="text-fg">{projects.find((p) => p.id === fixedProjectId)?.name ?? "このプロジェクト"}</b>
        </p>
      )}
      {choosable && projects.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-project`} className="text-[14px] font-bold">
            どのプロジェクトのメモか
          </label>
          <select
            id={`${id}-project`}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              writeDraft(body, e.target.value || null);
            }}
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
        ref={bodyRef}
        rows={4}
        // 開いてすぐ書けるように（数秒で残すため）
        autoFocus={autoFocus}
        maxLength={MAX_NOTE_CHARS}
        value={body}
        onChange={(e) => changeBody(e.target.value)}
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
      <VoiceInputButton target={bodyRef} label="メモ" onChange={changeBody} />

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
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-sm leading-[1.7] font-semibold text-danger">
          <p>{error}</p>
          {reload && (
            <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => window.location.reload()}>
              読み込み直す
            </Button>
          )}
        </div>
      )}

      {confirmDiscard ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-line bg-surface2 px-3 py-2.5">
          <p className="text-sm font-semibold">書いたメモを捨てますか？ 捨てると戻せません。</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="danger" size="sm" onClick={cancel}>
              捨てる
            </Button>
            <Button type="button" variant="text" size="sm" onClick={() => setConfirmDiscard(false)}>
              書き続ける
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? (uploading ? "画像を上げています…" : "保存しています…") : "ネタ帳に保存する"}
          </Button>
          <Button type="button" variant="text" onClick={cancel} disabled={saving}>
            やめる
          </Button>
        </div>
      )}
    </form>
  );
}
