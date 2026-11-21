"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FormatEditor } from "@/components/formats/format-manager";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { SnsTag } from "@/components/ui/marks";
import { draftFormatsFromPosts } from "@/lib/ai/post-format-actions";
import type { FromPostsFit, FromPostsProposal } from "@/lib/ai/format-from-posts";
import { MAX_SOURCE_POSTS } from "@/lib/post-formats/from-posts";
import { MIN_POSTS, hitText } from "@/lib/metrics/winners";
import type { WinnersView } from "@/lib/metrics/winners-queries";
import { addPostFormat } from "@/lib/post-formats/actions";
import { POST_FORMAT_DAILY_RUNS, type PostFormatInput } from "@/lib/post-formats/schema";
import { isSeries } from "@/lib/post-formats/series";
import { SNS, type SnsKey } from "@/lib/sns";
import { formatShort } from "@/lib/time";
import { DisclosureBox } from "@/components/ui/disclosure";
import { AiQuotaNote } from "@/components/ai/ai-quota-note";
import { useAiQuota } from "@/components/ai/use-ai-quota";

// 伸びた投稿 → 型の案（AI。押したときだけ）→ 選んで直して保存 → 自動の投稿を始める画面へ（docs/design/winning-posts.md の 5.）。
// どの段も、利用者が押したときだけ進む。保存したあとも、自動の投稿は「始める」の画面で確かめて同意するまで作らない

type Saved = { id: string; name: string; series: boolean };

export function WinnersScreen({
  projectId,
  view,
  pillars,
  planHashtags,
  connected,
  aiEnabled,
  held,
}: {
  projectId: string;
  view: WinnersView;
  pillars: string[];
  planHashtags: string[];
  connected: SnsKey[];
  aiEnabled: boolean;
  held: boolean;
}) {
  // AI を使える量を使い切っているときは押せない（理由はボタンの下に 1 行）
  const quota = useAiQuota("post_format", aiEnabled);
  const base = `/projects/${projectId}`;
  // はじめは上から 2 本を選んでおく（もうフォーマットで書いた投稿は、そのフォーマットを使えばよいので選ばない）
  const [picked, setPicked] = useState<string[]>(() =>
    view.winners
      .filter((w) => !w.formatId)
      .slice(0, 2)
      .map((w) => w.postId),
  );
  const [result, setResult] = useState<{ fit: FromPostsFit; fitReason: string; proposals: FromPostsProposal[] } | null>(null);
  const [editing, setEditing] = useState<FromPostsProposal | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  // 自動の投稿を始める画面に渡す投稿（選んだうちで、いちばん伸びたもの。SNS と時間帯はサーバーが判定し直して決める）
  const lead = view.winners.find((w) => picked.includes(w.postId));

  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_SOURCE_POSTS ? p : [...p, id]));
    setResult(null);
    setEditing(null);
    setSaved(null);
  };
  const ask = () =>
    start(async () => {
      setError(null);
      setEditing(null);
      setSaved(null);
      const r = await draftFormatsFromPosts(projectId, picked);
      if (r.error || !r.fit) return setError(r.error ?? "うまくいきませんでした。");
      setResult({ fit: r.fit, fitReason: r.fitReason ?? "", proposals: r.proposals ?? [] });
    });
  const save = (v: PostFormatInput) =>
    startSave(async () => {
      setError(null);
      const r = await addPostFormat(projectId, v);
      if (r.error) return setError(r.error);
      const f = r.formats?.find((x) => x.name === v.name);
      if (!f) return setError("保存したフォーマットが見つかりませんでした。フォーマットの画面で確認してください。");
      setSaved({ id: f.id, name: f.name, series: isSeries(f.series) });
      setEditing(null);
    });

  if (!view.winners.length) return <NoWinners view={view} base={base} />;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 px-5 py-4 max-sm:px-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[18px] font-bold">いつもより伸びた投稿</h2>
          <p className="text-[14px] text-muted">型にしたい投稿を選びます（{MAX_SOURCE_POSTS} 本まで）。似た組み立ての投稿を一緒に選ぶと、型の案が確かになります。</p>
        </div>
        <ul className="flex flex-col divide-y divide-line">
          {view.winners.map((w) => {
            const on = picked.includes(w.postId);
            return (
              <li key={w.postId} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={on} onChange={() => toggle(w.postId)} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[15px] font-bold">{w.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                      {w.hits.map((h) => (
                        <span key={h.sns} className="flex items-center gap-1.5">
                          <SnsTag sns={h.sns} />
                          <span className="num">{hitText(h)}</span>
                        </span>
                      ))}
                      <span className="num text-faint">{formatShort(w.publishedAt)}</span>
                    </span>
                  </span>
                </label>
                {w.formatId && (
                  <p className="ml-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span className="text-muted">フォーマット「{w.formatName}」で書いた投稿です</span>
                    {w.autoPlanId ? (
                      <Link href={`${base}/auto/${w.autoPlanId}/edit`} className="font-bold underline">
                        回す回数を見直す →
                      </Link>
                    ) : w.formatSeries && !held ? (
                      <Link href={`${base}/auto/new?format=${w.formatId}&post=${w.postId}`} className="font-bold underline">
                        このフォーマットで自動で回す →
                      </Link>
                    ) : !w.formatSeries ? (
                      <Link href={`${base}/formats`} className="font-bold underline">
                        AI が埋める空欄を決めると、自動で回せます →
                      </Link>
                    ) : null}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {aiEnabled ? (
            <Button disabled={pending || !picked.length || quota.blocked !== null} onClick={ask} className="max-sm:w-full">
              {pending ? "考えています…" : result ? "型の案を出し直す" : "型の案を作る"}
            </Button>
          ) : (
            <NotReadyButton className="max-sm:w-full">型の案を作る</NotReadyButton>
          )}
          {quota.blocked && (
            <div className="basis-full">
              <AiQuotaNote blocked={quota.blocked} />
            </div>
          )}
          <span className="text-xs text-muted">AI を使います。1 回 10〜15 円ほど。「AI とつくる」と合わせて 1 日 {POST_FORMAT_DAILY_RUNS} 回まで</span>
        </div>
        {pending && <AiThinking kind="brief" note="10〜20 秒ほどかかります" />}
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </Card>

      {result && !pending && (
        <Card className="flex flex-col gap-3 px-5 py-4 max-sm:px-4">
          <h2 className="text-[18px] font-bold">型の案</h2>
          {result.fit === "none" || !result.proposals.length ? (
            <p className="text-[14px] text-muted">
              この投稿は、その時だけの話題なので、型にしにくいです。{result.fitReason && <>（{result.fitReason}）</>}ほかの投稿を選ぶと、型にできることがあります。
            </p>
          ) : (
            <>
              {result.fitReason && <p className="text-[14px] text-muted">{result.fitReason}</p>}
              <ul className="flex flex-col gap-3">
                {result.proposals.map((p) => {
                  const auto = isSeries(p.series);
                  return (
                    <li key={p.name} className="flex flex-col gap-1.5 rounded-md border border-line px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-bold">{p.name}</span>
                        <Badge>{auto ? "自動で回せる" : "自分で埋めて使う"}</Badge>
                        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => (setEditing(p), setSaved(null))}>
                          これを使う
                        </Button>
                      </div>
                      {p.purpose && <p className="text-xs text-muted">{p.purpose}</p>}
                      <p className="rounded-md bg-surface2 px-3 py-2 text-[13px] leading-[1.7] whitespace-pre-wrap">{p.body}</p>
                      {p.why && <p className="text-xs leading-[1.7] text-muted">{p.why}</p>}
                      {auto ? (
                        <p className="text-xs leading-[1.7] text-muted">変数はどれも、毎回 AI が考えます（{p.series.vars.map((v) => `{${v.name}}: ${v.instruction}`).join("　")}）</p>
                      ) : (
                        <p className="text-xs leading-[1.7] text-muted">
                          {result.fit === "auto"
                            ? "AI が毎回埋める指示がそろっていない空欄があるので、投稿をつくるときに自分で埋める型にしました。保存したあと、フォーマットの画面で空欄ごとに「AI が埋める」を決めると、自動投稿に使えます。"
                            : "空欄の中身はあなたしか知らないこと（値段・日付など）なので、投稿をつくるときに自分で埋めます。自動投稿には使えません。"}
                        </p>
                      )}
                      {p.example && (
                        <DisclosureBox label="できあがりの例を表示">
                          <p className="text-[13px] leading-[1.7] whitespace-pre-wrap">{p.example}</p>
                        </DisclosureBox>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      )}

      {editing && (
        <Card className="flex flex-col gap-3 px-5 py-4 max-sm:px-4">
          <h2 className="text-[18px] font-bold">編集して保存する</h2>
          <FormatEditor
            key={editing.name}
            projectId={projectId}
            initial={{ name: editing.name, purpose: editing.purpose, body: editing.body, example: editing.example, pillar: "", hashtags: {}, series: editing.series }}
            pillars={pillars}
            planHashtags={planHashtags}
            connected={connected}
            pending={saving}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        </Card>
      )}

      {saved && (
        <SuccessBanner>
          <span className="flex flex-col gap-2">
            <span>フォーマット「{saved.name}」を保存しました。</span>
            {saved.series && !held ? (
              <span className="flex flex-col gap-2">
                <span>この型で自動投稿を始めると、{lead ? `伸びた ${lead.hits.map((h) => SNS[h.sns].label).join("・")} と時間帯を` : "SNS と時間帯を"}選んだ状態で開きます。始めるのは、中身を確認したあとです。</span>
                <ButtonLink href={`${base}/auto/new?format=${saved.id}${lead ? `&post=${lead.postId}` : ""}`} className="self-start max-sm:w-full">
                  この型で自動で回す
                </ButtonLink>
              </span>
            ) : (
              <Link href={`${base}/compose`} className="font-bold underline">
                投稿をつくるの「フォーマットから」で使う →
              </Link>
            )}
          </span>
        </SuccessBanner>
      )}
    </div>
  );
}

// 伸びた投稿がないとき。SNS ごとに、あと何本で判定できるかを出す（数が少ないうちは判定しない）
function NoWinners({ view, base }: { view: WinnersView; base: string }) {
  const waiting = view.bySns.filter((s) => s.need > 0);
  return (
    <Card className="flex flex-col gap-2 px-5 py-4 max-sm:px-4">
      <h2 className="text-[18px] font-bold">伸びた投稿は、まだありません</h2>
      {view.bySns.length === 0 ? (
        <p className="text-[14px] text-muted">
          送って 7 日たった投稿で、数字が取れているものがまだありません。Threads・Instagram・Facebook を数字の権限つきでつなぐか、note・Substack の数字を記録すると、ここに出ます。
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-[14px] text-muted">
          {view.bySns.map((s) => (
            <li key={s.sns} className="flex flex-wrap items-center gap-2">
              <SnsTag sns={s.sns} />
              {s.need > 0 ? (
                <span>
                  あと <span className="num">{s.need}</span> 本送ると、伸びた投稿がわかります（<span className="num">{MIN_POSTS}</span> 本から比べます）
                </span>
              ) : (
                <span>いつもの 1.5 倍を超えた投稿は、まだありません</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <Link href={`${base}/compose`} className="text-[14px] font-bold underline">
          投稿をつくる →
        </Link>
      )}
    </Card>
  );
}
