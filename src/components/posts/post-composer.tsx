"use client";

import { callAction } from "@/lib/client-errors";
import { DraftRestoreBar } from "@/components/ui/draft-restore";
import { clearFormDraft, parseFormDraft, rawFormDraft, writeFormDraft, type FormDraft } from "@/lib/form-draft";
import { getDraftOwner } from "@/lib/notes/draft";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";
import { VoiceInputButton } from "@/components/ui/voice-input";
import { tabClass, tabListClass } from "@/components/ui/tabs";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { deletePost, savePost, sendSavedPost } from "@/lib/posts/actions";
import { useRouter } from "next/navigation";
import { clearSending, markSending, SendProgress } from "./send-progress";
import type { SavePostResult } from "@/lib/posts/schema";
import { ShortLinkPreviewNote, ShortLinkToggle } from "@/components/links/short-link-toggle";
import type { PostLinkPreview } from "@/lib/links/store";
import { ImageAttachments, type AttachedImage } from "./image-attachments";
import { applyFix } from "@/lib/ai/ai-check";
import { AiCheckPanel } from "./ai-check-panel";
import { TidyDraftPanel } from "./tidy-draft-panel";
import { ComposeStart } from "./compose-start";
import { NotePicker, type NoteInsertMode } from "./note-picker";
import { noteImageForCompose } from "@/lib/notes/actions";
import type { IdeaNote } from "@/lib/notes/rules";
import { MAX_IMAGES_PER_POST } from "@/lib/media/rules";
import { PlanHints, type PlanHintsData } from "./plan-hints";
import { SendResults, type TargetResult } from "./send-results";
import { SnsPreview } from "./sns-preview";
import { PREVIEW, previewTabs } from "@/lib/sns/preview";
import { ISSUE_LABEL, MAX_TITLE_LENGTH, SNS, SNS_KEYS, checkTarget, hasXUrl, instagramRatioOk, ignoresImages, isManualSns, type SnsKey, type TargetIssue } from "@/lib/sns";
import { X_PRICE_USD, formatUsd } from "@/lib/sns/x/pricing";
import { Term } from "@/components/ui/term";
import { projectSettingsHref } from "@/lib/projects/paths";
import { sendLabels, sendMode } from "@/lib/posts/send-mode";
import { findUrls, hasProfileLinkLine, profileLinkLine, withProfileLink, type ProfileLinkInfo } from "@/lib/posts/profile-link";
import { BAND_INFO, plannedAtFor, type TimeBand } from "@/lib/metrics/time-bands";
import { composeChanges, type ComposeSnapshot } from "@/lib/posts/compose-reset";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export type ComposerInitial = {
  body: string;
  targets: { sns: SnsKey; bodyOverride: string | null; title?: string | null }[];
  plannedAt: string;
  images?: AttachedImage[];
  // 本文の URL を短縮リンクにするか（新しい投稿はオン。4.22、D20）
  shortLinks?: boolean;
  // ロードマップのやることから作るとき（4.23）。題と説明を、本文の下書きの手がかりとして出す
  roadmapItem?: { id: string; title: string; detail: string } | null;
};

type Props = {
  projectId: string;
  projectName: string;
  postId: string | null;
  initial: ComposerInitial;
  // つないでいて、送信もできる SNS
  connected: SnsKey[];
  // 配信先ごとの送信の状態（新しい投稿では空）
  results?: Partial<Record<SnsKey, TargetResult>>;
  notice?: string;
  noticeTone?: "success" | "error";
  // アカウント設計の投稿の柱と口調（書くときの手がかり）
  planHints?: PlanHintsData | null;
  // 画像を送るにはつなぎ直しが要る SNS（X は media.write を足す前につないだアカウント）
  needImageReconnect?: SnsKey[];
  // 保存した投稿の、配信先ごとの短縮リンク（送るときにこの URL に置き換わる）
  linkPreview?: PostLinkPreview;
  // AI っぽさチェック（F11）を使えるか（Claude API のキーがあるか）
  aiCheckEnabled?: boolean;
  // 下の数字の帯（前回の投稿・この投稿の数字。出せる数字がなければ渡さない）
  numbers?: ReactNode;
  // 日時の欄の下の「この時間帯がよく見られています（傾向）」。比べられる数がなければ null（数字の段 4）
  timeHint?: { band: TimeBand; kind: "views" | "clicks" } | null;
  // Instagram の「プロフィールのリンクから」に使う（行き先の URL と、プロフィールに置く短縮リンクがあるか。4.37）
  profileLink?: ProfileLinkInfo | null;
};

// 送信済み・送信中・取り消し済みの配信先は、選び直しも送り直しもできない
const LOCKED = new Set(["published", "preparing", "publishing", "deleted"]);

const ISSUE_TONE: Record<TargetIssue, string> = {
  bad_aspect_ratio: "text-danger",
  too_many_hashtags: "text-danger",
  empty: "text-signal",
  too_long: "text-danger",
  needs_image: "text-signal",
  needs_video: "text-signal",
  needs_title: "text-signal",
  too_many_images: "text-danger",
};

// まだ何も書いていないときの、送れない理由（朱にしない）
const QUIET_BLOCKER = "本文を書くと、予約・送信できます";

// 左（本文など）と右（SNS ごとの見え方と文面）が横に並ぶ幅か（並ばないと、右の欄は左のずっと下に来る。下の grid の max-lg）
function isSideBySide() {
  return window.matchMedia("(min-width: 64rem)").matches;
}

function formatCount(n: number) {
  return n.toLocaleString("ja-JP");
}

export function PostComposer({
  projectId,
  projectName,
  postId,
  initial,
  connected,
  results = {},
  notice,
  noticeTone = "success",
  planHints = null,
  needImageReconnect = [],
  linkPreview = {},
  aiCheckEnabled = false,
  numbers = null,
  timeHint = null,
  profileLink = null,
}: Props) {
  const [images, setImages] = useState<AttachedImage[]>(initial.images ?? []);
  const [shortLinks, setShortLinks] = useState(initial.shortLinks ?? true);
  const [body, setBody] = useState(initial.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const overrideRef = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState<Set<SnsKey>>(() => new Set(initial.targets.map((t) => t.sns)));
  const [overrides, setOverrides] = useState<Partial<Record<SnsKey, string>>>(() =>
    Object.fromEntries(initial.targets.filter((t) => t.bodyOverride !== null).map((t) => [t.sns, t.bodyOverride!])),
  );
  // 最初に見せる SNS: 文面を変えた SNS があればそれ、なければ並び順で最初に選ばれているもの。
  // 見え方と SNS ごとの文面は、送り先に選んだ SNS のタブで切り替える（選んだ SNS にない SNS を指していたら、最初のタブ。focus）
  const [picked, setFocus] = useState<SnsKey>(
    () =>
      initial.targets.find((t) => t.bodyOverride !== null)?.sns ??
      SNS_KEYS.find((s) => initial.targets.some((t) => t.sns === s)) ??
      "x",
  );
  // 長文の SNS（note・Substack）のタイトル
  const [titles, setTitles] = useState<Partial<Record<SnsKey, string>>>(() =>
    Object.fromEntries(initial.targets.filter((t) => t.title).map((t) => [t.sns, t.title!])),
  );
  const [plannedAt, setPlannedAt] = useState(initial.plannedAt);
  // AI で整えた案を使った知らせが出ているか（出ている間は、SNS ごとの文面の 1 行をその知らせにまとめる）
  const [tidyAdopted, setTidyAdopted] = useState(false);
  // Instagram の文面を「プロフィールのリンクから」にした（したことを 1 行で知らせる）
  const [igLinked, setIgLinked] = useState(false);
  const [result, setResult] = useState<SavePostResult>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // 押したボタン（押した瞬間から、そのボタンを「〜しています…」にし、ほかの操作を止める）。
  // 今すぐ送るでは、保存できたら sending に投稿の id と送る SNS を入れ、投稿の画面に移るまで進み具合を出す（4.36）
  const [busy, setBusy] = useState<"draft" | "schedule" | "now" | null>(null);
  const [sending, setSending] = useState<{ postId: string | null; sns: SnsKey[] } | null>(null);
  // 画面を移り終えたら（同じ投稿の画面に戻ってきたときも）、止めていた操作を戻す
  if (!pending && busy !== null) {
    setBusy(null);
    setSending(null);
  }
  // 「ネタ帳から」本文に入れたメモ（保存したら「投稿にした」の印を付ける）
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteIds, setNoteIds] = useState<string[]>([]);
  // まだ何も書いていない新しい投稿では、「本文がありません」などの印を出さない（書いて消したとき・保存を押したときから出す。2026-11-02 オーナーの指摘）
  const [touched, setTouched] = useState(Boolean(postId) || initial.body.trim() !== "");
  if (!touched && body.trim() !== "") setTouched(true);

  // 書きかけの控え（4.35）。本文・SNS ごとの文面・タイトルを、保存できるまでこの端末に置く。古い画面で保存できず読み込み直したときなどに戻せる。
  // 保存して移ってきた（notice がある）ときは、この投稿と「新しい投稿」の控えを消す
  const draftKey = `post:${postId ?? `new:${projectId}`}`;
  const initialDraft = useMemo<PostDraft>(
    () => ({
      body: initial.body,
      overrides: Object.fromEntries(initial.targets.filter((t) => t.bodyOverride !== null).map((t) => [t.sns, t.bodyOverride!])),
      titles: Object.fromEntries(initial.targets.filter((t) => t.title).map((t) => [t.sns, t.title!])),
    }),
    [initial],
  );
  // 開いたときに見つけた控え（戻すか捨てるかを選ぶまで、新しく書き込まない）。サーバーで描くときは undefined（まだ見ていない）
  const rawDraft = useSyncExternalStore(noopSubscribe, () => rawFormDraft(draftKey), () => undefined);
  const [found, setFound] = useState<{ draft: FormDraft<PostDraft> | null } | undefined>(undefined);
  if (found === undefined && rawDraft !== undefined) {
    const d = notice ? null : parseFormDraft<PostDraft>(rawDraft, getDraftOwner());
    setFound({ draft: d && !samePostDraft(d.value, initialDraft) ? d : null });
  }
  const restorable = found?.draft ?? null;
  const setRestorable = (d: null) => setFound({ draft: d });
  useEffect(() => {
    if (!notice) return;
    clearFormDraft(draftKey);
    clearFormDraft(`post:new:${projectId}`);
  }, [notice, draftKey, projectId]);
  useEffect(() => {
    if (!found || found.draft) return;
    const now: PostDraft = { body, overrides, titles };
    if (samePostDraft(now, initialDraft)) clearFormDraft(draftKey);
    else writeFormDraft(draftKey, now);
  }, [body, overrides, titles, found, draftKey, initialDraft]);
  function restoreDraft() {
    if (!restorable) return;
    const v = restorable.value;
    setBody(v.body);
    setOverrides(v.overrides ?? {});
    setTitles(v.titles ?? {});
    setRestorable(null);
  }
  const quiet = !touched;

  // リセット（新しい投稿）・保存した内容に戻す（下書き）。開いたときの状態と比べて、戻すと消えるものを出す（4.38）
  const [resetOpen, setResetOpen] = useState(false);
  // 押すたびに、AI の案の欄・AI っぽさチェックの欄を作り直す
  const [resetRound, setResetRound] = useState(0);
  const justReset = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const initialSnapshot = useMemo<ComposeSnapshot>(
    () => ({
      ...initialDraft,
      imageIds: (initial.images ?? []).map(imageKey),
      plannedAt: initial.plannedAt,
      targets: initial.targets.map((t) => t.sns),
      shortLinks: initial.shortLinks ?? true,
      noteIds: [],
    }),
    [initial, initialDraft],
  );
  const resetChanges = composeChanges(
    initialSnapshot,
    { body, overrides, titles, imageIds: images.map(imageKey), plannedAt, targets: [...selected], shortLinks, noteIds },
    { saved: postId !== null },
  );
  function resetAll() {
    setBody(initial.body);
    setOverrides(initialDraft.overrides);
    setTitles(initialDraft.titles);
    // まだ保存していない画像は、外したときと同じく翌日の片付けで消える（4.18）
    setImages(initial.images ?? []);
    setPlannedAt(initial.plannedAt);
    setSelected(new Set(initial.targets.map((t) => t.sns)));
    setShortLinks(initial.shortLinks ?? true);
    setNoteIds([]);
    setTidyAdopted(false);
    setIgLinked(false);
    setResult({});
    setConfirmSend(false);
    setConfirmDelete(false);
    setTouched(Boolean(postId) || initial.body.trim() !== "");
    setResetRound((r) => r + 1);
    // 書きかけの控えも消す（「戻す」の帯も閉じる）
    clearFormDraft(draftKey);
    setRestorable(null);
    justReset.current = true;
    setResetOpen(false);
  }

  const textFor = (sns: SnsKey) => overrides[sns] ?? body;
  const checks = useMemo(
    () =>
      Object.fromEntries(
        SNS_KEYS.map((sns) => [sns, checkTarget(sns, overrides[sns] ?? body, { images: images.length, videos: 0, sizes: images }, titles[sns] ?? null)]),
      ) as Record<SnsKey, ReturnType<typeof checkTarget>>,
    [body, overrides, titles, images],
  );

  const isLocked = (s: SnsKey) => LOCKED.has(results[s]?.status ?? "");
  // 1 つでも送った（送信中・取り消し済みを含む）投稿
  const sentAny = SNS_KEYS.some((s) => isLocked(s));
  const chosen = SNS_KEYS.filter((s) => selected.has(s));
  const { tabs: previewSns, active: focus } = previewTabs(chosen, picked);

  // AI っぽさチェックの直しを当てる。SNS ごとの文面があればそれを、なければ共通の本文を直す
  function applyCheckFix(sns: SnsKey, quote: string, fix: string): boolean {
    const current = overrides[sns] ?? body;
    const next = applyFix(current, quote, fix);
    if (next === null) return false;
    if (overrides[sns] !== undefined) setOverrides((o) => ({ ...o, [sns]: next }));
    else setBody(next);
    return true;
  }
  // これから送る SNS（投稿済みなどを除く）
  const toSend = chosen.filter((s) => !isLocked(s));
  // つないでいない SNS（手で投稿する SNS は、つながなくてよい）。送れない理由のときは、つなぐ画面へのリンクも出す
  const missingConnect = toSend.filter((s) => !isManualSns(s) && !connected.includes(s));
  const missingConnectMessage = `${missingConnect.map((s) => SNS[s].label).join("・")} をつなぐと送れます`;
  // 送れない理由（最初の 1 つ）。日時は予約のときだけ要る
  const sendBlocker = (() => {
    if (chosen.length === 0) return "送り先の SNS を選んでください";
    if (toSend.length === 0) return "選んだ SNS にはすべて投稿済みです";
    if (quiet) return QUIET_BLOCKER;
    for (const s of toSend) {
      const issue = checks[s].issues[0];
      if (issue) return `${SNS[s].label}: ${ISSUE_LABEL[issue]}`;
    }
    // 手で投稿する SNS は、つながなくてよい
    if (missingConnect.length) return missingConnectMessage;
    const reconnect = images.length > 0 ? toSend.filter((s) => needImageReconnect.includes(s)) : [];
    if (reconnect.length) return `${reconnect.map((s) => SNS[s].label).join("・")} に画像を送るには、つなぎ直しが要ります`;
    return null;
  })();
  const blocker = sendBlocker ?? (plannedAt ? null : "送る日時を決めてください");
  // 今すぐ送れるのは、自動で送る SNS だけ
  const nowBlocker =
    sendBlocker ?? (toSend.some((s) => !isManualSns(s)) ? null : "note・Substack は手で投稿します。予約するか下書きに保存すると、投稿の画面から手で投稿できます");

  // 直し始めたら、その欄のエラーは消す
  function clearFieldError(key: keyof NonNullable<SavePostResult["fieldErrors"]>) {
    setResult((r) => (r.fieldErrors?.[key] ? { ...r, fieldErrors: { ...r.fieldErrors, [key]: undefined } } : r));
  }

  function toggle(sns: SnsKey) {
    if (isLocked(sns)) return;
    clearFieldError("targets");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sns)) next.delete(sns);
      else next.add(sns);
      return next;
    });
    setFocus(sns);
  }

  // メモを本文に入れる。写真があれば、投稿の画像として写して添える
  async function pickNote(note: IdeaNote, mode: NoteInsertMode): Promise<string | null> {
    const text = note.body.trim();
    if (text) setBody((b) => (mode === "replace" || !b.trim() ? text : `${b.trimEnd()}\n\n${text}`));
    setNoteIds((ids) => (mode === "replace" ? [note.id] : [...ids, note.id]));
    clearFieldError("body");
    if (!note.image) return null;
    if (images.length >= MAX_IMAGES_PER_POST) return `画像は ${MAX_IMAGES_PER_POST} 枚までなので、メモの写真は添えませんでした（本文は入れました）。`;
    const r = await noteImageForCompose(projectId, note.id);
    if (r.error) return `${r.error}（本文は入れました）`;
    if (r.image) setImages((prev) => [...prev, r.image!]);
    return null;
  }

  // Instagram 用の文面を作り（なければ本文から写す）、URL を外して最後に「▶︎ 〇〇はプロフィールのリンクから」を入れる。
  // PC は右に Instagram のタブを開いて見せる。スマホは下の欄へは飛ばさず、知らせの「Instagram 用の文面を直す」から
  function applyProfileLink() {
    const current = overrides.instagram ?? body;
    const line = profileLinkLine({ productType: profileLink?.productType, destinations: profileLink?.destinations, url: findUrls(current)[0] ?? null });
    setOverrides((o) => ({ ...o, instagram: withProfileLink(o.instagram ?? body, line) }));
    setIgLinked(true);
    if (isSideBySide()) setFocus("instagram");
  }

  // 本文の欄へ行く（AI で整えた案を使ったあとの「本文を見る」）。カーソルはマウスで使う画面だけ置く（スマホで鍵盤が開かないように）
  function showBody() {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) el.focus({ preventScroll: true });
  }

  // SNS ごとの文面の欄へ行く（そのタブを開いてから、欄を見える位置にしてカーソルを置く）
  function editOverride(sns: SnsKey) {
    flushSync(() => setFocus(sns));
    const el = overrideRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }

  function submit(intent: "draft" | "schedule" | "now") {
    setTouched(true);
    setResult({});
    setConfirmSend(false);
    setBusy(intent);
    // 自動で送る SNS（note・Substack は手で投稿するので、ここでは送らない）
    const autoSns = toSend.filter((s) => !isManualSns(s));
    if (intent === "now") setSending({ postId: null, sns: autoSns });
    startTransition(async () => {
      const out = await callAction(() => savePost({
        projectId,
        postId,
        body,
        plannedAt,
        intent,
        media: images.map((i) => ({ id: i.id, altText: i.altText })),
        shortLinks,
        roadmapItemId: initial.roadmapItem?.id ?? null,
        noteIds,
        targets: chosen.map((sns) => ({ sns, bodyOverride: overrides[sns] ?? null, title: SNS[sns].needsTitle ? (titles[sns] ?? null) : null })),
      }), "書いた内容は残しています。");
      const sendPostId = out.ok ? out.value?.sendPostId : undefined;
      if (sendPostId) {
        // 保存できた。続けて送る（送り終えると、サーバーが投稿の画面に移す。移るまで進み具合を出したまま）
        setSending({ postId: sendPostId, sns: autoSns });
        markSending(sendPostId);
        await callAction(() => sendSavedPost(projectId, sendPostId));
        // ここに来るのは、送る呼び出しが失敗したとき（通信が切れたなど）。投稿は保存済みで、送信ジョブ（1 分ごと）が送るので、
        // 同じ投稿を二重に作らないよう、投稿の画面に移って結果を見てもらう
        router.push(`/projects/${projectId}/posts/${sendPostId}?done=sending`);
        return;
      }
      // 成功時はサーバーで画面を移るので、ここに来るのは失敗したときだけ。古い画面・通信が切れているときも、書いた内容は消さずに理由を出す（4.35）
      if (!out.ok) setResult({ error: out.failure.message });
      else if (out.value) setResult(out.value);
    });
  }

  // 今すぐ送っている間に画面を離れようとしたら確かめる（閉じる・読み込み直す・yabumi の中のリンク）。
  // 離れても、保存した投稿は送信ジョブが送る。二重には送らない（claim_due_targets が同じ配信先を 2 回取り出さない）
  useEffect(() => {
    if (busy !== "now") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      if (!window.confirm("送っている途中です。画面を離れても送信は続き、結果は投稿の画面で確かめられます。離れますか？")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [busy]);

  // 今すぐ送ったあと、この投稿の画面に移り終えたら、移る間の知らせの目印を消す
  useEffect(() => {
    if (postId) clearSending(postId);
  }, [postId]);

  // 保存・送信のあとに移ってきたら（?done=…）、上の知らせと送信の結果が見えるように、いちばん上に戻す
  useEffect(() => {
    if (notice) window.scrollTo({ top: 0 });
  }, [notice]);

  const fe = result.fieldErrors ?? {};
  const focusLabel = SNS[focus].label;
  const hasOverride = overrides[focus] !== undefined;
  // SNS ごとの文面で送る SNS（送り終えたものは除く）
  const splitSns = toSend.filter((s) => overrides[s] !== undefined);
  // 本文の欄の字数は、本文で送る SNS で数える（いま見ている SNS が SNS ごとの文面なら、本文で送るほかの SNS で。なければそのまま）
  const bodySns = overrides[focus] === undefined ? focus : (previewSns.find((s) => overrides[s] === undefined) ?? focus);
  const connectHref = projectSettingsHref(projectId, "sns");
  const plannedLabel = plannedAt ? `${Number(plannedAt.slice(5, 7))}/${Number(plannedAt.slice(8, 10))} ${plannedAt.slice(11, 16)}` : null;

  // 送り先ごとの状態（スマホの行の右と、PC のチップの下の注意に出す）
  function targetState(sns: SnsKey): { text: string; tone: string } | null {
    const on = selected.has(sns);
    const sent = results[sns];
    const issue = checks[sns].issues[0];
    if (on && sent && sent.status !== "pending") return TARGET_STATE[sent.status] ?? null;
    if (on && sent?.status === "pending" && sent.errorMessage) return { text: "送り直し待ち", tone: "font-bold text-signal" };
    if (!on) return { text: isManualSns(sns) ? "手で投稿" : "オフ", tone: "text-faint" };
    if (quiet) return null;
    if (issue) return { text: ISSUE_LABEL[issue], tone: `font-bold ${ISSUE_TONE[issue]}` };
    if (isManualSns(sns)) return { text: "手で投稿", tone: "text-muted" };
    if (connected.includes(sns)) return { text: "OK", tone: "font-bold text-success" };
    return { text: "つないでいない", tone: "font-bold text-signal" };
  }
  const countText = (sns: SnsKey) => {
    const c = checks[sns];
    return c.maxLength ? `${formatCount(c.length)}/${formatCount(c.maxLength)}` : formatCount(c.length);
  };
  // PC はチップの下に、選んだ SNS のうち OK でないものだけを出す
  const warnings = chosen
    .map((sns) => ({ sns, state: targetState(sns) }))
    .filter((w) => w.state && w.state.text !== "OK" && !TARGET_STATE_TEXTS.has(w.state.text));

  const mode = sendMode({ sentAny, toSend: toSend.length });
  const labels = sendLabels(mode, toSend.length);
  const sentLabels = chosen.filter((s) => isLocked(s)).map((s) => SNS[s].label).join("・");

  // 削除する（確かめてから）。送った投稿では、SNS の投稿は消えず yabumi の記録だけが消えることを書く
  const deleteRow = (sent: boolean) => {
    if (!postId) return null;
    return confirmDelete ? (
      <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
        {sent && <span className="text-[13px] text-muted">SNS の投稿は消えません。</span>}
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const out = await callAction(() => deletePost(projectId, postId));
              const message = out.ok ? out.value?.error : out.failure.message;
              if (message) {
                setResult({ error: message });
                setConfirmDelete(false);
              }
            })
          }
        >
          本当に削除する
        </Button>
        <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>
          やめる
        </Button>
      </span>
    ) : (
      <Button type="button" variant="text" size="sm" className="ml-auto" onClick={() => setConfirmDelete(true)}>
        {sent ? "yabumi から削除する" : "削除する"}
      </Button>
    );
  };

  return (
    <>
      {/* 止めている間は画面が読み上げの対象から外れるので、進み具合はここで知らせる */}
      <p className="sr-only" role="status" aria-live="polite">
        {busy === "now" ? "送っています。数秒から数十秒かかります。このまま待ってください。" : busy === "schedule" ? "予約しています。" : busy === "draft" ? "保存しています。" : ""}
      </p>
      {/* 保存・送信を押したら、画面に移るか失敗が返るまで、本文の編集・送り先の変更などを止める（押せない・打てない） */}
      <div className="flex flex-col gap-4" inert={busy !== null || undefined} aria-busy={busy !== null || undefined}>
      {/* 見出し。新しい投稿は、自分で書くか AI とネタを出すかの札を横に並べる（AI を使わなくても書いて送れることがわかるように） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[26px] font-bold max-sm:text-[22px]">{postId ? (sentAny ? "送った投稿" : "下書き") : "投稿をつくる"}</h1>
        {!postId && <ComposeStart projectId={projectId} aiEnabled={aiCheckEnabled} notesOpen={notesOpen} onNotes={() => setNotesOpen((o) => !o)} />}
        {postId && <span className="text-[15px] text-faint">{sentAny ? "送った SNS は選び直せません" : "保存済み"}</span>}
      </div>

      {/* 保存・送信の知らせと、送信の結果（送ったあとはこの投稿の画面に移り、ここに結果が出る） */}
      {notice && (noticeTone === "error" ? <ErrorBanner>{notice}</ErrorBanner> : <SuccessBanner>{notice}</SuccessBanner>)}
      {postId && <SendResults projectId={projectId} postId={postId} results={results} />}

      {notesOpen && !postId && (
        <NotePicker projectId={projectId} bodyHasText={body.trim() !== ""} pickedIds={noteIds} onPick={pickNote} onClose={() => setNotesOpen(false)} />
      )}

      <div className="grid grid-cols-[minmax(0,1.03fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        {/* 左: 本文・送り先・短縮リンク・日時・送る */}
        <div className="flex min-w-0 flex-col gap-3">
          <section aria-labelledby="draft-heading" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="draft-heading" ref={headingRef} tabIndex={-1} className="text-[18px] font-bold outline-none max-sm:text-[16px]">
                本文
              </h2>
              <span className="flex items-baseline gap-3">
                {plannedLabel && <span className="num text-[15px] text-faint">{plannedLabel} {sentAny ? "に送信" : "予約"}</span>}
                {/* 送った投稿では出さない。何も変えていないときも出さない */}
                {!sentAny && resetChanges.length > 0 && (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setResetOpen(true)}
                    className="text-[13px] text-muted underline-offset-2 hover:text-fg hover:underline"
                  >
                    {postId ? "保存した内容に戻す" : "リセット"}
                  </button>
                )}
              </span>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {resetRound > 0 ? (postId ? "保存した内容に戻しました。" : "書いた内容をリセットしました。") : ""}
            </p>
            <ConfirmDialog
              open={resetOpen}
              title={postId ? "保存した内容に戻しますか？" : "書いた内容をリセットしますか？"}
              confirmLabel={postId ? "戻す" : "リセットする"}
              onConfirm={resetAll}
              onClose={() => {
                setResetOpen(false);
                // 押したボタンは消えるので、本文の見出しにフォーカスを置く（スマホで鍵盤が開かないよう、本文の欄には置かない）
                if (justReset.current) {
                  justReset.current = false;
                  headingRef.current?.focus({ preventScroll: true });
                }
              }}
            >
              <p>{postId ? "この画面で変えた次のものが、保存したときの内容に戻ります。" : "次のものを消して、開いたときの状態に戻します。"}</p>
              <ul className="list-disc pl-5">
                {resetChanges.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="text-[13px] text-muted">元には戻せません。</p>
            </ConfirmDialog>

            {result.error && <ErrorBanner>{result.error}</ErrorBanner>}
            {restorable && <DraftRestoreBar at={restorable.at} what="本文の書きかけ" onRestore={restoreDraft} onDiscard={() => (clearFormDraft(draftKey), setRestorable(null))} />}

            {initial.roadmapItem && (
              <RoadmapItemHint
                item={initial.roadmapItem}
                onInsert={() => {
                  const text = [initial.roadmapItem!.title, initial.roadmapItem!.detail].filter(Boolean).join("\n");
                  setBody((b) => (b.trim() ? `${b}\n\n${text}` : text));
                }}
              />
            )}

            <div
              className={`flex flex-col rounded-md border bg-surface px-4 pt-3 pb-2 ${fe.body ? "border-danger shadow-[0_0_0_1px_var(--danger)]" : "border-input focus-within:border-primary focus-within:shadow-[0_0_0_1px_var(--primary)]"}`}
            >
              <label htmlFor="post-body" className="sr-only">
                本文
              </label>
              <textarea
                id="post-body"
                ref={bodyRef}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  clearFieldError("body");
                }}
                placeholder="伝えたいことを、自分の言葉で書きます"
                aria-invalid={fe.body ? true : undefined}
                className="min-h-[148px] w-full resize-y bg-transparent text-[17px] leading-[1.75] text-fg outline-none placeholder:text-faint max-sm:min-h-[120px] max-sm:text-[16px]"
              />
              <div className="flex items-start justify-between gap-3">
                <VoiceInputButton
                  target={bodyRef}
                  label="本文"
                  onChange={(v) => {
                    setBody(v);
                    clearFieldError("body");
                  }}
                />
                <span className={`num shrink-0 pt-1.5 text-[13px] ${checks[bodySns].issues.includes("too_long") ? "font-bold text-danger" : "text-faint"}`}>
                  {bodySns !== focus && <span className="mr-1">{SNS[bodySns].label}</span>}
                  {countText(bodySns)}
                  {chosen.length > 1 && bodySns === focus && <span className="sr-only">（{focusLabel}）</span>}
                </span>
              </div>
            </div>
            {fe.body && <p className="text-sm font-semibold text-danger">{fe.body}</p>}
            {/* SNS ごとの文面がある SNS は、本文を直しても変わらない。そのことと、その欄へ行くボタンを 1 行で */}
            {splitSns.length > 0 && !tidyAdopted && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                <span>{splitSns.map((s) => SNS[s].label).join("・")} は SNS ごとの文面で送ります（本文を直しても変わりません）。</span>
                {splitSns.map((s) => (
                  <button key={s} type="button" onClick={() => editOverride(s)} className="font-semibold text-fg underline underline-offset-2">
                    {SNS[s].label} 用の文面を直す
                  </button>
                ))}
              </p>
            )}
            {/* 送り先をすべて送り終えた投稿では、整えても送れないので出さない */}
            {(!sentAny || toSend.length > 0) && (
              <TidyDraftPanel
                key={resetRound}
                projectId={projectId}
                aiEnabled={aiCheckEnabled}
                current={{ body, overrides }}
                sns={toSend}
                onReplace={(next, edit) => {
                  setBody(next.body);
                  setOverrides(next.overrides);
                  clearFieldError("body");
                  // 本文の欄へは飛ばさない（案の欄の知らせから「本文を見る」で行く）。PC は右に見え方と文面が並んでいるので、
                  // SNS ごとの文面に入れた SNS のタブを開いておく。スマホは右の欄がずっと下にあるので開かない（知らせの「X 用の文面を直す」から）
                  if (edit && isSideBySide()) setFocus(edit);
                }}
                onShowBody={showBody}
                onEditOverride={editOverride}
                onAdoptedChange={setTidyAdopted}
              />
            )}
            {noteIds.length > 0 && (
              <p className="text-[13px] text-muted">ネタ帳のメモ {noteIds.length} 件から。保存すると、ネタ帳でそのメモに「投稿にした」の印が付きます。</p>
            )}

            {/* 送り先。PC は字数つきのチップ（見本 B）、スマホは行（見本 D） */}
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">送り先の SNS</legend>
              <div className="flex flex-wrap gap-2 max-sm:hidden">
                {SNS_KEYS.map((sns) => {
                  const on = selected.has(sns);
                  const over = on && checks[sns].issues.includes("too_long");
                  return (
                    <button
                      key={sns}
                      type="button"
                      aria-pressed={on}
                      disabled={isLocked(sns)}
                      onClick={() => toggle(sns)}
                      className={chipClass({ on, className: "disabled:cursor-not-allowed" })}
                    >
                      {on && <span aria-hidden>✓</span>}
                      {SNS[sns].label}
                      {on && <span className={`num ${over ? "text-danger" : ""}`}>{countText(sns)}</span>}
                      {overrides[sns] !== undefined && <span aria-hidden>✎</span>}
                      {isLocked(sns) && <span className="text-success">投稿済み</span>}
                    </button>
                  );
                })}
              </div>
              <ul className="flex flex-col gap-1.5 sm:hidden">
                {SNS_KEYS.map((sns) => {
                  const on = selected.has(sns);
                  const state = targetState(sns);
                  // 1 段目の右には字数と短い状態（OK・オフ）だけ。長い印（画像が必要・つないでいない・投稿済みなど）と「文面を変更」は、
                  // 名前の下の 2 段目にまとめる（320 幅でも 1 段目が折れないように）
                  const inline = state && (!on || state.text === "OK") ? state : null;
                  const below = state && !inline ? state : null;
                  const changed = overrides[sns] !== undefined;
                  return (
                    <li key={sns}>
                      <label className={`flex min-h-11 flex-col justify-center gap-0.5 rounded-md border px-3.5 py-2 text-[15px] ${on ? "border-border bg-surface" : "border-line bg-surface2"}`}>
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={isLocked(sns)}
                            onChange={() => toggle(sns)}
                            className="size-[18px] shrink-0 accent-[var(--primary)]"
                          />
                          <span className={`min-w-0 truncate ${on ? "font-bold" : "text-muted"}`}>{SNS[sns].label}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-2 text-[13px]">
                            {on && !isLocked(sns) && <span className="num text-faint">{countText(sns)}</span>}
                            {inline && <span className={inline.tone}>{inline.text}</span>}
                          </span>
                        </span>
                        {(below || changed) && (
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[30px] text-xs">
                            {below && <span className={below.tone}>{below.text}</span>}
                            {changed && <span className="text-muted">✎ 文面を変更</span>}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {warnings.length > 0 && (
                <ul className="flex flex-col gap-1 text-[13px] max-sm:hidden">
                  {warnings.map((w) => (
                    <li key={w.sns}>
                      <span className={w.state!.tone}>● {SNS[w.sns].label}: {w.state!.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {fe.targets && (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {fe.targets}
                </p>
              )}
              {connected.length === 0 && mode !== "all_sent" && (
                <p className="text-[13px] text-muted">
                  まだ SNS をつないでいません（下書きは保存できます）。{" "}
                  <Link href={connectHref} className="font-semibold text-fg underline">
                    先に SNS をつなぐ →
                  </Link>
                </p>
              )}
            </fieldset>

            {selected.has("x") && !isLocked("x") && hasXUrl(textFor("x")) && (
              <XUrlCostNotice
                onEdit={() => {
                  setFocus("x");
                  setOverrides((o) => (o.x !== undefined ? o : { ...o, x: body }));
                }}
              />
            )}

            {selected.has("instagram") && !isLocked("instagram") && (
              <InstagramLinkNotice
                projectId={projectId}
                text={textFor("instagram")}
                info={profileLink}
                done={igLinked && overrides.instagram !== undefined}
                onApply={applyProfileLink}
                onEdit={() => editOverride("instagram")}
              />
            )}

            {images.length > 0 && needImageReconnect.some((s) => selected.has(s) && !isLocked(s)) && (
              <p className="text-[13px] leading-[1.7]">
                <span className="mr-1.5 font-bold text-signal">● 要確認</span>
                {needImageReconnect.filter((s) => selected.has(s)).map((s) => SNS[s].label).join("・")} に画像を送るには、つなぎ直しが要ります。
                <Link href={connectHref} className="ml-1 font-semibold underline">
                  つないだ SNS へ
                </Link>
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <ImageAttachments
                images={images}
                disabled={pending}
                maker={{ projectId, projectName, aiEnabled: aiCheckEnabled, text: textFor(focus), targets: chosen }}
                instagram={chosen.includes("instagram")}
                onChange={(next) => {
                  setImages(next);
                  clearFieldError("media");
                }}
              />
              {fe.media && <p className="text-sm font-semibold text-danger">{fe.media}</p>}
            </div>

            {(chosen.length === 0 || toSend.length > 0) && (
              <ShortLinkToggle
                checked={shortLinks}
                onChange={setShortLinks}
                projectId={projectId}
                body={body}
                targets={toSend.map((sns) => ({ sns, text: textFor(sns) }))}
              />
            )}

            {/* 送る日時と送る */}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="planned-at" className="sr-only">
                送る日時
              </label>
              <input
                id="planned-at"
                type="datetime-local"
                value={plannedAt}
                onChange={(e) => {
                  setPlannedAt(e.target.value);
                  clearFieldError("plannedAt");
                }}
                aria-invalid={fe.plannedAt ? true : undefined}
                className={`num h-9 rounded-md border bg-surface px-3 text-[14px] text-fg outline-none max-sm:text-[16px] ${fe.plannedAt ? "border-danger shadow-[0_0_0_1px_var(--danger)]" : "border-border focus:border-primary"}`}
              />
              <span className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[14px] text-muted">日本時間</span>
            </div>
            {timeHint && (
              <div className="-mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                <span>{timeHint.kind === "views" ? "この時間帯がよく見られています（傾向）" : "この時間帯によくクリックされています（傾向）"}</span>
                <button
                  type="button"
                  onClick={() => {
                    const [ymd, hm] = jstNow();
                    setPlannedAt(plannedAtFor(timeHint.band, plannedAt, ymd, hm));
                    clearFieldError("plannedAt");
                  }}
                  className={chipClass({ className: "h-7 px-2.5 text-[12px]" })}
                >
                  {BAND_INFO[timeHint.band].label}（{BAND_INFO[timeHint.band].hours}）· {BAND_INFO[timeHint.band].at} にする
                </button>
                <HelpTip label="時間帯の傾向">
                 yabumi が数えた、直近 90 日のあなたの数字です（{timeHint.kind === "views" ? "送った時間帯ごとの 1 本あたりの閲覧数" : "短縮リンクが押された時間帯"}）。傾向であって、この時間に送れば必ず見られるわけではありません。
                </HelpTip>
              </div>
            )}

            {mode === "all_sent" ? (
              <div className="flex flex-col gap-2 border-t border-line pt-3.5">
                <p className="text-[14px] leading-[1.7] text-muted">
                  送った投稿です。直すときは各 SNS で、取り消すときは上の「送信の結果」から。ほかの SNS にも送るときは、送り先のチップで選んでください。
                </p>
                {deleteRow(true)}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {mode === "partial" && (
                  <p className="text-[13px] text-muted">
                    {sentLabels} には送信済みです（送り直しません）。残りの SNS の分だけ予約・送信できます。
                  </p>
                )}
                {sending && <SendProgress postId={sending.postId} sns={sending.sns} hasImages={images.length > 0} />}
                <Button type="button" size="lg" disabled={pending || blocker !== null} onClick={() => submit("schedule")} className="w-full">
                  {busy === "schedule" ? "予約しています…" : labels.schedule}
                </Button>
                <p className={`text-[13px] ${fe.plannedAt || (blocker && blocker !== QUIET_BLOCKER) ? "text-signal" : "text-faint"}`}>
                  {fe.plannedAt ?? blocker ?? "予約すると、この日時に自動で送ります"}
                  {!fe.plannedAt && blocker === missingConnectMessage && (
                    <>
                      {" "}
                      <Link href={connectHref} className="font-semibold text-fg underline">
                        つなぐ →
                      </Link>
                    </>
                  )}
                </p>
                {/* 今すぐ送るは取り消しにくいので、押したら確かめる */}
                <div className="flex flex-wrap items-center gap-2">
                  {confirmSend ? (
                    <>
                      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit("now")}>
                        本当に{labels.now}
                      </Button>
                      <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => setConfirmSend(false)}>
                        やめる
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={pending || nowBlocker !== null}
                      title={nowBlocker ?? undefined}
                      onClick={() => setConfirmSend(true)}
                    >
                      {busy === "now" ? "送っています…" : labels.now}
                    </Button>
                  )}
                  <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit("draft")}>
                    {busy === "draft" ? "保存しています…" : "下書きに保存する"}
                  </Button>
                  {deleteRow(mode === "partial")}
                </div>
              </div>
            )}
          </section>

          {/* 書くときの手伝い。使わなくても送れるので、閉じて控えめに置く */}
          <section aria-label="書くときの手伝い（使わなくても送れます）" className="flex flex-col gap-2">
            <PlanHints projectId={projectId} hints={planHints} />
            <AiCheckPanel
              key={resetRound}
              projectId={projectId}
              aiEnabled={aiCheckEnabled}
              texts={(chosen.length ? chosen : (["x"] as SnsKey[])).map((sns) => ({ sns, text: overrides[sns] ?? body }))}
              onApply={applyCheckFix}
            />
          </section>
        </div>

        {/* 右: SNS ごとの見え方と文面（タブ）、SNS ごとの注意 */}
        <div className="flex min-w-0 flex-col gap-3">
          <section aria-label="SNS ごとの見え方と文面" className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-2 bg-surface2 pr-3">
              <div role="tablist" aria-label="見え方を見る SNS" className={`${tabListClass} min-w-0 flex-1 px-2`}>
                {previewSns.map((sns) => (
                  <button key={sns} type="button" role="tab" aria-selected={focus === sns} onClick={() => setFocus(sns)} className={tabClass(focus === sns)}>
                    {SNS[sns].label}
                    {overrides[sns] !== undefined && (
                      <span className="ml-1">
                        ✎<span className="sr-only">（文面を変えています）</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <HelpTip label={`${focusLabel} での出方`} align="right">
                {PREVIEW[focus].note}
              </HelpTip>
            </div>
            <div role="tabpanel" className="flex flex-col gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4">
              {isManualSns(focus) && <p className="text-[13px] text-muted">{focusLabel} には、投稿の画面から手で投稿します。</p>}
              {SNS[focus].needsTitle && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="target-title" className="text-[13px] font-bold">
                    {focusLabel} のタイトル
                  </label>
                  <input
                    id="target-title"
                    value={titles[focus] ?? ""}
                    maxLength={MAX_TITLE_LENGTH}
                    onChange={(e) => setTitles((t) => ({ ...t, [focus]: e.target.value }))}
                    placeholder="例: ひとりでお店を 3 か月続けて気づいたこと"
                    className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
                  />
                </div>
              )}
              <SnsPreview key={focus} sns={focus} text={textFor(focus)} title={titles[focus] ?? null} projectName={projectName} images={images} length={checks[focus].length} />
              <ShortLinkPreviewNote sns={focus} text={textFor(focus)} enabled={shortLinks} preview={linkPreview} />
              {images.length > 0 && ignoresImages(focus) && (
                <p className="text-[13px] text-muted">
                  {isManualSns(focus) ? `${focusLabel} には、画像は投稿の画面で手で添えてください。` : `${focusLabel} には画像を送りません（動画だけの SNS です）。`}
                </p>
              )}
              {images.length > SNS[focus].maxImages && !ignoresImages(focus) && (
                <p className="text-[13px] font-semibold text-danger">
                  {focusLabel} に添えられる画像は {SNS[focus].maxImages} 枚までです。画像を減らすか、{focusLabel} を送り先から外してください。
                </p>
              )}
              {focus === "instagram" && images.some((i) => !instagramRatioOk(i.width, i.height)) && (
                <p className="text-[13px] font-semibold text-danger">
                  Instagram に送れる画像の縦横比は、4:5（縦長）から 1.91:1（横長）までです。
                  {images
                    .map((i, n) => (instagramRatioOk(i.width, i.height) ? null : `${n + 1} 枚目（${i.width}×${i.height}）`))
                    .filter(Boolean)
                    .join("、")}
                  が範囲の外です。画像の欄の「縦横を整える」で、切り取るか余白を足して収められます。
                </p>
              )}
              {focus === "instagram" && checks.instagram.issues.includes("too_many_hashtags") && (
                <p className="text-[13px] font-semibold text-danger">Instagram のハッシュタグは 5 個までです（2025 年 12 月から）。</p>
              )}
              {hasOverride ? (
                <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                  <label htmlFor="override" className="text-[13px] font-bold">
                    {focusLabel} 用の文面
                  </label>
                  <textarea
                    id="override"
                    ref={overrideRef}
                    rows={SNS[focus].needsTitle ? 12 : 4}
                    value={overrides[focus]}
                    onChange={(e) => setOverrides((o) => ({ ...o, [focus]: e.target.value }))}
                    className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
                  />
                  <VoiceInputButton key={focus} target={overrideRef} label={`${focusLabel} 用の文面`} onChange={(v) => setOverrides((o) => ({ ...o, [focus]: v }))} />
                  <button
                    type="button"
                    onClick={() =>
                      setOverrides((o) => {
                        const next = { ...o };
                        delete next[focus];
                        return next;
                      })
                    }
                    className="self-start text-[13px] font-semibold text-muted underline hover:text-fg"
                  >
                    共通の文面に戻す
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 border-t border-line pt-3">
                  <Button type="button" variant="secondary" size="sm" disabled={isLocked(focus)} onClick={() => setOverrides((o) => ({ ...o, [focus]: body }))}>
                    {focusLabel} だけ文面を変える
                  </Button>
                  <HelpTip label="SNS ごとの文面">ほかの SNS は共通の文面のままです。</HelpTip>
                </div>
              )}
            </div>
          </section>

          {/* SNS ごとの注意の小さなカード（見本 B の右下）。いま見ている SNS のほかに、選んだ SNS */}
          {previewSns.length > 1 && (
            <ul className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {previewSns
                .filter((s) => s !== focus)
                .slice(0, 4)
                .map((sns) => (
                  <li key={sns}>
                    <button
                      type="button"
                      onClick={() => setFocus(sns)}
                      className="flex h-full w-full flex-col gap-0.5 rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-input"
                    >
                      <b className="text-[15px]">{SNS[sns].label}</b>
                      <span className="text-[13px] leading-[1.6] text-muted">
                        {SNS[sns].maxLength ? `${formatCount(SNS[sns].maxLength!)} 字まで・` : ""}
                        {PREVIEW[sns].short}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      {numbers}
      </div>
    </>
  );
}

// 日本時間のいまの日付と時刻（"YYYY-MM-DD" と "HH:MM"）
function jstNow(): [string, string] {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}`];
}

// 送った配信先の状態（スマホの行の右）
const TARGET_STATE: Partial<Record<TargetResult["status"], { text: string; tone: string }>> = {
  published: { text: "✓ 投稿済み", tone: "font-bold text-success" },
  preparing: { text: "送信中", tone: "text-muted" },
  publishing: { text: "送信中", tone: "text-muted" },
  deleted: { text: "取り消し済み", tone: "text-muted" },
  failed: { text: "! 失敗", tone: "font-bold text-danger" },
};
// 送ったあとの状態は、上の「送信の結果」に出ているので、チップの下の注意には出さない
const TARGET_STATE_TEXTS = new Set(Object.values(TARGET_STATE).map((s) => s!.text));

// X は本文に URL があると、API の料金が 13 倍になる（決定 D16）。費用の差は 1 行で出し、URL を外す代わりの案は「?」に畳む
function XUrlCostNotice({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <span className="font-bold text-signal">● 費用</span>
      <span>
        X は本文に URL があると 1 本 {formatUsd(X_PRICE_USD.post_with_url)}（約 30 円。なければ約 2 円）
      </span>
      <HelpTip label="X の URL の費用">
        <ul className="list-disc pl-4">
          <li>
            URL があると、X の <Term k="payPerUse">API の料金</Term>が 1 本 {formatUsd(X_PRICE_USD.post_with_url)}、なければ {formatUsd(X_PRICE_USD.post)} です
          </li>
          <li>URL は X のプロフィールに置き、本文は「プロフィールのリンクから」とする</li>
          <li>X 用に文面を変えて URL を外す（Threads など、ほかの SNS には URL を残せる）</li>
          <li>「example.com」のように https:// を付けなくても、X は URL として数えます</li>
          <li>短縮リンクも URL なので、料金は同じです。X で押された回数は、プロフィールのリンクを短縮リンクにして数えるのがおすすめです</li>
        </ul>
      </HelpTip>
      <button type="button" onClick={onEdit} className="font-semibold underline">
        X 用に文面を変える
      </button>
    </div>
  );
}

// Instagram は本文の URL を押せない（4.37）。URL があれば知らせて、文面を「プロフィールのリンクから」にするボタンを出す。
// URL がなくても、行き先の URL を登録していれば一言を足すボタンを控えめに。プロフィールに置く短縮リンクがなければ、作る画面への 1 行
function InstagramLinkNotice({
  projectId,
  text,
  info,
  done,
  onApply,
  onEdit,
}: {
  projectId: string;
  text: string;
  info: ProfileLinkInfo | null;
  done: boolean;
  onApply: () => void;
  onEdit: () => void;
}) {
  const hasUrl = findUrls(text).length > 0;
  const hasLine = hasProfileLinkLine(text);
  const canAdd = !hasUrl && !hasLine && text.trim() !== "" && (info?.destinations.length ?? 0) > 0;
  const needLink = info !== null && !info.hasInstagramLink && (hasUrl || hasLine);
  const showDone = done && !hasUrl && hasLine;
  if (!hasUrl && !showDone && !canAdd && !needLink) return null;
  return (
    <div className="flex flex-col gap-1 text-[13px] leading-[1.7]">
      {hasUrl && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold text-signal">● 要確認</span>
          <span>Instagram では本文の URL は押せません</span>
          <button type="button" onClick={onApply} className="text-left font-semibold underline">
            Instagram の文面を「プロフィールのリンクから」にする
          </button>
        </p>
      )}
      {showDone && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            <span aria-hidden className="mr-1 font-bold text-success">
              ✓
            </span>
            Instagram 用の文面の URL を外し、最後に「{text.split("\n").find(hasProfileLinkLine)?.trim()}」を入れました。
          </span>
          <button type="button" onClick={onEdit} className="font-semibold underline">
            Instagram 用の文面を直す
          </button>
        </p>
      )}
      {canAdd && (
        <p className="text-muted">
          <button type="button" onClick={onApply} className="text-left underline hover:text-fg">
            Instagram の文面に「プロフィールのリンクから」の一言を足す
          </button>
        </p>
      )}
      {needLink && (
        <p className="text-muted">
          Instagram のプロフィールに置くリンクがまだありません。
          <Link href={`/projects/${projectId}/links#profile-instagram`} className="font-semibold text-fg underline">
            プロフィールに置くリンクを作る（短縮リンク）
          </Link>
          （作ったら、Instagram のプロフィールに自分で貼ります）
        </p>
      )}
    </div>
  );
}

// ロードマップのやることから作るときの手がかり（4.23）。題と説明は本文に入れず、「本文に入れる」で手がかりとして入れられる
function RoadmapItemHint({ item, onInsert }: { item: { title: string; detail: string }; onInsert: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface2 px-4 py-3 text-[13px] leading-[1.7]">
      <p className="flex items-center gap-1.5 text-muted">
        ロードマップのやることから
        <HelpTip label="ロードマップのやること">
          この投稿は、ロードマップに書いた下のやることのために作るものです。送ると、ロードマップの画面でこのやることが 1 回進んだことになります（たとえば「今週 3 回投稿する」なら、3 回のうち 1 回）。
        </HelpTip>
      </p>
      <p className="text-[15px] font-bold">{item.title}</p>
      {item.detail && <p className="text-muted">{item.detail}</p>}
      <button type="button" onClick={onInsert} className="self-start font-semibold underline">
        題と説明を本文に入れる
      </button>
    </div>
  );
}

// 投稿をつくるの書きかけの控え（4.35）
type PostDraft = { body: string; overrides: Partial<Record<SnsKey, string>>; titles: Partial<Record<SnsKey, string>> };

function samePostDraft(a: PostDraft, b: PostDraft): boolean {
  const same = (x: Partial<Record<string, string>> = {}, y: Partial<Record<string, string>> = {}) => {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    return [...keys].every((k) => (x[k] ?? "") === (y[k] ?? ""));
  };
  return a.body === b.body && same(a.overrides, b.overrides) && same(a.titles, b.titles);
}

const noopSubscribe = () => () => {};

// 添えた画像の見分け（差し替え・代わりの文の変更も「変えた」とみなす）
const imageKey = (i: AttachedImage) => `${i.id}\u0000${i.altText ?? ""}`;
