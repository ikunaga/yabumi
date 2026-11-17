"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, Chip } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { SnsTag } from "@/components/ui/marks";
import { Steps } from "@/components/ui/steps";
import { makeAutoSample, saveAutoPlan } from "@/lib/auto-post/actions";
import { KIND_LABELS, RUN_REASON_TEXT, TARGET_MODE_LABELS } from "@/lib/auto-post/labels";
import { runsPerMonth } from "@/lib/auto-post/schedule";
import { AUTO_NAME_MAX, AUTO_TONE_MAX, DEFAULT_LEAD_HOURS } from "@/lib/auto-post/schema";
import { suggestSchedules, type KindSuggestion, type SuggestMaterials } from "@/lib/auto-post/suggest";
import {
  AUTO_KINDS,
  AUTO_KINDS_STAGE_A,
  AUTO_SNS_STAGE_A,
  TARGET_MODES,
  type AutoKind,
  type AutoMaterials,
  type AutoPlan,
  type AutoPlanInput,
  type AutoSample,
  type AutoSchedule,
  type AutoTargets,
  type TargetMode,
} from "@/lib/auto-post/types";
import type { TimeTrends } from "@/lib/metrics/time-bands";
import { SNS, type SnsKey } from "@/lib/sns";
import { withHashtags } from "@/lib/sns/hashtags";
import { scheduleText } from "./format";

// 自動の投稿を始める・直す（docs/design/auto-post.md の 1.4・1.5・1.7）。
// 「1 何を › 2 どこに › 3 どのくらい › 4 確かめる」。いまのステップの項目だけ出す。何を・どのくらいの案は AI を呼ばずに決まりで出す（suggest.ts）

export type WizardMaterials = {
  counts: SuggestMaterials;
  seriesFormats: { id: string; name: string }[];
  destinations: { id: string; label: string }[];
  events: number;
  pillars: number;
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
};

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

// 使い道が選べるか（材料がなければ押せない形にして、足りないものと入口を出す）
function kindAvailability(kind: AutoKind, m: WizardMaterials, projectId: string): { ok: boolean; note: string; href?: string; hrefLabel?: string } {
  const base = `/projects/${projectId}`;
  switch (kind) {
    case "series":
      return m.seriesFormats.length
        ? { ok: true, note: `フォーマット ${m.seriesFormats.length} つ` }
        : {
            ok: false,
            note: "シリーズのフォーマットがありません",
            href: `${base}/compose`,
            hrefLabel: "フォーマットをつくる",
          };
    case "product":
      return m.destinations.length
        ? { ok: true, note: `行き先 ${m.destinations.length} 件` }
        : {
            ok: false,
            note: "行き先の URL がありません",
            href: `${base}/edit`,
            hrefLabel: "行き先を入れる",
          };
    case "notes":
      return m.counts.unusedNotes
        ? {
            ok: true,
            note: `残り ${m.counts.unusedNotes} 件${m.counts.unusedPhotoNotes ? `・写真つき ${m.counts.unusedPhotoNotes}` : ""}`,
          }
        : {
            ok: false,
            note: "使っていないメモがありません",
            href: `${base}/notes`,
            hrefLabel: "メモを書く",
          };
    case "pillars":
      return m.pillars
        ? { ok: true, note: `柱 ${m.pillars} つ` }
        : {
            ok: false,
            note: "アカウント設計の柱がありません",
            href: `${base}/plan`,
            hrefLabel: "設計を進める",
          };
    case "events":
      return {
        ok: true,
        note: m.events ? `予定 ${m.events} 件` : "予定がなければ季節のあいさつ",
      };
    default:
      return { ok: false, note: "準備中" };
  }
}

export function PlanWizard(p: Props) {
  const router = useRouter();
  const editing = !!p.plan;
  const [step, setStep] = useState<Step>(editing ? "confirm" : "what");
  const [kind, setKind] = useState<AutoKind | null>(p.plan?.kind ?? null);
  const [materials, setMaterials] = useState<AutoMaterials>(p.plan?.materials ?? {});
  const autoSns = AUTO_SNS_STAGE_A.filter((s) => p.connected.includes(s));
  const [targets, setTargets] = useState<AutoTargets>(() => {
    if (p.plan) return p.plan.targets;
    const preferred = autoSns.filter((s) => p.planRoles.includes(s));
    const picked = preferred.length ? preferred : autoSns.filter((s) => s !== "note" && s !== "substack");
    return Object.fromEntries(picked.map((s) => [s, TARGET_MODES[s][0]]));
  });
  const [xLink, setXLink] = useState<"never" | "always">(p.plan?.xLink ?? "never");
  const [schedule, setSchedule] = useState<AutoSchedule | null>(p.plan?.schedule ?? null);
  const [custom, setCustom] = useState(false);
  const [tone, setTone] = useState(p.plan?.tone ?? "");
  const [name, setName] = useState(p.plan?.name ?? "");
  const [consent, setConsent] = useState(false);
  const [sample, setSample] = useState<AutoSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [sampling, startSample] = useTransition();

  const snsList = Object.keys(targets) as SnsKey[];
  // 決まりで出すだけなので、描くたびに出し直す（安い）
  const options = kind
    ? suggestSchedules({
        kind,
        materials: p.materials.counts,
        targets: snsList,
        trends: p.trends,
        planFrequency: p.planFrequency,
        start: p.today,
      })
    : [];
  const withStart = (s: AutoSchedule): AutoSchedule => ({
    ...s,
    start: s.start || p.today,
  });
  const effectiveSchedule = schedule ?? (options[0] ? withStart(options[0].schedule) : null);

  const whatOk = !!kind && AUTO_KINDS_STAGE_A.includes(kind) && (kind !== "series" || !!materials.format_id);
  const whereOk = snsList.length > 0;
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
          tone: tone.trim(),
          leadHours: p.plan?.leadHours ?? DEFAULT_LEAD_HOURS,
        }
      : null;

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const monthly = effectiveSchedule ? runsPerMonth(effectiveSchedule) : 0;
  const aiYen = Math.round(monthly * AI_USD_PER_RUN * YEN);
  const xYen = targets.x ? Math.round(monthly * X_USD[xLink] * YEN) : 0;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <div className="flex flex-col gap-3">
        <h1 className="text-[28px] leading-tight font-bold max-sm:text-[24px]">{editing ? "自動の投稿を直す" : "自動の投稿をはじめる"}</h1>
        <div className="max-sm:hidden">
          {/* ステップの印は押せない。動くのは下の「次へ」「戻る」だけ（投稿をつくると同じ。2026-11-15 オーナーの指示） */}
          <Steps steps={STEPS} current={step} canGo={() => false} onGo={() => {}} label="自動の投稿の段取り" />
        </div>
        <MobileSteps current={step} />
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {step === "what" && (
        <>
          {!editing && (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm text-muted">おすすめ</p>
                <p className="text-[17px] font-bold">{KIND_LABELS[p.kindSuggestion.kind]}</p>
                <p className="text-[14px] text-muted">{p.kindSuggestion.reason}</p>
              </div>
              <Button
                type="button"
                variant={kind === p.kindSuggestion.kind ? "secondary" : "primary"}
                className="max-sm:w-full"
                onClick={() => {
                  setKind(p.kindSuggestion.kind);
                  setSchedule(null);
                }}
              >
                {kind === p.kindSuggestion.kind ? "選んでいます" : "これにする"}
              </Button>
            </Card>
          )}
          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1" role="radiogroup" aria-label="使い道">
            {AUTO_KINDS.filter((k) => editing || k !== p.kindSuggestion.kind).map((k) => {
              const ready = AUTO_KINDS_STAGE_A.includes(k);
              const a = kindAvailability(k, p.materials, p.projectId);
              const on = kind === k;
              const disabled = !ready || !a.ok;
              return (
                <div
                  key={k}
                  className={`flex flex-col gap-1.5 rounded-lg border bg-surface px-4 py-3.5 ${on ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border"} ${disabled ? "opacity-70" : ""}`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => {
                      setKind(k);
                      setSchedule(null);
                    }}
                    className="flex flex-col items-start gap-1 text-left disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-2 text-[16px] font-bold">
                      {KIND_LABELS[k]}
                      {!ready && <Badge>準備中</Badge>}
                    </span>
                    <span className="num text-[14px] text-muted">{ready ? a.note : "これから作ります"}</span>
                  </button>
                  {ready && !a.ok && a.href && (
                    <Link href={a.href} className="text-sm font-bold text-fg underline">
                      {a.hrefLabel} →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          {kind && <KindDetail kind={kind} materials={materials} setMaterials={setMaterials} m={p.materials} projectId={p.projectId} />}

          <Nav
            back={
              <ButtonLink href={editing ? `/projects/${p.projectId}/auto/${p.plan!.id}` : `/projects/${p.projectId}/auto`} variant="text">
                やめる
              </ButtonLink>
            }
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
                「自動で送る」は、作った文をあなたが見なくても、決めた時刻に送ります。X
                は、送る前にあなたが中身を見ることを決まりにしているので「確かめて送る」だけです（通知から中身を見て、押したものだけ送ります）。note・Substack
                は送る仕組みがないので、下書きに置き、コピーして貼ります。
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
                    {s === "instagram" && on && <p className="w-full text-xs text-muted">Instagram は画像が要るので、写真つきのメモ・シリーズの画像がある回だけ送ります。</p>}
                  </li>
                );
              })}
            </ul>
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
            <Field label="口調の指示" htmlFor="auto-tone" optional hint={`空なら、アカウント設計の口調で書きます（${AUTO_TONE_MAX} 字まで）`}>
              <Textarea id="auto-tone" rows={2} maxLength={AUTO_TONE_MAX} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="例: 季節の話から入る。絵文字は 1 つまで" />
            </Field>
            <p className="text-sm text-muted">送る {DEFAULT_LEAD_HOURS} 時間前に文を作り、カレンダーと通知でお知らせします。</p>
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
              </dd>
              <dt className="text-muted">どのくらい</dt>
              <dd className="num flex flex-wrap items-center gap-2">
                {scheduleText(effectiveSchedule)}
                <EditLink onClick={() => go("when")} />
              </dd>
            </dl>
          </Card>

          <Card className="flex flex-col gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-[18px] font-bold max-sm:text-[16px]">見本の 1 回</h2>
                <HelpTip label="見本について">次の回と同じ作り方で 1 回分を作って見せます（AI を 1 回使います。約 12 円）。見本は保存しません。</HelpTip>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={sampling}
                onClick={() =>
                  startSample(async () => {
                    setError(null);
                    const i = input();
                    if (!i) return;
                    const r = await makeAutoSample(p.projectId, i);
                    if (r.ok) setSample(r.data);
                    else setError(r.error);
                  })
                }
              >
                {sampling ? "つくっています…" : sample ? "もう一度つくる" : "見本をつくる"}
              </Button>
            </div>
            {sample && <SampleView sample={sample} />}
          </Card>

          <Card className="flex flex-col gap-4 px-6 py-5 max-sm:px-4 max-sm:py-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Estimate label="月" value={`約 ${monthly}`} unit="本" />
              <Estimate label="AI" value={`約 ${aiYen}`} unit="円" />
              {targets.x && <Estimate label="X" value={`約 ${xYen}`} unit="円" />}
            </div>
            <label className="flex items-start gap-2.5 text-[15px] leading-[1.7]">
              <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                AI が作った文を、あなたが確かめずに、あなたのアカウントから送ります（X などの「確かめて送る」SNS は、押したものだけ送ります）。送った投稿の責任はあなたにあります。送る{" "}
                {DEFAULT_LEAD_HOURS} 時間前に、カレンダーと通知でお知らせします。気になれば、直す・その回を飛ばす・止めるができます。
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
                    });
                    if (!r.ok) {
                      setError(r.error);
                      return;
                    }
                    router.push(editing ? `/projects/${p.projectId}/auto/${r.data.id}?saved=1` : `/projects/${p.projectId}/auto?started=1`);
                  })
                }
              >
                {pending ? "保存しています…" : editing ? "直して保存する" : "はじめる"}
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

function Nav({ back, next }: { back: React.ReactNode; next: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3 max-sm:flex-col-reverse max-sm:items-stretch [&>*]:max-sm:w-full">
      {back}
      {next}
    </div>
  );
}

function EditLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-muted underline hover:text-fg">
      直す
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
  if (kind === "series") {
    return (
      <Card className="px-6 py-5 max-sm:px-4 max-sm:py-4">
        <Field label="どのシリーズか" htmlFor="auto-format" required>
          <select
            id="auto-format"
            className="h-11 rounded-md border border-input bg-surface px-3 text-base"
            value={materials.format_id ?? ""}
            onChange={(e) =>
              setMaterials({
                ...materials,
                format_id: e.target.value || undefined,
              })
            }
          >
            <option value="">選んでください</option>
            {m.seriesFormats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
      </Card>
    );
  }
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
          <span className="font-bold">予定 {m.events} 件</span>
          <Link href={`/projects/${projectId}/auto/events`} className="text-sm font-bold underline">
            予定を入れる →
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

function SampleView({ sample }: { sample: AutoSample }) {
  const entries = Object.entries(sample.texts) as [SnsKey, string][];
  // texts が空なら書けなかった（engine の makeAutoSample）。そのときは「書けませんでした」の 1 行と理由だけにする（同じ文を 2 度出さない）
  const cannot = entries.length === 0;
  const reasons = cannot ? sample.issues.map((i) => i.detail || RUN_REASON_TEXT[i.kind]) : [];
  const issues = cannot ? [] : sample.issues;
  return (
    <div className="flex flex-col gap-3">
      {sample.materialLabel && <p className="text-sm text-muted">材料: {sample.materialLabel}</p>}
      {cannot && (
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-bold">この材料では書けませんでした。本番の回なら、この回は飛ばします。</p>
          {reasons.map((r, n) => (
            <p key={n} className="text-[14px] text-muted">
              {r}
            </p>
          ))}
        </div>
      )}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-signal-soft px-4 py-3 text-[14px]">
          {issues.map((i, n) => (
            <li key={n}>
              <span className="font-bold text-signal">● </span>
              {RUN_REASON_TEXT[i.kind]}
              {i.detail && <span className="text-muted">（{i.detail}）</span>}
            </li>
          ))}
        </ul>
      )}
      {entries.map(([s, text]) => (
        <div key={s} className="flex flex-col items-start gap-1.5 rounded-md border border-border px-4 py-3">
          <SnsTag sns={s} />
          {/* 送る文そのまま（本文＋空行＋本文とは別に付くタグの行） */}
          <p className="text-[15px] leading-[1.8] whitespace-pre-wrap">{withHashtags(text, sample.tags?.[s] ?? [])}</p>
        </div>
      ))}
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
