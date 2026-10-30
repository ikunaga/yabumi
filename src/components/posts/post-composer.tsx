"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";
import { tabClass, tabListClass } from "@/components/ui/tabs";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { deletePost, savePost } from "@/lib/posts/actions";
import type { SavePostResult } from "@/lib/posts/schema";
import { ShortLinkPreviewNote, ShortLinkToggle } from "@/components/links/short-link-toggle";
import type { PostLinkPreview } from "@/lib/links/store";
import { ImageAttachments, type AttachedImage } from "./image-attachments";
import { applyFix } from "@/lib/ai/ai-check";
import { AiCheckPanel } from "./ai-check-panel";
import { ComposeStart } from "./compose-start";
import { PlanHints, type PlanHintsData } from "./plan-hints";
import { SendResults, type TargetResult } from "./send-results";
import { SnsPreview } from "./sns-preview";
import { PREVIEW, previewTabs } from "@/lib/sns/preview";
import { ISSUE_LABEL, MAX_TITLE_LENGTH, SNS, SNS_KEYS, checkTarget, hasXUrl, instagramRatioOk, ignoresImages, isManualSns, type SnsKey, type TargetIssue } from "@/lib/sns";
import { X_PRICE_USD, formatUsd } from "@/lib/sns/x/pricing";
import { Term } from "@/components/ui/term";
import { projectSettingsHref } from "@/lib/projects/paths";
import { sendLabels, sendMode } from "@/lib/posts/send-mode";
import { BAND_INFO, plannedAtFor, type TimeBand } from "@/lib/metrics/time-bands";

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
}: Props) {
  const [images, setImages] = useState<AttachedImage[]>(initial.images ?? []);
  const [shortLinks, setShortLinks] = useState(initial.shortLinks ?? true);
  const [body, setBody] = useState(initial.body);
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
  const [result, setResult] = useState<SavePostResult>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pending, startTransition] = useTransition();

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

  function submit(intent: "draft" | "schedule" | "now") {
    setResult({});
    setConfirmSend(false);
    startTransition(async () => {
      const res = await savePost({
        projectId,
        postId,
        body,
        plannedAt,
        intent,
        media: images.map((i) => ({ id: i.id, altText: i.altText })),
        shortLinks,
        roadmapItemId: initial.roadmapItem?.id ?? null,
        targets: chosen.map((sns) => ({ sns, bodyOverride: overrides[sns] ?? null, title: SNS[sns].needsTitle ? (titles[sns] ?? null) : null })),
      });
      // 成功時はサーバーで画面を移るので、ここに来るのは失敗したときだけ
      if (res) setResult(res);
    });
  }

  // 保存・送信のあとに移ってきたら（?done=…）、上の知らせと送信の結果が見えるように、いちばん上に戻す
  useEffect(() => {
    if (notice) window.scrollTo({ top: 0 });
  }, [notice]);

  const fe = result.fieldErrors ?? {};
  const focusLabel = SNS[focus].label;
  const hasOverride = overrides[focus] !== undefined;
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

  // 削除する（確かめてから）。送った投稿では、SNS の投稿は消えず矢書の記録だけが消えることを書く
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
              const res = await deletePost(projectId, postId);
              if (res?.error) {
                setResult({ error: res.error });
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
        {sent ? "矢書から削除する" : "削除する"}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 見出し。新しい投稿は、自分で書くか AI とネタを出すかの札を横に並べる（AI を使わなくても書いて送れることがわかるように） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[26px] font-bold max-sm:text-[22px]">{postId ? (sentAny ? "送った投稿" : "下書き") : "投稿をつくる"}</h1>
        {!postId && <ComposeStart projectId={projectId} aiEnabled={aiCheckEnabled} />}
        {postId && <span className="text-[15px] text-faint">{sentAny ? "送った SNS は選び直せません" : "保存済み"}</span>}
      </div>

      {/* 保存・送信の知らせと、送信の結果（送ったあとはこの投稿の画面に移り、ここに結果が出る） */}
      {notice && (noticeTone === "error" ? <ErrorBanner>{notice}</ErrorBanner> : <SuccessBanner>{notice}</SuccessBanner>)}
      {postId && <SendResults projectId={projectId} postId={postId} results={results} />}

      <div className="grid grid-cols-[minmax(0,1.03fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        {/* 左: 本文・送り先・短縮リンク・日時・送る */}
        <div className="flex min-w-0 flex-col gap-3">
          <section aria-labelledby="draft-heading" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="draft-heading" className="text-[18px] font-bold max-sm:text-[16px]">
                本文
              </h2>
              {plannedLabel && <span className="num text-[15px] text-faint">{plannedLabel} {sentAny ? "に送信" : "予約"}</span>}
            </div>

            {result.error && <ErrorBanner>{result.error}</ErrorBanner>}

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
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  clearFieldError("body");
                }}
                placeholder="伝えたいことを、自分の言葉で書きます"
                aria-invalid={fe.body ? true : undefined}
                className="min-h-[148px] w-full resize-y bg-transparent text-[17px] leading-[1.75] text-fg outline-none placeholder:text-faint max-sm:min-h-[120px] max-sm:text-[16px]"
              />
              <span className={`num self-end text-[13px] ${checks[focus].issues.includes("too_long") ? "font-bold text-danger" : "text-faint"}`}>
                {countText(focus)}
                {chosen.length > 1 && <span className="sr-only">（{focusLabel}）</span>}
              </span>
            </div>
            {fe.body && <p className="text-sm font-semibold text-danger">{fe.body}</p>}

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
                  return (
                    <li key={sns}>
                      <label className={`flex h-11 items-center gap-3 rounded-md border px-3.5 text-[15px] ${on ? "border-border bg-surface" : "border-line bg-surface2"}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={isLocked(sns)}
                          onChange={() => toggle(sns)}
                          className="size-[18px] shrink-0 accent-[var(--primary)]"
                        />
                        <span className={on ? "font-bold" : "text-muted"}>{SNS[sns].label}</span>
                        {overrides[sns] !== undefined && <span className="text-xs text-muted">✎ 文面を変更</span>}
                        <span className="ml-auto flex items-center gap-2 text-[13px]">
                          {on && !isLocked(sns) && <span className="num text-faint">{countText(sns)}</span>}
                          {state && <span className={state.tone}>{state.text}</span>}
                        </span>
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
                  矢書が数えた、直近 90 日のあなたの数字です（{timeHint.kind === "views" ? "送った時間帯ごとの 1 本あたりの閲覧数" : "短縮リンクが押された時間帯"}）。傾向であって、この時間に送れば必ず見られるわけではありません。くわしくはカレンダーの「時間帯の傾向」で見られます。
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
                <Button type="button" size="lg" disabled={pending || blocker !== null} onClick={() => submit("schedule")} className="w-full">
                  {labels.schedule}
                </Button>
                <p className={`text-[13px] ${fe.plannedAt || blocker ? "text-signal" : "text-faint"}`}>
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
                      {labels.now}
                    </Button>
                  )}
                  <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit("draft")}>
                    下書きに保存する
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
                    placeholder="例: 個人開発で家計簿アプリを 3 か月作って気づいたこと"
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
                  が範囲の外です。スマホのスクリーンショット（縦長すぎる）は、上下を切って 4:5 に近づけてください。
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
                    rows={SNS[focus].needsTitle ? 12 : 4}
                    value={overrides[focus]}
                    onChange={(e) => setOverrides((o) => ({ ...o, [focus]: e.target.value }))}
                    className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
                  />
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
                  <HelpTip label="SNS ごとの文面">字数を収めたいときや、ハッシュタグ・言い回しを SNS に合わせたいときに。ほかの SNS は共通の文面のままです。</HelpTip>
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

// ロードマップのやることから作るときの手がかり（4.23）。題と説明は本文に入れず、「本文に入れる」で手がかりとして入れられる
function RoadmapItemHint({ item, onInsert }: { item: { title: string; detail: string }; onInsert: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface2 px-4 py-3 text-[13px] leading-[1.7]">
      <p className="flex items-center gap-1.5 text-muted">
        ロードマップのやることから
        <HelpTip label="ロードマップのやること">送ると、このやることの進み具合に数えます。</HelpTip>
      </p>
      <p className="text-[15px] font-bold">{item.title}</p>
      {item.detail && <p className="text-muted">{item.detail}</p>}
      <button type="button" onClick={onInsert} className="self-start font-semibold underline">
        題と説明を本文に入れる
      </button>
    </div>
  );
}
