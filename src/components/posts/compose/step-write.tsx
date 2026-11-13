"use client";

import Link from "next/link";
import { chipClass } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";
import { SELF_WRITTEN_ENOUGH } from "@/lib/plan/voice-rules";
import { VoiceInputButton } from "@/components/ui/voice-input";
import { TidyDraftPanel } from "../tidy-draft-panel";
import { PostFormatPicker } from "../post-format-picker";
import { insertFormatted } from "@/lib/post-formats/schema";
import { SNS } from "@/lib/sns";
import { isSideBySide, type Composer } from "./use-composer";

// ① 書く: 本文・AI で整える・書いたのは誰（docs/design/compose-steps.md）。見出し・リセット・保存のエラー・書きかけの帯は、どのステップでも見えるよう上の帯（compose-top.tsx）に置く
export function ComposeStepWrite({ c, steps = false }: { c: Composer; steps?: boolean }) {
  const { connected, addRoundId, goStep, formatUse, bodyUnused, setFormatUse, applyFormatTags, planHints, projectId, initial, aiCheckEnabled, selfWrittenPosts, hasVoiceMemo, body, setBody, bodyRef, overrides, setOverrides, setFocus, setTidyAdopted, textOrigin, setTextOrigin, noteIds, markTyped, resetRound, checks, sentAny, chosen, focus, toSend, clearFieldError, showBody, editOverride, fe, focusLabel, splitSns, bodySns, countText } = c;
  return (
    <>
      {/* 投稿のフォーマット（docs/design/post-formats.md の 4）。穴を埋めて本文に入れる。穴の言葉は利用者が打ったものなので、書きかけの控えに乗せる */}
      {!sentAny && (
        <PostFormatPicker
          // 同じ並びの TidyDraftPanel も resetRound を key にしているので、かぶらないように分ける（かぶると React が部品を重ねて描く）
          key={`format-${resetRound}`}
          projectId={projectId}
          bodyHasText={body.trim() !== ""}
          pillars={(planHints?.pillars ?? []).map((p) => p.name).filter(Boolean)}
          planHashtags={planHints?.hashtags ?? []}
          connected={connected}
          aiEnabled={aiCheckEnabled}
          onInsert={(text, how, hashtags) => {
            applyFormatTags(hashtags);
            markTyped();
            setBody((b) => insertFormatted(b, text, how));
            clearFieldError("body");
          }}
          onUseChange={setFormatUse}
          initialFormatId={initial.formatId ?? null}
          onRoundAdded={addRoundId}
        />
      )}

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
            markTyped();
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
              markTyped();
              setBody(v);
              clearFieldError("body");
            }}
          />
          {/* 本文で送る SNS がない（どれも SNS ごとの文面）ときは、本文の字数は出さない（ほかの SNS の文面の字数に見えるため） */}
          {!bodyUnused && (
            <span className={`num shrink-0 pt-1.5 text-[13px] ${checks[bodySns].issues.includes("too_long") ? "font-bold text-danger" : "text-faint"}`}>
              {bodySns !== focus && <span className="mr-1">{SNS[bodySns].label}</span>}
              {countText(bodySns)}
              {chosen.length > 1 && bodySns === focus && <span className="sr-only">（{focusLabel}）</span>}
            </span>
          )}
        </div>
      </div>
      {fe.body && <p className="text-sm font-semibold text-danger">{fe.body}</p>}
      {/* SNS ごとの文面がある SNS は、本文を直しても変わらない。そのことと、その欄へ行くボタンを 1 行で（AI の案を使ったあとも出す） */}
      {splitSns.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span>
            {splitSns.map((s) => SNS[s].label).join("・")} は SNS ごとの文面で送ります{bodyUnused ? "（この本文は使いません）" : ""}。本文をあとで直しても、SNS ごとの文面には届きません。
          </span>
          {splitSns.map((s) => (
            <button key={s} type="button" onClick={() => editOverride(s)} className="font-semibold text-fg underline underline-offset-2">
              {SNS[s].label} 用の文面を直す
            </button>
          ))}
        </p>
      )}
      {/* 送り先をすべて送り終えた投稿では、整えても送れないので出さない */}
      {/* 最初の数本は自分の言葉で（文調のメモの材料。押しつけない。説明は畳む） */}
      {selfWrittenPosts !== null && !hasVoiceMemo && <SelfWrittenHint projectId={projectId} count={selfWrittenPosts} />}
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
          onPickSns={steps ? () => goStep(2) : undefined}
          onAdoptedChange={(adopted) => {
            setTidyAdopted(adopted);
            if (adopted) setTextOrigin("ai");
          }}
          format={formatUse}
        />
      )}
      {/* ステップの画面では、整える SNS（いまの送り先）を 1 行で添える（送り先は ② で選ぶ。compose-steps.md の 2.） */}
      {steps && aiCheckEnabled && toSend.length > 0 && (!sentAny || toSend.length > 0) && (
        <p className="-mt-1.5 text-[13px] text-muted">{toSend.map((s) => SNS[s].label).join("・")} 向けに整えます（送り先は次のステップで変えられます）</p>
      )}
      <TextOriginChoice value={textOrigin} onChange={setTextOrigin} />
      {noteIds.length > 0 && (
        <p className="text-[13px] text-muted">ネタ帳のメモ {noteIds.length} 件から。保存すると、ネタ帳でそのメモに「投稿にした」の印が付きます。</p>
      )}
    </>
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

// 「最初は自分で書く」のすすめ（自分で書いて送った投稿が 5 本未満のとき）と、5 本たまったら書き方を読み取る案内（docs/design/voice-from-posts.md の 3.4）
function SelfWrittenHint({ projectId, count }: { projectId: string; count: number }) {
  if (count >= SELF_WRITTEN_ENOUGH) {
    return (
      <p className="text-[13px] text-muted">
        自分で書いて送った投稿が {SELF_WRITTEN_ENOUGH} 本たまりました。AI があなたの書き方を読み取れます。
        <Link href={`/projects/${projectId}/plan?open=voice`} className="ml-1 font-semibold text-fg underline underline-offset-2">
          書き方を読み取る
        </Link>
      </p>
    );
  }
  return (
    <div className="text-[13px] text-muted">
      最初の数本は、自分の言葉で書くのがおすすめです
      {/* 「?」が行の頭に 1 つだけ回らないよう、本数と「?」をひとまとまりにする */}
      <span className="ml-0.5 inline-flex items-center gap-2 whitespace-nowrap align-middle">
        <span>
          （いま <span className="num">{count}/{SELF_WRITTEN_ENOUGH}</span> 本）
        </span>
        <HelpTip label="自分の言葉で書く理由">
          AI まかせの投稿は、どうしても人間らしさが出にくくなります。自分で書いて送った投稿が {SELF_WRITTEN_ENOUGH} 本たまると、AI があなたの書き方（文の長さ・語尾・絵文字・改行など）を読み取り、ネタ出しや「AI で整える」の文をあなたの書き方に寄せられるようになります。AI で整える・ネタ出しは、いつでも使えます。
        </HelpTip>
      </span>
    </div>
  );
}

// 本文を書いたのは誰か。自分で書いた投稿だけを、あとで AI が書き方を読み取る材料にする
function TextOriginChoice({ value, onChange }: { value: "self" | "ai"; onChange: (v: "self" | "ai") => void }) {
  return (
    <div role="radiogroup" aria-label="この本文を書いたのは" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
      <span>この本文は</span>
      {(["self", "ai"] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={chipClass({ on: value === v, className: "h-7 px-2.5 text-[12px]" })}>
          {v === "self" ? "自分で書いた" : "AI の文をもとにした"}
        </button>
      ))}
      <HelpTip label="この本文を書いたのは">
        自分で書いた投稿だけを、あとで AI があなたの書き方を読み取る材料にします。「AI で整える」の案を使うと、「AI の文をもとにした」になります。大きく自分で直したときは「自分で書いた」に戻して構いません。
      </HelpTip>
    </div>
  );
}
