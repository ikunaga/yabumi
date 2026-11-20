"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, Chip } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { SnsTag } from "@/components/ui/marks";
import { Steps } from "@/components/ui/steps";
import { saveAutoPlan } from "@/lib/auto-post/actions";
import { isReviewOnlySns, KIND_LABELS, TARGET_MODE_LABELS } from "@/lib/auto-post/labels";
import { runsPerMonth } from "@/lib/auto-post/schedule";
import { AUTO_NAME_MAX, DEFAULT_LEAD_HOURS } from "@/lib/auto-post/schema";
import { suggestSchedules, type KindSuggestion, type SuggestMaterials } from "@/lib/auto-post/suggest";
import {
  AUTO_KINDS_STAGE_A,
  AUTO_SNS_STAGE_A,
  TARGET_MODES,
  type AutoKind,
  type AutoImage,
  type AutoMaterials,
  type AutoPlan,
  type AutoPlanInput,
  type AutoSample,
  type AutoSchedule,
  type AutoTargets,
  type TargetMode,
} from "@/lib/auto-post/types";
import type { SeriesFormatCard } from "@/lib/auto-post/ui-queries";
import type { TimeTrends } from "@/lib/metrics/time-bands";
import { SNS, type SnsKey } from "@/lib/sns";
import { scheduleText } from "./format";
import { choiceKey, kindCards, KindPicker, type KindChoice, type WinnersCard } from "./kind-picker";
import { ReviewFlow, ReviewReason, StageCSns } from "./review-why";
import { ImagePicker } from "./image-picker";
import { SampleCard } from "./sample-card";

// 自動の投稿を始める・直す（docs/design/auto-post.md の 1.4・1.5・1.7）。
// 「1 何を › 2 どこに › 3 どのくらい › 4 確かめる」。いまのステップの項目だけ出す。何を・どのくらいの案は AI を呼ばずに決まりで出す（suggest.ts）

export type WizardMaterials = {
  counts: SuggestMaterials;
  seriesFormats: SeriesFormatCard[];
  destinations: { id: string; label: string }[];
  events: number;
  pillars: number;
  pillarNames: string[];
};

type Props = {
  projectId: string;
  plan: AutoPlan | null; // 直すときだけ
  materials: WizardMaterials;
  kindSuggestion: KindSuggestion;
  connected: SnsKey[];
  planRoles: SnsKey[];
  trends: TimeTrends | null;
  planFrequency: string | null;
  today: string; // 日本時間の YYYY-MM-DD（数え始めの日）
  isApp: boolean; // 宣伝するものがアプリか（「開発の進み」を出すか）
  // 伸びた投稿から来たとき（docs/design/winning-posts.md の 5.）。そのシリーズのフォーマット・伸びた SNS・時刻を選んでおく（始めるのは利用者）
  preset?: WizardPreset | null;
  // 「伸びた投稿から」のカード（始めるときだけ。docs/design/winning-posts.md の 3. の A）
  winners?: WinnersCard | null;
  photo: { enabled: boolean; acknowledged: boolean }; // 自動の回の画像（鍵があるか・AI の画像の注意を読んだか）
};

export type WizardPreset = { formatId: string; sns: SnsKey[]; time: string | null; timeReason: string };

type Step = "what" | "where" | "when" | "confirm";
const STEPS: { key: Step; label: string }[] = [
  { key: "what", label: "何を" },
  { key: "where", label: "どこに" },
  { key: "when", label: "どのくらい" },
  { key: "confirm", label: "確かめる" },
];

const WEEKDAYS: { n: number; label: string }[] = [
  { n: 1, label: "月" },
  { n: 2, label: "火" },
  { n: 3, label: "水" },
  { n: 4, label: "木" },
  { n: 5, label: "金" },
  { n: 6, label: "土" },
  { n: 7, label: "日" },
];
const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

// 1 回の見込み（docs/design/auto-post.md の 5.1。1 ドル 150 円）
const AI_USD_PER_RUN = 0.08;
const X_USD = { never: 0.015, always: 0.205 } as const;
const YEN = 150;
const IMAGE_USD_PER_RUN = 0.05;

export function PlanWizard(p: Props) {
  const router = useRouter();
  const editing = !!p.plan;
  const [step, setStep] = useState<Step>(editing ? "confirm" : "what");
  const cards = kindCards(
    {
      seriesFormats: p.materials.seriesFormats,
      destinations: p.materials.destinations,
      events: p.materials.events,
      pillarNames: p.materials.pillarNames,
      unusedNotes: p.materials.counts.unusedNotes,
      unusedPhotoNotes: p.materials.counts.unusedPhotoNotes,
    },
    p.projectId,
    `/projects/${p.projectId}/formats`,
  );
  // おすすめのカード（シリーズは最初のフォーマット）。直すときは出さない
  const presetCard = editing || !p.preset ? null : (cards.find((c) => c.choice.kind === "series" && c.choice.formatId === p.preset!.formatId && !c.off) ?? null);
  const suggested = editing ? null : (presetCard ?? cards.find((c) => c.choice.kind === p.kindSuggestion.kind && !c.off) ?? null);
  // 始めるときは、おすすめを初めから選んでおく
  const [kind, setKind] = useState<AutoKind | null>(p.plan?.kind ?? suggested?.choice.kind ?? null);
  const [materials, setMaterials] = useState<AutoMaterials>(p.plan?.materials ?? (suggested?.choice.formatId ? { format_id: suggested.choice.formatId } : {}));
  // 種類を選び直したら、前の種類の材料の設定は残さない（直すときに元の種類へ戻したら、元の設定に戻す）
  const pick = (c: KindChoice) => {
    if (choiceKey(c) === choiceKey(kind ? { kind, formatId: materials.format_id } : null)) return;
    const original = p.plan && choiceKey({ kind: p.plan.kind, formatId: p.plan.materials.format_id }) === choiceKey(c);
    setKind(c.kind);
    setMaterials(original ? p.plan!.materials : c.formatId ? { format_id: c.formatId } : {});
    // 種類を選び直したら、画像の設定も選び直してもらう（フォーマットの画像・商品の紹介の写真は、種類で選べるかが変わる）
    setImage(original ? (p.plan!.image ?? null) : null);
    setSchedule(null);
  };
  const autoSns = AUTO_SNS_STAGE_A.filter((s) => p.connected.includes(s));
  const [targets, setTargets] = useState<AutoTargets>(() => {
    if (p.plan) return p.plan.targets;
    const fromPreset = presetCard ? autoSns.filter((s) => p.preset!.sns.includes(s)) : [];
    const preferred = fromPreset.length ? fromPreset : autoSns.filter((s) => p.planRoles.includes(s));
    const picked = preferred.length ? preferred : autoSns.filter((s) => s !== "note" && s !== "substack");
    return Object.fromEntries(picked.map((s) => [s, TARGET_MODES[s][0]]));
  });
  const [xLink, setXLink] = useState<"never" | "always">(p.plan?.xLink ?? "never");
  const [schedule, setSchedule] = useState<AutoSchedule | null>(p.plan?.schedule ?? null);
  const [custom, setCustom] = useState(false);
  const [instructions, setInstructions] = useState<string[]>(p.plan?.instructions ?? []);
  const [image, setImage] = useState<AutoImage | null>(p.plan?.image ?? null);
  const [photoAck, setPhotoAck] = useState(p.photo.acknowledged);
  const [name, setName] = useState(p.plan?.name ?? "");
  const [consent, setConsent] = useState(false);
  const [sample, setSample] = useState<AutoSample | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const snsList = Object.keys(targets) as SnsKey[];
  // 「確かめて送る」にした SNS（X・TikTok・YouTube は決まりで、Threads などは利用者が選んだとき）
  const reviewSns = snsList.filter((s) => targets[s] === "review");
  // 決まりで出すだけなので、描くたびに出し直す（安い）
  const options = kind
    ? suggestSchedules({
        kind,
        materials: p.materials.counts,
        targets: snsList,
        trends: p.trends,
        planFrequency: p.planFrequency,
        start: p.today,
        fromWinner: presetCard && p.preset?.time && kind === "series" && materials.format_id === p.preset.formatId ? { time: p.preset.time, reason: p.preset.timeReason } : undefined,
      })
    : [];
  const withStart = (s: AutoSchedule): AutoSchedule => ({
    ...s,
    start: s.start || p.today,
  });
  const effectiveSchedule = schedule ?? (options[0] ? withStart(options[0].schedule) : null);

  const whatOk = !!kind && AUTO_KINDS_STAGE_A.includes(kind) && (kind !== "series" || !!materials.format_id);
  const formatHasImage = kind === "series" && !!p.materials.seriesFormats.find((f) => f.id === materials.format_id)?.hasImage;
  const formatHasHeadline = kind === "series" && !!p.materials.seriesFormats.find((f) => f.id === materials.format_id)?.hasHeadline;
  // 画像を選んだら、AI の画像の注意を読んでから次へ（DB の save_auto_plan も断る）
  const whereOk = snsList.length > 0 && (!image || photoAck);
  const whenOk = !!effectiveSchedule && effectiveSchedule.weekdays.length > 0;

  const defaultName = kind === "series" ? (p.materials.seriesFormats.find((f) => f.id === materials.format_id)?.name ?? KIND_LABELS.series) : kind ? KIND_LABELS[kind] : "";
  const input = (): Omit<AutoPlanInput, "consent"> | null =>
    kind && effectiveSchedule
      ? {
          id: p.plan?.id,
          name: (name.trim() || defaultName).slice(0, AUTO_NAME_MAX),
          kind,
          materials,
          targets,
          xLink: targets.x ? xLink : "never",
          schedule: effectiveSchedule,
          instructions,
          image,
          leadHours: p.plan?.leadHours ?? DEFAULT_LEAD_HOURS,
        }
      : null;

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const monthly = effectiveSchedule ? runsPerMonth(effectiveSchedule) : 0;
  const aiYen = Math.round(monthly * AI_USD_PER_RUN * YEN);
  // 画像は 1 枚 約 $0.035、場面を Claude が書くと 約 $0.05（docs/design/auto-sample-image.md の 4.）。多めの $0.05 で数える
  const imageYen = image ? Math.round(monthly * IMAGE_USD_PER_RUN * YEN) : 0;
  const xYen = targets.x ? Math.round(monthly * X_USD[xLink] * YEN) : 0;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <div className="flex flex-col gap-3">
        <h1 className="text-[28px] leading-tight font-bold max-sm:text-[24px]">{editing ? "自動の投稿を編集" : "自動の投稿をはじめる"}</h1>
        <div className="max-sm:hidden">
          {/* ステップの印は押せない。動くのは下の「次へ」「戻る」だけ（投稿をつくると同じ。2026-11-15 オーナーの指示） */}
          <Steps steps={STEPS} current={step} canGo={() => false} onGo={() => {}} label="自動の投稿の段取り" />
        </div>
        <MobileSteps current={step} />
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {step === "what" && (
        <>
          <KindPicker
            cards={cards}
            value={kind ? choiceKey({ kind, formatId: materials.format_id }) : ""}
            suggestedKey={suggested?.key ?? null}
            isApp={p.isApp}
            winners={editing ? null : p.winners}
            winnersHref={`/projects/${p.projectId}/auto/winners`}
            onChange={pick}
          />

          {kind && <KindDetail kind={kind} materials={materials} setMaterials={setMaterials} m={p.materials} projectId={p.projectId} />}

          <Nav
            back={
              <ButtonLink href={editing ? `/projects/${p.projectId}/auto/${p.plan!.id}` : `/projects/${p.projectId}/auto`} variant="text">
                やめる
              </ButtonLink>
            }
            note={!kind ? "ネタを 1 つ選んでください" : null}
            next={
              <Button type="button" disabled={!whatOk} onClick={() => go("where")}>
                次へ: どこに
              </Button>
            }
          />
        </>
      )}

      {step === "where" && (
        <>
          <Card className="flex flex-col gap-4 px-6 py-5 max-sm:px-4 max-sm:py-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-bold max-sm:text-[16px]">送る SNS</h2>
              <HelpTip label="送り方の違い">
                「自動で送る」は、作った文をあなたが見なくても、決めた時刻に送ります。「確かめて送る」は、作ったら通知するので、中身を見て「送る」を押したものだけ送ります。X・TikTok・YouTube
                は各社の決まりで「確かめて送る」だけです（理由は SNS ごとの「?」）。note・Substack は送る仕組みがないので、下書きに置き、コピーして貼ります。
              </HelpTip>
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {AUTO_SNS_STAGE_A.map((s) => {
                const on = !!targets[s];
                const connected = p.connected.includes(s);
                return (
                  <li key={s} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <label className={`flex items-center gap-2.5 ${connected ? "cursor-pointer" : "text-muted"}`}>
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--primary)]"
                        checked={on}
                        disabled={!connected}
                        onChange={(e) => {
                          const next = { ...targets };
                          if (e.target.checked) next[s] = TARGET_MODES[s][0];
                          else delete next[s];
                          setTargets(next);
                          setSchedule(null);
                        }}
                      />
                      <SnsTag sns={s} />
                    </label>
                    {!connected ? (
                      <Link href={`/projects/${p.projectId}/edit`} className="text-sm text-muted underline">
                        つないでいません
                      </Link>
                    ) : (
                      <ModePicker sns={s} value={targets[s] ?? TARGET_MODES[s][0]} disabled={!on} onChange={(m) => setTargets({ ...targets, [s]: m })} />
                    )}
                    {s === "instagram" && on && (
                      <p className="w-full text-xs text-muted">
                        {image
                          ? "Instagram には、AI がつくった画像を添えて毎回送ります（画像をつくれなかった回は、下書きに回します）。"
                          : "Instagram は画像が要るので、写真つきのネタ帳のメモから作る回だけ送ります（ほかの回は Instagram には送りません）。下の「画像」で AI の画像を選ぶと、毎回送れます。"}
                      </p>
                    )}
                    {isReviewOnlySns(s) && <ReviewReason sns={s} />}
                  </li>
                );
              })}
            </ul>
            <StageCSns />
            {reviewSns.length > 0 && <ReviewFlow sns={reviewSns} />}
            {targets.x && (
              <fieldset className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
                <legend className="px-1 text-[14px] font-bold">X にリンクを付けるか</legend>
                <div className="flex flex-wrap gap-2">
                  <Chip on={xLink === "never"} onClick={() => setXLink("never")}>
                    付けない（1 本 約 {Math.round(X_USD.never * YEN * 10) / 10} 円）
                  </Chip>
                  <Chip on={xLink === "always"} onClick={() => setXLink("always")}>
                    付ける（1 本 約 {Math.round(X_USD.always * YEN)} 円）
                  </Chip>
                </div>
              </fieldset>
            )}
            {p.connected.length === 0 && <p className="text-sm text-muted">SNS をつなぐと選べます。</p>}
          </Card>
          {kind && (
            <ImagePicker
              projectId={p.projectId}
              kind={kind}
              formatHasImage={formatHasImage}
              formatHasHeadline={formatHasHeadline}
              value={image}
              onChange={setImage}
              photo={{ enabled: p.photo.enabled, acknowledged: photoAck }}
              onAcknowledged={() => setPhotoAck(true)}
            />
          )}
          <Nav
            back={
              <Button type="button" variant="text" onClick={() => go("what")}>
                戻る
              </Button>
            }
            next={
              <Button type="button" disabled={!whereOk} onClick={() => go("when")}>
                次へ: どのくらい
              </Button>
            }
          />
        </>
      )}

      {step === "when" && (
        <>
          <div className="flex flex-col gap-3" role="radiogroup" aria-label="回数と時刻の案">
            {options.map((o) => {
              const s = withStart(o.schedule);
              const on = !custom && !!effectiveSchedule && sameSchedule(effectiveSchedule, s);
              return (
                <button
                  key={`${o.perWeek}-${o.schedule.time}`}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setCustom(false);
                    setSchedule(s);
                  }}
                  className={`flex flex-col items-start gap-1 rounded-lg border bg-surface px-5 py-4 text-left max-sm:px-4 ${on ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border hover:border-input"}`}
                >
                  <span className="num text-[17px] font-bold">
                    {scheduleText(s)}
                    {o.fromPlan && <span className="ml-2 text-sm font-normal text-muted">設計の頻度</span>}
                  </span>
                  <span className="text-[14px] text-muted">{o.reason}</span>
                  <span className="text-[14px] text-muted">
                    {o.timeReason}
                    {o.timeSource === "default" && "（あなたの数字がたまったら変わります）"}
                  </span>
                </button>
              );
            })}
          </div>
          <Disclosure summary="自分で決める" open={custom}>
            <CustomSchedule
              value={
                effectiveSchedule ?? {
                  weekdays: [2, 5],
                  time: "19:00",
                  every_weeks: 1,
                  start: p.today,
                }
              }
              onChange={(s) => {
                setCustom(true);
                setSchedule(s);
              }}
            />
          </Disclosure>
          <Card className="flex flex-col gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4">
            <p className="text-sm text-muted">送る {DEFAULT_LEAD_HOURS} 時間前に文を作り、カレンダーと通知でお知らせします。書き方（長さ・絵文字・口調など）は、次の「確かめる」の見本を見ながら編集できます。</p>
          </Card>
          <Nav
            back={
              <Button type="button" variant="text" onClick={() => go("where")}>
                戻る
              </Button>
            }
            next={
              <Button type="button" disabled={!whenOk} onClick={() => go("confirm")}>
                次へ: 確かめる
              </Button>
            }
          />
        </>
      )}

      {step === "confirm" && kind && effectiveSchedule && (
        <>
          <Card className="flex flex-col gap-4 px-6 py-5 max-sm:px-4 max-sm:py-4">
            <Field label="名前" htmlFor="auto-name" hint={`一覧とカレンダーに出ます（${AUTO_NAME_MAX} 字まで）`}>
              <Input id="auto-name" maxLength={AUTO_NAME_MAX} value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} />
            </Field>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-[15px] max-sm:grid-cols-[5rem_1fr]">
              <dt className="text-muted">何を</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {KIND_LABELS[kind]}
                <EditLink onClick={() => go("what")} />
              </dd>
              <dt className="text-muted">どこに</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {snsList.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <SnsTag sns={s} />
                    <span className="text-sm text-muted">{TARGET_MODE_LABELS[targets[s]!]}</span>
                  </span>
                ))}
                <EditLink onClick={() => go("where")} />
                {reviewSns.length > 0 && <ReviewFlow sns={reviewSns} />}
              </dd>
              <dt className="text-muted">どのくらい</dt>
              <dd className="num flex flex-wrap items-center gap-2">
                {scheduleText(effectiveSchedule)}
                <EditLink onClick={() => go("when")} />
              </dd>
            </dl>
          </Card>

          <SampleCard
            projectId={p.projectId}
            input={input}
            instructions={instructions}
            onInstructions={async (next) => {
              setInstructions(next);
              return null;
            }}
            series={kind === "series"}
            adopt={editing ? undefined : { on: adopt, set: setAdopt }}
            onSample={setSample}
          />

          <Card className="flex flex-col gap-4 px-6 py-5 max-sm:px-4 max-sm:py-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Estimate label="月" value={`約 ${monthly}`} unit="本" />
              <Estimate label="AI" value={`約 ${aiYen}`} unit="円" />
              {image && <Estimate label="画像" value={`約 ${imageYen}`} unit="円" />}
              {targets.x && <Estimate label="X" value={`約 ${xYen}`} unit="円" />}
            </div>
            <label className="flex items-start gap-2.5 text-[15px] leading-[1.7]">
              <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                AI が作った文を、あなたが確かめずに、あなたのアカウントから送ります（X などの「確かめて送る」SNS は、押したものだけ送ります）。送った投稿の責任はあなたにあります。送る{" "}
                {DEFAULT_LEAD_HOURS} 時間前に、カレンダーと通知でお知らせします。気になれば、編集・その回を飛ばす・止めるができます。
              </span>
            </label>
          </Card>

          <Nav
            back={
              <Button type="button" variant="text" onClick={() => go("when")}>
                戻る
              </Button>
            }
            next={
              <Button
                type="button"
                disabled={!consent || pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const i = input();
                    if (!i) return;
                    const r = await saveAutoPlan(p.projectId, {
                      ...i,
                      consent: true,
                      ...(!editing && adopt && sample?.sampleId ? { sampleId: sample.sampleId } : {}),
                    });
                    if (!r.ok) {
                      setError(r.error);
                      return;
                    }
                    // 見本を最初の回にできなかったときは、回し方の画面で理由を 1 回だけ出す
                    const note = r.data.sampleNote ? "&sample=failed" : r.data.firstDueAt ? "&sample=used" : "";
                    router.push(editing ? `/projects/${p.projectId}/auto/${r.data.id}?saved=1` : `/projects/${p.projectId}/auto?started=1${note}`);
                  })
                }
              >
                {pending ? "保存しています…" : editing ? "編集して保存する" : "はじめる"}
              </Button>
            }
          />
        </>
      )}
    </div>
  );
}

function sameSchedule(a: AutoSchedule, b: AutoSchedule) {
  return a.time === b.time && a.every_weeks === b.every_weeks && [...a.weekdays].sort().join() === [...b.weekdays].sort().join();
}

function Nav({ back, next, note }: { back: React.ReactNode; next: React.ReactNode; note?: string | null }) {
  return (
    <div className="flex items-center justify-end gap-3 max-sm:flex-col-reverse max-sm:items-stretch [&>*]:max-sm:w-full">
      {note && (
        <p role="status" className="mr-auto text-[14px] text-muted max-sm:order-first max-sm:text-center">
          {note}
        </p>
      )}
      {back}
      {next}
    </div>
  );
}

function EditLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-muted underline hover:text-fg">
      編集
    </button>
  );
}

function Estimate({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="num text-[22px] font-bold">{value}</span>
      <span className="text-sm font-bold text-muted">{unit}</span>
    </p>
  );
}

function ModePicker({ sns, value, disabled, onChange }: { sns: SnsKey; value: TargetMode; disabled: boolean; onChange: (m: TargetMode) => void }) {
  const modes = TARGET_MODES[sns];
  if (modes.length === 1) return <Badge tone={value === "auto" ? "info" : "neutral"}>{TARGET_MODE_LABELS[value]}</Badge>;
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={`${SNS[sns].label}の送り方`}>
      {modes.map((m) => (
        <Chip key={m} on={value === m} disabled={disabled} role="radio" aria-checked={value === m} onClick={() => onChange(m)}>
          {TARGET_MODE_LABELS[m]}
        </Chip>
      ))}
    </div>
  );
}

function KindDetail({ kind, materials, setMaterials, m, projectId }: { kind: AutoKind; materials: AutoMaterials; setMaterials: (x: AutoMaterials) => void; m: WizardMaterials; projectId: string }) {
  if (kind === "product") {
    const picked = materials.destination_ids ?? [];
    return (
      <Card className="flex flex-col gap-2 px-6 py-5 max-sm:px-4 max-sm:py-4">
        <p className="text-[14px] font-bold">紹介する行き先</p>
        <div className="flex flex-wrap gap-2">
          <Chip on={picked.length === 0} onClick={() => setMaterials({ ...materials, destination_ids: undefined })}>
            おまかせ（順に回す）
          </Chip>
          {m.destinations.map((d) => {
            const on = picked.includes(d.id);
            return (
              <Chip
                key={d.id}
                on={on}
                onClick={() =>
                  setMaterials({
                    ...materials,
                    destination_ids: on ? picked.filter((x) => x !== d.id) : [...picked, d.id],
                  })
                }
              >
                {d.label}
              </Chip>
            );
          })}
        </div>
      </Card>
    );
  }
  if (kind === "notes") {
    const order = materials.note_order ?? "old_first";
    return (
      <Card className="flex flex-col gap-2 px-6 py-5 max-sm:px-4 max-sm:py-4">
        <p className="text-[14px] font-bold">メモの選び方</p>
        <div className="flex flex-wrap gap-2">
          <Chip on={order === "old_first"} onClick={() => setMaterials({ ...materials, note_order: "old_first" })}>
            古い順
          </Chip>
          <Chip on={order === "photo_first"} onClick={() => setMaterials({ ...materials, note_order: "photo_first" })}>
            写真つきを先に
          </Chip>
        </div>
      </Card>
    );
  }
  if (kind === "events") {
    return (
      <Card className="flex flex-col gap-2 px-6 py-5 max-sm:px-4 max-sm:py-4">
        <p className="flex flex-wrap items-center gap-x-3 text-[14px]">
          <span className="font-bold">登録したお知らせ・季節の予定 {m.events} 件</span>
          <Link href={`/projects/${projectId}/auto/events`} className="text-sm font-bold underline">
            お知らせを入れる →
          </Link>
        </p>
        <label className="flex items-center gap-2.5 text-[15px]">
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={!!materials.skip_if_empty}
            onChange={(e) =>
              setMaterials({
                ...materials,
                skip_if_empty: e.target.checked || undefined,
              })
            }
          />
          予定がない回は、季節のあいさつをせずに飛ばす
        </label>
      </Card>
    );
  }
  return null;
}

function CustomSchedule({ value, onChange }: { value: AutoSchedule; onChange: (s: AutoSchedule) => void }) {
  return (
    <div className="flex flex-col gap-3 pt-1 text-fg">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[14px] font-bold">曜日</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = value.weekdays.includes(d.n);
            return (
              <Chip
                key={d.n}
                on={on}
                onClick={() =>
                  onChange({
                    ...value,
                    weekdays: on ? value.weekdays.filter((x) => x !== d.n) : [...value.weekdays, d.n].sort(),
                  })
                }
              >
                {d.label}
              </Chip>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5 text-[14px] font-bold">
          時刻
          <select className="h-11 rounded-md border border-input bg-surface px-3 text-base font-normal" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })}>
            {TIMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] font-bold">
          間隔
          <select
            className="h-11 rounded-md border border-input bg-surface px-3 text-base font-normal"
            value={value.every_weeks}
            onChange={(e) =>
              onChange({
                ...value,
                every_weeks: Number(e.target.value) as AutoSchedule["every_weeks"],
              })
            }
          >
            <option value={1}>毎週</option>
            <option value={2}>2 週ごと</option>
            <option value={3}>3 週ごと</option>
            <option value={4}>4 週ごと</option>
          </select>
        </label>
      </div>
      {value.weekdays.length === 0 && <p className="text-sm font-semibold text-danger">曜日を 1 つ以上選んでください。</p>}
    </div>
  );
}

// スマホのステップ: 「2/4 どこに」と点（投稿をつくるの step-nav と同じ形。1 行に収める）。いまどこかを見せるだけで、押しても移らない
function MobileSteps({ current }: { current: Step }) {
  const i = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="自動の投稿の段取り" className="flex items-center justify-between gap-3 sm:hidden">
      <p className="text-[15px] font-bold">
        <span className="num">
          {i + 1}/{STEPS.length}
        </span>{" "}
        {STEPS[i].label}
      </p>
      <ol className="flex items-center gap-1">
        {STEPS.map((s, n) => {
          const on = s.key === current;
          return (
            <li key={s.key}>
              <span aria-current={on ? "step" : undefined} className="flex size-8 items-center justify-center">
                <span className="sr-only">{`${n + 1} ${s.label}`}</span>
                <span aria-hidden className={`block rounded-full ${on ? "size-3 bg-primary ring-2 ring-primary ring-offset-2 ring-offset-bg" : "size-2.5 border border-input bg-surface"}`} />
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
