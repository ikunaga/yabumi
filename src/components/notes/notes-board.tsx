"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Button, ButtonLink, NotReadyButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { discardImage } from "@/lib/media/actions";
import { uploadImageFile } from "@/lib/media/client-upload";
import { draftFromNote, editNote, removeNote } from "@/lib/notes/actions";
import { MAX_NOTE_CHARS, MAX_NOTES_FOR_IDEAS, type IdeaNote } from "@/lib/notes/rules";
import { formatShort } from "@/lib/time";
import { NoteForm } from "./note-form";

type Tab = "unused" | "used";

// 空のネタ帳に出す例（素人が「何を書けばいいか」をつかめるように）
const EXAMPLES = ["通知の時間を選べたらいいのに、と朝の電車で思った", "友だちに見せたら「グラフが見にくい」と言われた", "3 日かかった不具合が、1 行の直しで消えた"];

// ネタ帳の画面（docs/architecture.md の 4.26）。新しい順。「まだ使っていない」「投稿にした」で分ける
export function NotesBoard({ projectId, projectName, notes, aiEnabled }: { projectId: string; projectName: string; notes: IdeaNote[]; aiEnabled: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("unused");
  const [writing, setWriting] = useState(false);
  const [round, setRound] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const unused = notes.filter((n) => !n.usedAt);
  const used = notes.filter((n) => n.usedAt);
  const shown = tab === "unused" ? unused : used;
  const picked = selected.filter((id) => unused.some((n) => n.id === id));

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_NOTES_FOR_IDEAS ? cur : [...cur, id]));
  }

  const tabClass = (on: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm font-semibold ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-fg hover:border-primary"}`;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      {flash && (
        <p role="status" className="rounded-md border border-success bg-success-soft px-4 py-3 text-[14px] font-semibold text-success">
          {flash}
        </p>
      )}

      <section className="rounded-lg border border-border bg-surface p-5 max-sm:p-4" aria-label="メモを書く">
        {writing ? (
          <NoteForm
            key={round}
            projects={[{ id: projectId, name: projectName }]}
            projectId={projectId}
            onSaved={() => {
              setWriting(false);
              setRound((r) => r + 1);
              setTab("unused");
              setFlash("ネタ帳に残しました");
              router.refresh();
            }}
            onCancel={() => setWriting(false)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              onClick={() => {
                setFlash(null);
                setWriting(true);
              }}
            >
              ＋ メモを書く
            </Button>
            <span className="text-sm text-muted">どの画面でも、右下（PC は左のメニュー）の「＋ メモ」から残せます</span>
          </div>
        )}
      </section>

      {notes.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            title="まだメモがありません"
            description={
              <>
                思いついたことや、あったことを 1 行で残しておくと、あとで AI が投稿にします。きれいな文でなくて大丈夫です。たとえば:
                <span className="mt-2 flex flex-col gap-1">
                  {EXAMPLES.map((e) => (
                    <span key={e} className="text-fg">
                      「{e}」
                    </span>
                  ))}
                </span>
              </>
            }
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="メモの絞り込み">
            <button type="button" aria-pressed={tab === "unused"} onClick={() => setTab("unused")} className={tabClass(tab === "unused")}>
              まだ使っていない（{unused.length}）
            </button>
            <button type="button" aria-pressed={tab === "used"} onClick={() => setTab("used")} className={tabClass(tab === "used")}>
              投稿にした（{used.length}）
            </button>
          </div>

          {tab === "unused" && unused.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface2 px-4 py-3 text-sm leading-[1.7]">
              <p>
                メモを選んで「AI とネタを出す」を押すと、AI が投稿の柱と口調に沿って、投稿のネタと下書きを出します（{MAX_NOTES_FOR_IDEAS} 件まで。AI に送るのは選んだメモの文だけで、画像は送りません）。
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {aiEnabled ? (
                  picked.length ? (
                    <ButtonLink size="sm" href={`/projects/${projectId}/ideas?source=notes&notes=${picked.join(",")}`}>
                      選んだ {picked.length} 件で AI とネタを出す
                    </ButtonLink>
                  ) : (
                    <Button size="sm" disabled>
                      AI とネタを出す
                    </Button>
                  )
                ) : (
                  <NotReadyButton size="sm">AI とネタを出す</NotReadyButton>
                )}
                {picked.length > 0 && (
                  <button type="button" onClick={() => setSelected([])} className="text-sm text-muted hover:text-fg hover:underline">
                    選ぶのをやめる
                  </button>
                )}
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-sm text-muted">{tab === "unused" ? "まだ使っていないメモはありません。" : "投稿にしたメモはまだありません。"}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {shown.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  projectId={projectId}
                  selectable={tab === "unused"}
                  selected={picked.includes(n.id)}
                  selectFull={picked.length >= MAX_NOTES_FOR_IDEAS}
                  onToggle={() => toggle(n.id)}
                  onDone={(msg) => {
                    setFlash(msg);
                    router.refresh();
                  }}
                />
              ))}
            </ol>
          )}
        </>
      )}

      <ShareHelp />
    </div>
  );
}

function NoteCard({
  note,
  projectId,
  selectable,
  selected,
  selectFull,
  onToggle,
  onDone,
}: {
  note: IdeaNote;
  projectId: string;
  selectable: boolean;
  selected: boolean;
  selectFull: boolean;
  onToggle: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const checkId = useId();

  function run(fn: () => Promise<{ error?: string }>, message: string | null) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r?.error) return setError(r.error);
      setMode("view");
      if (message) onDone(message);
    });
  }

  return (
    <li className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 ${selected ? "border-primary" : "border-border"}`}>
      <div className="flex items-start gap-3">
        {selectable && mode === "view" && (
          <input
            id={checkId}
            type="checkbox"
            checked={selected}
            disabled={!selected && selectFull}
            onChange={onToggle}
            className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
            aria-label="AI とネタを出すメモに選ぶ"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <time dateTime={note.createdAt}>{formatShort(note.createdAt)}</time>
            {note.usedAt && (
              <span className="font-bold text-success">
                ✓ 投稿にした（{formatShort(note.usedAt)}）
              </span>
            )}
            {note.usedAt &&
              (note.postId ? (
                <Link href={`/projects/${projectId}/posts/${note.postId}`} className="font-semibold text-primary hover:underline">
                  投稿を開く
                </Link>
              ) : (
                <span>投稿は削除済み</span>
              ))}
          </div>
          {mode === "edit" ? (
            <NoteEditor note={note} projectId={projectId} onCancel={() => setMode("view")} onSaved={() => (setMode("view"), onDone("メモを直しました"))} />
          ) : (
            <div className="flex gap-3">
              {note.body ? (
                selectable ? (
                  <label htmlFor={checkId} className="min-w-0 flex-1 cursor-pointer text-[15px] leading-[1.8] break-words whitespace-pre-wrap">
                    {note.body}
                  </label>
                ) : (
                  <p className="min-w-0 flex-1 text-[15px] leading-[1.8] break-words whitespace-pre-wrap">{note.body}</p>
                )
              ) : (
                <p className="min-w-0 flex-1 text-sm text-muted">（画像だけのメモ）</p>
              )}
              {note.image?.previewUrl && (
                <a href={note.image.previewUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 署名つきの URL は期限があり、next/image の最適化を通さない */}
                  <img src={note.image.previewUrl} alt="メモに添えた画像" className="size-20 rounded-md border border-line object-cover max-sm:size-16" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {mode === "view" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="sm" variant="secondary" disabled={pending || !note.body} onClick={() => run(() => draftFromNote(projectId, note.id), null)}>
            {pending ? "下書きにしています…" : note.usedAt ? "もう一度下書きにする" : "下書きにする"}
          </Button>
          <button type="button" onClick={() => setMode("edit")} disabled={pending} className="text-sm font-semibold text-primary hover:underline">
            直す
          </button>
          <button type="button" onClick={() => setMode("confirm-delete")} disabled={pending} className="text-sm text-muted hover:text-fg hover:underline">
            削除する
          </button>
        </div>
      )}
      {mode === "confirm-delete" && (
        <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm">
          <p className="font-semibold text-danger">このメモを削除しますか？ 添えた画像も消えます（このメモから作った投稿は残ります）。</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => removeNote(projectId, note.id), "メモを削除しました")}>
              {pending ? "削除しています…" : "削除する"}
            </Button>
            <Button size="sm" variant="text" disabled={pending} onClick={() => setMode("view")}>
              やめる
            </Button>
          </div>
        </div>
      )}
      {!note.body && mode === "view" && <p className="text-xs text-muted">画像だけのメモは、「直す」でひとこと書くと下書きにできます。</p>}
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

// メモを直す（本文と画像）
function NoteEditor({ note, projectId, onCancel, onSaved }: { note: IdeaNote; projectId: string; onCancel: () => void; onSaved: () => void }) {
  const [body, setBody] = useState(note.body);
  // keep: いまの画像のまま / null: 外す / { id, url }: 新しい画像に替える
  const [image, setImage] = useState<"keep" | null | { id: string; url: string }>(note.image ? "keep" : null);
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  async function pick(file: File) {
    setError(null);
    setBusy("upload");
    try {
      const img = await uploadImageFile(file);
      if (image && image !== "keep") void discardImage(image.id);
      setImage({ id: img.id, url: URL.createObjectURL(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像を追加できませんでした。");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setBusy("save");
    const r = await editNote(projectId, note.id, body, image === "keep" ? "keep" : image ? image.id : null);
    setBusy(null);
    if (r.error) return setError(r.error);
    onSaved();
  }

  const preview = image === "keep" ? note.image?.previewUrl : image?.url;

  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor={`${id}-body`} className="sr-only">
        メモ
      </label>
      <textarea
        id={`${id}-body`}
        rows={4}
        maxLength={MAX_NOTE_CHARS}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full resize-y rounded-md border border-input bg-surface px-3.5 py-3 text-base leading-[1.7] text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- プレビュー
          <img src={preview} alt="メモに添えた画像" className="size-14 rounded-md border border-line object-cover" />
        )}
        <button type="button" disabled={busy !== null} onClick={() => inputRef.current?.click()} className="font-semibold text-primary hover:underline">
          {busy === "upload" ? "画像を上げています…" : preview ? "画像を替える" : "＋ 画像を添える"}
        </button>
        {preview && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              if (image && image !== "keep") void discardImage(image.id);
              setImage(null);
            }}
            className="text-muted hover:text-fg hover:underline"
          >
            画像を外す
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy !== null} onClick={() => void save()}>
          {busy === "save" ? "保存しています…" : "保存する"}
        </Button>
        <Button
          size="sm"
          variant="text"
          disabled={busy !== null}
          onClick={() => {
            if (image && image !== "keep") void discardImage(image.id);
            onCancel();
          }}
        >
          やめる
        </Button>
      </div>
    </div>
  );
}

// ほかのアプリから送る方法（Android は共有、iPhone はショートカット、PC はブックマークレット）
function ShareHelp() {
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
  // React は javascript: のリンクを書き出さないので、ブックマークレットは描いたあとに付ける
  const linkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    linkRef.current?.setAttribute(
      "href",
      `javascript:location.href='${origin}/share#title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(String(getSelection()))`,
    );
  }, [origin]);
  return (
    <details className="rounded-lg border border-border bg-surface px-5 py-4 text-sm leading-[1.8] max-sm:px-4">
      <summary className="cursor-pointer font-bold">ほかのアプリから、ネタ帳に送るには</summary>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <p className="font-bold">Android</p>
          <p>
            Chrome で矢書を開き、メニューの「ホーム画面に追加」（アプリとしてインストール）をします。そのあと、ほかのアプリの「共有」で「矢書」を選ぶと、文・URL・画像 1 枚がネタ帳の新しいメモになります。
          </p>
        </div>
        <div>
          <p className="font-bold">iPhone・iPad</p>
          <p>
            Safari は、ほかのアプリの「共有」から Web のアプリに送る仕組みにまだ対応していません。代わりに「ショートカット」アプリで、共有から矢書を開く近道を作れます。
          </p>
          <ol className="mt-1 list-decimal pl-5">
            <li>ショートカットアプリで新しいショートカットを作り、「詳細」の「共有シートに表示」をオンにする（受け取るものは「テキスト」と「URL」）</li>
            <li>アクション「URL エンコード」で「ショートカットの入力」をエンコードする</li>
            <li>
              アクション「URL を開く」に <code className="rounded-sm bg-surface2 px-1 break-all">{origin}/share#text=</code> と、そのあとに「URL エンコードされたテキスト」を続けて入れる
            </li>
          </ol>
          <p className="mt-1 text-muted">画像は送れないので、写真は矢書の「＋ メモ」から選んでください。</p>
        </div>
        <div>
          <p className="font-bold">PC のブラウザ</p>
          <p>
            次のリンクをブックマークバーにドラッグすると、見ているページの題名と URL（選んだ文があればそれも）をネタ帳に送れます:{" "}
            <a ref={linkRef} className="font-semibold text-primary" onClick={(e) => e.preventDefault()}>
              矢書のネタ帳へ
            </a>
          </p>
        </div>
      </div>
    </details>
  );
}

const noopSubscribe = () => () => {};
