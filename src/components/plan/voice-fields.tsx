"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help";
import { draftVoiceMemo, listVoiceMaterial, type VoiceMaterialItem } from "@/lib/ai/voice-memo-actions";
import { MAX_VOICE_EXAMPLES, type PlanData } from "@/lib/plan/schema";
import { VOICE_MEMO_FIELDS, VOICE_MEMO_LABEL, type VoiceMemoField } from "@/lib/plan/voice";
import { SELF_WRITTEN_ENOUGH, VOICE_MEMO_DAILY_RUNS } from "@/lib/plan/voice-rules";
import { SNS, isSnsKey } from "@/lib/sns";

// 書き方（文調のメモ。docs/design/voice-from-posts.md の 3.2）。本人が書いて送った投稿から AI が書き方を読み取り、利用者が直して保存する。
// 欄は memo-<項目>・example（例の投稿の配信先の id）・conflict（口調と違うところ）・builtAt・sourceCount
export function VoiceFields({ v, projectId, aiEnabled, selfWritten, exampleHeads }: { v: PlanData["voice"]; projectId: string; aiEnabled: boolean; selfWritten: number; exampleHeads: Record<string, string> }) {
  const [memo, setMemo] = useState<Record<VoiceMemoField, string>>(v.memo);
  const [examples, setExamples] = useState<string[]>(v.examples);
  const [conflicts, setConflicts] = useState<string[]>(v.conflicts);
  const [builtAt, setBuiltAt] = useState(v.builtAt);
  const [sourceCount, setSourceCount] = useState(v.sourceCount);
  const [items, setItems] = useState<VoiceMaterialItem[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState(false);
  const [loading, startLoad] = useTransition();
  const [drafting, startDraft] = useTransition();
  const enough = selfWritten >= SELF_WRITTEN_ENOUGH;
  const hasMemo = VOICE_MEMO_FIELDS.some((f) => memo[f].trim());

  function openList() {
    startLoad(async () => {
      setError(null);
      const r = await listVoiceMaterial(projectId);
      if (r.error || !r.items) setError(r.error ?? "投稿を読み込めませんでした。");
      else setItems(r.items);
    });
  }

  function draft() {
    startDraft(async () => {
      setError(null);
      const r = await draftVoiceMemo(projectId, [...excluded]);
      if (r.error || !r.draft) {
        setError(r.error ?? "うまくいきませんでした。");
        return;
      }
      setMemo(r.draft.memo);
      setConflicts(r.draft.conflicts);
      setExamples(r.draft.examples);
      setBuiltAt(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));
      setSourceCount(r.sourceCount ?? null);
      setDrafted(true);
    });
  }

  const toggleExample = (id: string) =>
    setExamples((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= MAX_VOICE_EXAMPLES ? xs : [...xs, id]));
  const included = items?.filter((i) => !excluded.has(i.targetId)) ?? [];

  return (
    <>
      <p className="-mb-1 text-xs leading-[1.7] text-muted">
        自分で書いて送った投稿から、AI があなたの書き方（文の長さ・語尾・絵文字・改行など）を読み取ります。ネタ出し・「AI で整える」・見直し・相談の AI が、この書き方に寄せます。「AI の文をもとにした」投稿は使いません。
      </p>

      {/* 材料の一覧と、AI に読み取ってもらう */}
      <div className="flex flex-col gap-3 rounded-md border border-line px-4 py-3 max-sm:px-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {enough ? (
            <span>
              自分で書いて送った投稿: <b className="num">{selfWritten}</b> 本
            </span>
          ) : (
            <span>
              自分で書いて送った投稿が {SELF_WRITTEN_ENOUGH} 本たまると、AI があなたの書き方を読み取れます（いま <b className="num">{selfWritten}</b> 本）
            </span>
          )}
          {enough && !items && (
            <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={openList}>
              {loading ? "読み込んでいます…" : hasMemo ? "読み取り直す・例を選び直す" : "書き方を読み取る"}
            </Button>
          )}
        </div>
        {items && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-xs text-muted">
              材料にする投稿（新しい順）。外したい投稿はチェックを外します。「例」は AI に見せる投稿で、{MAX_VOICE_EXAMPLES} 本まで選べます。
              <HelpTip label="例に選ぶ投稿">
                例に選んだ投稿は、ネタ出しや「AI で整える」のたびに、AI に見せます（言い回しや中身は写さず、書き方だけを寄せます）。いちばん自分らしいと思う投稿を選んでください。
              </HelpTip>
            </p>
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2">
              {items.map((it) => {
                const on = !excluded.has(it.targetId);
                const ex = examples.includes(it.targetId);
                return (
                  <li key={it.targetId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label="材料に入れる"
                      checked={on}
                      onChange={() =>
                        setExcluded((s) => {
                          const n = new Set(s);
                          if (on) n.add(it.targetId);
                          else n.delete(it.targetId);
                          return n;
                        })
                      }
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="shrink-0 text-xs text-muted">{isSnsKey(it.sns) ? SNS[it.sns].label : it.sns}</span>
                    <span className="min-w-0 flex-1 truncate">{it.head}</span>
                    <button
                      type="button"
                      aria-pressed={ex}
                      disabled={!on || (!ex && examples.length >= MAX_VOICE_EXAMPLES)}
                      onClick={() => toggleExample(it.targetId)}
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs disabled:opacity-40 ${ex ? "border-primary bg-primary-soft font-bold text-primary" : "border-border text-muted"}`}
                    >
                      例
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {aiEnabled ? (
                <Button type="button" size="sm" disabled={drafting || included.length < SELF_WRITTEN_ENOUGH} onClick={draft}>
                  {drafting ? "読み取っています…" : `AI に読み取ってもらう（${included.length} 本）`}
                </Button>
              ) : (
                <NotReadyButton size="sm">AI に読み取ってもらう</NotReadyButton>
              )}
              <span className="text-xs text-muted">1 回 20 円ほど。1 日 {VOICE_MEMO_DAILY_RUNS} 回まで</span>
            </div>
            {drafting && <AiThinking kind="brief" note="10〜20 秒ほどかかります" />}
          </div>
        )}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {drafted && <p className="text-xs font-semibold text-success">下の欄に入れました。直してから「保存する」を押してください。</p>}
      </div>

      {conflicts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-surface2 px-4 py-3 text-sm max-sm:px-3">
          <p className="font-bold">
            <span className="text-signal">●</span> 口調（投稿の柱）と違うところ
          </p>
          <ul className="list-disc pl-5 text-[13px] leading-[1.7]">
            {conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            どちらに合わせるか決めて、口調か、下の書き方を直してください。
            <Link href={`/projects/${projectId}/plan?open=pillars`} className="ml-1 underline">
              口調を直す
            </Link>
          </p>
        </div>
      )}

      {VOICE_MEMO_FIELDS.map((f) => (
        <label key={f} className="flex flex-col gap-1.5">
          <span className="text-[14px] font-bold">{VOICE_MEMO_LABEL[f]}</span>
          <Textarea name={`memo-${f}`} value={memo[f]} maxLength={200} rows={2} onChange={(e) => setMemo((m) => ({ ...m, [f]: e.target.value }))} />
        </label>
      ))}

      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-bold">AI に見せる例の投稿（{examples.length}/{MAX_VOICE_EXAMPLES}）</span>
        {examples.length === 0 ? (
          <p className="text-xs text-muted">まだ選んでいません。「書き方を読み取る」の一覧で「例」を押して選びます。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {examples.map((id) => {
              const it = items?.find((i) => i.targetId === id);
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{it?.head ?? exampleHeads[id] ?? "選んだ投稿"}</span>
                  <button type="button" onClick={() => setExamples((xs) => xs.filter((x) => x !== id))} className="text-xs text-muted underline hover:text-fg">
                    外す
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {examples.map((id) => (
        <input key={id} type="hidden" name="example" value={id} />
      ))}
      {conflicts.map((c) => (
        <input key={c} type="hidden" name="conflict" value={c} />
      ))}
      <input type="hidden" name="builtAt" value={builtAt ?? ""} />
      <input type="hidden" name="sourceCount" value={sourceCount ?? ""} />
      {builtAt && (
        <p className="text-xs text-muted">
          {builtAt.slice(5).replace("-", "/")} に、自分で書いた投稿 {sourceCount ?? "—"} 本から読み取りました。
        </p>
      )}
    </>
  );
}
