"use client";

import type { FormatUse } from "../post-format-picker";
import { callAction } from "@/lib/client-errors";
import { draftStep, postDraftBase, samePostDraft, type PostDraft } from "@/lib/posts/post-draft";
import { clearFormDraft, parseFormDraft, rawFormDraft, usableFormDraft, writeFormDraft, type FormDraft } from "@/lib/form-draft";
import { getDraftOwner } from "@/lib/notes/draft";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { deletePost, savePost, sendSavedPost } from "@/lib/posts/actions";
import { useRouter, useSearchParams } from "next/navigation";
import { canGoNext, fieldErrorStep, parseStep, problemsByStep, startStep, stepMarks, type StepNo } from "@/lib/posts/compose-steps";
import { clearSending, markSending } from "../send-progress";
import type { SavePostResult } from "@/lib/posts/schema";
import type { PostLinkPreview } from "@/lib/links/store";
import { type AttachedImage } from "../image-attachments";
import { applyFix } from "@/lib/ai/ai-check";
import { type NoteInsertMode } from "../note-picker";
import { noteImageForCompose } from "@/lib/notes/actions";
import type { IdeaNote } from "@/lib/notes/rules";
import { MAX_IMAGES_PER_POST } from "@/lib/media/rules";
import { type PlanHintsData } from "../plan-hints";
import { hasUrl } from "@/lib/learning/tips";
import { type TargetResult } from "../send-results";
import { previewTabs } from "@/lib/sns/preview";
import { ISSUE_LABEL, SNS, SNS_KEYS, checkTarget, isManualSns, type SnsKey, type TargetIssue } from "@/lib/sns";
import { projectSettingsHref } from "@/lib/projects/paths";
import { sendLabels, sendMode } from "@/lib/posts/send-mode";
import { findUrls, profileLinkLine, withDestinationUrl, withProfileLink, type ProfileLinkInfo } from "@/lib/posts/profile-link";
import { type TimeBand } from "@/lib/metrics/time-bands";
import { composeChanges, type ComposeSnapshot } from "@/lib/posts/compose-reset";
import { hashtagInputProblem, hashtagLine, parseHashtagInput, withHashtags } from "@/lib/sns/hashtags";
import { formatTagsFor, hasFormatHashtags, type FormatHashtags } from "@/lib/post-formats/schema";

export type ComposerInitial = {
  body: string;
  // hashtags: 本文とは別に付けるタグ（# なし。4.59）
  targets: { sns: SnsKey; bodyOverride: string | null; title?: string | null; hashtags?: string[] }[];
  plannedAt: string;
  images?: AttachedImage[];
  // 本文の URL を短縮リンクにするか（新しい投稿はオン。4.22、D20）
  shortLinks?: boolean;
  // ロードマップのやることから作るとき（4.23）。題と説明を、本文の下書きの手がかりとして出す
  roadmapItem?: { id: string; title: string; detail: string } | null;
  // 引用する X の投稿の id（X で人気の投稿から作った下書き。4.52）。X の画面で利用者が送る
  quotePostId?: string | null;
  // 本文を書いたのは誰か（前からある投稿は null。docs/design/voice-from-posts.md の 2.3）
  textOrigin?: "self" | "ai" | null;
};

export type ComposerProps = {
  projectId: string;
  projectName: string;
  postId: string | null;
  initial: ComposerInitial;
  // つないでいて、送信もできる SNS
  connected: SnsKey[];
  // 配信先ごとの送信の状態（新しい投稿では空）
  results?: Partial<Record<SnsKey, TargetResult>>;
  notice?: string;
  // 知らせのすぐ下に出すもの（送ったあとの「ひとこと」。4.47）
  afterNotice?: ReactNode;
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
  // 自分で書いて送った投稿の本数（「最初は自分で書く」のすすめに使う。わからなければ null で出さない）
  selfWrittenPosts?: number | null;
  // 書き方（文調のメモ）がもうあるか（あれば、すすめも案内も出さない）
  hasVoiceMemo?: boolean;
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

// 引用の投稿の、送れない理由（X の画面で送る。4.52）
const QUOTE_BLOCKER = "引用は X の画面で送ります（yabumi からは予約・送信できません）";

// まだ何も書いていないときの、送れない理由（朱にしない）
export const QUIET_BLOCKER = "本文を書くと、予約・送信できます";

// 左（本文など）と右（SNS ごとの見え方と文面）が横に並ぶ幅か（並ばないと、右の欄は左のずっと下に来る。下の grid の max-lg）
export function isSideBySide() {
  return window.matchMedia("(min-width: 64rem)").matches;
}

export function formatCount(n: number) {
  return n.toLocaleString("ja-JP");
}

export function useComposer({
  projectId,
  projectName,
  postId,
  initial,
  connected,
  results = {},
  notice,
  afterNotice,
  noticeTone = "success",
  planHints = null,
  needImageReconnect = [],
  linkPreview = {},
  aiCheckEnabled = false,
  numbers = null,
  timeHint = null,
  profileLink = null,
  selfWrittenPosts = null,
  hasVoiceMemo = false,
}: ComposerProps) {
  const [images, setImages] = useState<AttachedImage[]>(initial.images ?? []);
  const [shortLinks, setShortLinks] = useState(initial.shortLinks ?? true);
  const [body, setBody] = useState(initial.body);
  // 選んでいる投稿のフォーマットと穴の言葉（整えるに渡す。docs/design/post-formats.md の 4）
  const [formatUse, setFormatUse] = useState<FormatUse | null>(null);
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
  // SNS ごとのタグの欄（書いたままの文字。送るときに本文の後ろに足す。4.59）
  const [tagInputs, setTagInputs] = useState<Partial<Record<SnsKey, string>>>(() => initialTagInputs(initial));
  const [plannedAt, setPlannedAt] = useState(initial.plannedAt);
  // 引用する X の投稿（外すと、ふつうの X の投稿として予約・送信できる）
  const [quote, setQuote] = useState<string | null>(initial.quotePostId ?? null);
  // AI で整えた案を使った知らせが出ているか（出ている間は、SNS ごとの文面の 1 行をその知らせにまとめる）
  const [tidyAdopted, setTidyAdopted] = useState(false);
  // 本文を書いたのは誰か。「AI で整える」の案を採用したら ai にする（戻しても自動では self に戻さない。利用者が切り替えられる）
  const [textOrigin, setTextOrigin] = useState<"self" | "ai">(initial.textOrigin ?? "self");
  // Instagram の文面を「プロフィールのリンクから」にした（したことを 1 行で知らせる）
  const [igLinked, setIgLinked] = useState(false);
  // 「行き先の URL を入れる」で入れた URL（入れたことと、短縮リンクに置き換えることを 1 行で知らせる）
  const [insertedUrl, setInsertedUrl] = useState<string | null>(null);
  const [result, setResult] = useState<SavePostResult>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // いまのステップ（docs/design/compose-steps.md）。URL の ?step に持つ（ブラウザの戻るで前のステップへ。読み込み直しても同じステップ）
  const searchParams = useSearchParams();
  const [firstStep] = useState(() => startStep({ saved: postId !== null, body: initial.body }));
  const composeStep = parseStep(searchParams.get("step"), firstStep);
  // 一度開いたステップ（上の進みの ✓ と、問題の ● を出すかに使う）
  const [visited, setVisited] = useState<ReadonlySet<StepNo>>(() => new Set([firstStep]));
  // ステップを移る。replace: 履歴に足さない（書きかけを戻したとき・保存のエラーで移るとき）
  function goStep(n: StepNo, opts: { replace?: boolean } = {}) {
    setVisited((v) => new Set([...v, composeStep, n]));
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(n));
    if (opts.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }
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
      hashtags: initialTagInputs(initial),
    }),
    [initial],
  );
  // 書き始めたときの保存してある値（控えに添え、次に開いたときに保存し直されていないかを見る）
  const draftBase = useMemo(() => postDraftBase(initialDraft), [initialDraft]);
  // 利用者が欄に書いた（キーボード・音声）か。ボタンで入れた値（行き先の URL・プロフィールのリンクの一言・SNS ごとの文面を作る・AI で整えた案・
  // やることやネタ帳から入れる）だけなら控えない（2026-11-09 オーナーの指摘「下書きとかした記憶ないのに、しょっちゅう残っている」）
  const typed = useRef(false);
  const markTyped = () => {
    typed.current = true;
  };
  // 開いたときに見つけた控え（戻すか捨てるかを選ぶまで、新しく書き込まない）。サーバーで描くときは undefined（まだ見ていない）
  const rawDraft = useSyncExternalStore(noopSubscribe, () => rawFormDraft(draftKey), () => undefined);
  const [found, setFound] = useState<{ draft: FormDraft<PostDraft> | null } | undefined>(undefined);
  if (found === undefined && rawDraft !== undefined) {
    const d = notice ? null : parseFormDraft<PostDraft>(rawDraft, getDraftOwner());
    setFound({ draft: usableFormDraft(d, draftBase, (v) => samePostDraft(v, initialDraft)) });
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
    const now: PostDraft = { body, overrides, titles, hashtags: tagInputs };
    const step = draftStep({ same: samePostDraft(now, initialDraft), typed: typed.current });
    if (step === "clear") clearFormDraft(draftKey);
    else if (step === "write") writeFormDraft(draftKey, { ...now, step: composeStep }, draftBase);
  }, [body, overrides, titles, tagInputs, found, draftKey, initialDraft, draftBase, composeStep]);
  function restoreDraft() {
    if (!restorable) return;
    const v = restorable.value;
    setBody(v.body);
    setOverrides(v.overrides ?? {});
    setTitles(v.titles ?? {});
    // 前の版の控え（タグの欄がない）では、保存したタグのまま
    setTagInputs(v.hashtags ?? initialDraft.hashtags ?? {});
    setRestorable(null);
    // 控えたときのステップに戻す（前の版の控えにはない）
    if (typeof v.step === "number") goStep(parseStep(String(v.step), composeStep), { replace: true });
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
    { body, overrides, titles, hashtags: tagInputs, imageIds: images.map(imageKey), plannedAt, targets: [...selected], shortLinks, noteIds },
    { saved: postId !== null },
  );
  function resetAll() {
    setBody(initial.body);
    setOverrides(initialDraft.overrides);
    setTitles(initialDraft.titles);
    setTagInputs(initialDraft.hashtags ?? {});
    // まだ保存していない画像は、外したときと同じく翌日の片付けで消える（4.18）
    setImages(initial.images ?? []);
    setPlannedAt(initial.plannedAt);
    setSelected(new Set(initial.targets.map((t) => t.sns)));
    setShortLinks(initial.shortLinks ?? true);
    setQuote(initial.quotePostId ?? null);
    setNoteIds([]);
    setTidyAdopted(false);
    setFormatUse(null);
    setTextOrigin(initial.textOrigin ?? "self");
    setIgLinked(false);
    setResult({});
    setConfirmSend(false);
    setConfirmDelete(false);
    setTouched(Boolean(postId) || initial.body.trim() !== "");
    setResetRound((r) => r + 1);
    typed.current = false;
    // 書きかけの控えも消す（「戻す」の帯も閉じる）
    clearFormDraft(draftKey);
    setRestorable(null);
    justReset.current = true;
    setResetOpen(false);
  }
  // リセットの確かめを閉じる。押したボタンは消えるので、本文の見出しにフォーカスを置く（スマホで鍵盤が開かないよう、本文の欄には置かない）
  function closeReset() {
    setResetOpen(false);
    if (justReset.current) {
      justReset.current = false;
      headingRef.current?.focus({ preventScroll: true });
    }
  }

  // SNS ごとのタグ（欄から読んだもの）と、送る文（本文か SNS ごとの文面 ＋ 空行 ＋ タグ。DB の post_target_text と同じ組み立て）
  const tagsFor = (sns: SnsKey) => parseHashtagInput(tagInputs[sns] ?? "").tags;
  const textFor = (sns: SnsKey) => withHashtags(overrides[sns] ?? body, tagsFor(sns));
  // タグを付ける前の文（AI に渡すのはこちら。タグは AI に送らない）
  const bodyFor = (sns: SnsKey) => overrides[sns] ?? body;
  const checks = useMemo(
    () =>
      Object.fromEntries(
        SNS_KEYS.map((sns) => [
          sns,
          checkTarget(sns, withHashtags(overrides[sns] ?? body, parseHashtagInput(tagInputs[sns] ?? "").tags), { images: images.length, videos: 0, sizes: images }, titles[sns] ?? null),
        ]),
      ) as Record<SnsKey, ReturnType<typeof checkTarget>>,
    [body, overrides, titles, tagInputs, images],
  );
  // タグの欄の問題（タグにできない言葉・6 個以上）
  const tagProblem = (sns: SnsKey) => hashtagInputProblem(tagInputs[sns] ?? "");
  // 投稿のフォーマットのタグを、SNS ごとのタグの欄に入れる（置きかえ。送った SNS は変えない）。フォーマットにタグがなければ何もしない
  function applyFormatTags(h: FormatHashtags | null | undefined) {
    if (!hasFormatHashtags(h)) return;
    setTagInputs((prev) => {
      const next = { ...prev };
      for (const s of SNS_KEYS) {
        if (isLocked(s)) continue;
        const tags = formatTagsFor(h, s);
        if (tags.length) next[s] = hashtagLine(tags);
        else delete next[s];
      }
      return next;
    });
  }

  const isLocked = (s: SnsKey) => LOCKED.has(results[s]?.status ?? "");
  // 1 つでも送った（送信中・取り消し済みを含む）投稿
  const sentAny = SNS_KEYS.some((s) => isLocked(s));
  const chosen = SNS_KEYS.filter((s) => selected.has(s));
  // 書いている途中の「ひとこと」（4.47）のきっかけ: 開いたあとに Instagram を選んだ・URL を入れた（開いたときからそうなら出さない）
  const [learnFrom] = useState(() => ({ instagram: initial.targets.some((t) => t.sns === "instagram"), url: hasUrl(initial.body) || initial.targets.some((t) => t.bodyOverride !== null && hasUrl(t.bodyOverride)) }));
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
  const missingConnect = toSend.filter((s) => !isManualSns(s) && !connected.includes(s) && !(s === "x" && quote !== null));
  const missingConnectMessage = `${missingConnect.map((s) => SNS[s].label).join("・")} をつなぐと送れます`;
  // 送れない理由（最初の 1 つ）。日時は予約のときだけ要る
  // 引用は X だけで、X の画面で送る（X の API の引用は、使った分だけ払う方式では使えない。4.52）
  const quoting = quote !== null && selected.has("x") && !isLocked("x");
  const sendBlocker = (() => {
    if (chosen.length === 0) return "送り先の SNS を選んでください";
    if (quoting && chosen.some((s) => s !== "x")) return "引用の投稿は X だけに送れます。ほかの SNS を外すか、引用を外してください";
    if (quoting) return QUOTE_BLOCKER;
    if (toSend.length === 0) return "選んだ SNS にはすべて投稿済みです";
    if (quiet) return QUIET_BLOCKER;
    for (const s of toSend) {
      const p = tagProblem(s);
      if (p) return `${SNS[s].label}: ${p}`;
    }
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

  // 行き先の URL を本文の最後に入れる（4.40）。SNS ごとの文面があれば、そちらにも入れる。
  // Instagram は本文の URL を押せないので、Instagram の文面には入れずに「プロフィールのリンクから」の一言にする（4.37）。押された回数を数えるようにする
  function insertDestination(url: string) {
    const nextBody = withDestinationUrl(body, url);
    const ig = selected.has("instagram") && !isLocked("instagram");
    setBody(nextBody);
    setOverrides((o) => {
      const next = { ...o };
      for (const s of SNS_KEYS) if (s !== "instagram" && next[s] !== undefined && !isLocked(s)) next[s] = withDestinationUrl(next[s]!, url);
      if (ig) next.instagram = withProfileLink(o.instagram ?? nextBody, profileLinkLine({ productType: profileLink?.productType, destinations: profileLink?.destinations, url }));
      return next;
    });
    if (ig) setIgLinked(true);
    setShortLinks(true);
    setInsertedUrl(url);
    clearFieldError("body");
  }

  // X だけ URL を外す（X は本文に URL があると費用が上がる。D16）。外したあとは「プロフィールのリンクから」の一言にする
  function removeXUrl() {
    const current = overrides.x ?? body;
    const line = profileLinkLine({ productType: profileLink?.productType, destinations: profileLink?.destinations, url: findUrls(current)[0] ?? null });
    setOverrides((o) => ({ ...o, x: withProfileLink(o.x ?? body, line) }));
    if (isSideBySide()) setFocus("x");
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
        quotePostId: quoting ? quote : null,
        textOrigin,
        targets: chosen.map((sns) => ({
          sns,
          bodyOverride: overrides[sns] ?? null,
          title: SNS[sns].needsTitle ? (titles[sns] ?? null) : null,
          // 欄に書いたまま区切って渡す（タグにできない言葉は、サーバーが欄のエラーにする）
          hashtags: (tagInputs[sns] ?? "").split(/[\s,、，]+/u).filter(Boolean),
        })),
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
      else if (out.value) {
        setResult(out.value);
        // 欄のエラーは、その欄のあるステップに移って見せる
        const at = fieldErrorStep(out.value.fieldErrors ?? {});
        if (at && at !== composeStep) goStep(at, { replace: true });
      }
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
    // 引用の X は X の画面で送るので、つないでいなくてよい（4.52）
    if (sns === "x" && quoting && !checks.x.issues[0]) return { text: "X の画面で送る", tone: "text-muted" };
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
  // ステップごとの問題（まだ何も書いていない新しい投稿では出さない）
  const stepProblems = quiet
    ? []
    : problemsByStep({
        issues: toSend.map((sns) => ({ sns, label: SNS[sns].label, issues: checks[sns].issues, override: overrides[sns] !== undefined, tags: tagsFor(sns).length > 0, issueLabel: (i) => ISSUE_LABEL[i] })),
        tagProblems: toSend.flatMap((sns) => {
          const p = tagProblem(sns);
          return p ? [{ label: SNS[sns].label, text: p }] : [];
        }),
        noTargets: chosen.length === 0,
        missingConnect: missingConnect.map((s) => SNS[s].label),
        reconnect: images.length > 0 ? toSend.filter((s) => needImageReconnect.includes(s)).map((s) => SNS[s].label) : [],
        needsTime: !plannedAt,
      });
  const marks = stepMarks({ current: composeStep, visited, problems: stepProblems, filled: { 1: body.trim() !== "", 2: chosen.length > 0, 3: images.length > 0 } });
  const nextOk = canGoNext(composeStep, { body, chosen: chosen.length });

  return {
    composeStep,
    goStep,
    visited,
    stepProblems,
    marks,
    nextOk,
    projectId,
    projectName,
    postId,
    initial,
    connected,
    results,
    notice,
    afterNotice,
    noticeTone,
    planHints,
    needImageReconnect,
    linkPreview,
    aiCheckEnabled,
    numbers,
    timeHint,
    profileLink,
    selfWrittenPosts,
    hasVoiceMemo,
    images,
    setImages,
    shortLinks,
    setShortLinks,
    body,
    setBody,
    formatUse,
    setFormatUse,
    bodyRef,
    overrideRef,
    selected,
    setSelected,
    overrides,
    setOverrides,
    picked,
    setFocus,
    titles,
    setTitles,
    tagInputs,
    setTagInputs,
    tagsFor,
    tagProblem,
    applyFormatTags,
    plannedAt,
    setPlannedAt,
    quote,
    setQuote,
    tidyAdopted,
    setTidyAdopted,
    textOrigin,
    setTextOrigin,
    igLinked,
    setIgLinked,
    insertedUrl,
    setInsertedUrl,
    result,
    setResult,
    confirmDelete,
    setConfirmDelete,
    confirmSend,
    setConfirmSend,
    pending,
    startTransition,
    router,
    busy,
    setBusy,
    sending,
    setSending,
    notesOpen,
    setNotesOpen,
    noteIds,
    setNoteIds,
    touched,
    setTouched,
    draftKey,
    initialDraft,
    draftBase,
    typed,
    markTyped,
    rawDraft,
    found,
    setFound,
    restorable,
    setRestorable,
    restoreDraft,
    quiet,
    resetOpen,
    setResetOpen,
    resetRound,
    setResetRound,
    justReset,
    headingRef,
    initialSnapshot,
    resetChanges,
    resetAll,
    closeReset,
    textFor,
    bodyFor,
    checks,
    isLocked,
    sentAny,
    chosen,
    learnFrom,
    previewSns,
    focus,
    applyCheckFix,
    toSend,
    missingConnect,
    missingConnectMessage,
    quoting,
    sendBlocker,
    blocker,
    nowBlocker,
    clearFieldError,
    toggle,
    pickNote,
    applyProfileLink,
    insertDestination,
    removeXUrl,
    showBody,
    editOverride,
    submit,
    fe,
    focusLabel,
    hasOverride,
    splitSns,
    bodySns,
    connectHref,
    plannedLabel,
    targetState,
    countText,
    warnings,
    mode,
    labels,
    sentLabels,
    deleteRow,
  };
}

export type Composer = ReturnType<typeof useComposer>;

// 送った配信先の状態（スマホの行の右）
const TARGET_STATE: Partial<Record<TargetResult["status"], { text: string; tone: string }>> = {
  published: { text: "✓ 投稿済み", tone: "font-bold text-success" },
  preparing: { text: "送信中", tone: "text-muted" },
  publishing: { text: "送信中", tone: "text-muted" },
  deleted: { text: "取り消し済み", tone: "text-muted" },
  failed: { text: "! 失敗", tone: "font-bold text-danger" },
};
// 送ったあとの状態は、上の「送信の結果」に出ているので、チップの下の注意には出さない

export const TARGET_STATE_TEXTS = new Set(Object.values(TARGET_STATE).map((s) => s!.text));

// 保存したタグを、欄に出す文字にする（#a #b）
function initialTagInputs(initial: ComposerInitial): Partial<Record<SnsKey, string>> {
  return Object.fromEntries(initial.targets.filter((t) => t.hashtags?.length).map((t) => [t.sns, hashtagLine(t.hashtags!)]));
}

// 投稿をつくるの書きかけの控え（4.35）
const noopSubscribe = () => () => {};

// 添えた画像の見分け（差し替え・代わりの文の変更も「変えた」とみなす）
const imageKey = (i: AttachedImage) => `${i.id}\u0000${i.altText ?? ""}`;
