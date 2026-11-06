"use client";

import { DraftRestoreBar } from "@/components/ui/draft-restore";
import { clearFormDraft, parseFormDraft, rawFormDraft, writeFormDraft, type FormDraft } from "@/lib/form-draft";
import { getDraftOwner } from "@/lib/notes/draft";
import { guardAction } from "@/lib/client-errors";
import { DESIRED_ACTION_DEFS, DESIRED_ACTIONS, PRODUCT_TYPE_DEFS, RECOMMENDED_ACTIONS, isDevProject, type ProductType } from "@/lib/projects/product-types";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, chipClass } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { LearningTip } from "@/components/learning/learning-tip";
import { HelpTip } from "@/components/ui/help";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { saveSection, type SectionFormState } from "@/lib/plan/actions";
import { MAX_HASHTAGS, MAX_PILLARS, MAX_WEEKLY_PER_SNS, RECOMMENDED_SECTIONS, REQUIRED_FOR_DONE, SECTION_KEYS, STORY_FIELDS, isSectionDone, type PlanData, type SectionKey, type StoryField } from "@/lib/plan/schema";
import { STORY_LABEL, storyNeedsCheck } from "@/lib/plan/story";
import type { CycleInfo } from "@/lib/coach/pace";
import { md } from "@/lib/goals/view";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { PLAN_EXAMPLES, type PlanExamples } from "@/lib/ai/product-guide";
import { hasToneBySns, isSplitBySns, pillarsBySns, pillarViewSns, type Pillar } from "@/lib/plan/pillars";
import { ProfileFields, type ProfileContext } from "./profile-fields";

// 見出しはボタンの中に置くので、用語解説（これもボタン）は説明文のほうに付ける
type Meta = { title: string; lead: ReactNode };

// セクションごとの見出しと、素人向けの短い説明
const META: Record<SectionKey, Meta> = {
  goal: {
    title: "目的",
    lead: "このアカウントで何を広めて、最終的にどうなってほしいかを決めます。投稿で迷ったときの判断の軸になります。",
  },
  story: {
    title: "あなたらしさ",
    lead: (
      <>
        どんな思いで始めたか、どんな経験や悩みを乗り越えてきたかを書いておきます（<Term k="story" />
        ）。似たお店や商品が多い中で、「この人から」と選ばれる理由になります。どれも任意で、話したくないことは書かなくて大丈夫です。
      </>
    ),
  },
  audience: {
    title: "届けたい相手",
    lead: (
      <>
        届けたい人を 1 人に絞って思い浮かべます（<Term k="persona" />
        ）。広く狙うより、1 人に刺さる言葉のほうが、結果的に多くの人に届きます。
      </>
    ),
  },
  concept: {
    title: "コンセプト",
    lead: (
      <>
        誰の・どんな悩みを・どうやって解決するかを 1 文にまとめます（<Term k="concept" />
        ）。投稿やプロフィールで迷ったときの軸になります。
      </>
    ),
  },
  ownership: {
    title: "アカウントの持ち方",
    lead: "あなた個人のアカウントで発信するか、お店・商品・作品・アプリ専用のアカウントを作るかを決めます。ひとりで商売や制作をしている人は、作っている人・やっている人の顔が見える個人のアカウントのほうが反応を得やすいこともあります。",
  },
  profile: {
    title: "名前とプロフィール",
    lead: "初めて見た人は、名前と自己紹介文だけで「フォローするか」を決めます。何者で、何を発信するのかが 1 秒で伝わるようにします。前のセクションで決めた投稿の柱をもとに考えると決めやすくなります。",
  },
  pillars: {
    title: "投稿の柱",
    lead: (
      <>
        毎回ゼロからネタを考えなくて済むよう、投稿の「型」（<Term k="contentPillar" />
        ）を 3〜4 種類決めておきます。割合も決めると、宣伝ばかりになるのを防げます。
      </>
    ),
  },
  hashtags: {
    title: "ハッシュタグ",
    lead: (
      <>
        投稿に付ける <Term k="hashtag" /> の候補を決めます。届けたい相手が見ている言葉を選び、どの柱のときに付けるかも決めておくと、AI の下書きはネタに合うものだけを付けます。毎回同じタグを付ける必要はありません。
      </>
    ),
  },
  cadence: {
    title: "頻度と SNS ごとの役割",
    lead: "無理なく続けられる頻度を決めます。毎日より、続けられる週 3 回のほうが成果につながります。SNS ごとに向いている内容も違うので、役割を分けておきます。",
  },
  first_month: {
    title: "週の回数",
    lead: "SNS ごとに、1 週に何本投稿するかを決めます。続けることが成果への近道なので、無理なく続けられる本数にしましょう。",
  },
};

export function AccountPlanEditor({
  projectId,
  plan,
  sources,
  aiEnabled,
  profileCtx,
  initialOpen = null,
  cycle = null,
}: {
  projectId: string;
  plan: PlanData;
  // いまの 1 か月（中間の目標の区切り。週の回数の欄に出す）
  cycle?: CycleInfo | null;
  // 名前とプロフィールの SNS ごとの欄に使う（つないだアカウント、短縮リンク）
  profileCtx: ProfileContext;
  sources: Partial<Record<SectionKey, "ai" | "manual">>;
  // AI と考える（Claude API のキーがあるときだけ）
  aiEnabled: boolean;
  // 開いておくセクション（URL の ?open=）
  initialOpen?: SectionKey | null;
}) {
  // 最初に開くのは、指定があればそのセクション、なければ「済み」に要るセクションのうちまだのもの、次におすすめ（コンセプト）、
  // それも済んでいれば、まだ書いていない最初のセクション（4.50）
  const [open, setOpen] = useState<SectionKey | null>(() => initialOpen ?? firstToWrite(plan));

  return (
    <div className="flex flex-col gap-3">
      {SECTION_KEYS.map((key, i) => (
        <SectionCard
          key={key}
          index={i}
          sectionKey={key}
          projectId={projectId}
          done={isSectionDone(key, plan[key])}
          fromAi={sources[key] === "ai"}
          aiEnabled={aiEnabled}
          open={open === key}
          onToggle={() => setOpen(open === key ? null : key)}
          recommended={RECOMMENDED_SECTIONS.includes(key)}
          onSavedNext={() => setOpen(SECTION_KEYS[i + 1] ?? null)}
        >
          <SectionFields sectionKey={key} plan={plan} profileCtx={profileCtx} cycle={cycle} onOpenSection={(k) => {
            setOpen(k);
            requestAnimationFrame(() => document.getElementById(`plan-${k}-head`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
          }} />
        </SectionCard>
      ))}
    </div>
  );
}

// 次に書くとよいセクション: 「済み」に要るもの → おすすめ → ほかの順で、まだのもの
function firstToWrite(plan: PlanData): SectionKey | null {
  const undone = (k: SectionKey) => !isSectionDone(k, plan[k]);
  return REQUIRED_FOR_DONE.find(undone) ?? RECOMMENDED_SECTIONS.find(undone) ?? SECTION_KEYS.find(undone) ?? null;
}

// 右の列の「進み具合」: 記入済みの数・横棒・セクションの一覧（押すとそのセクションへ）
// planHref: 設計の画面の外（AI と考える）から開くときは、設計の画面のそのセクションへ
export function PlanProgressCard({ plan, planHref }: { plan: PlanData; planHref?: string }) {
  const done = SECTION_KEYS.filter((k) => isSectionDone(k, plan[k]));
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            進み具合
            <HelpTip label="記入の進み具合">
              {REQUIRED_FOR_DONE.map((k) => META[k].title).join("・")}の {REQUIRED_FOR_DONE.length} つが書けたら、「いまやること」が次（SNS をつなぐ）に進みます。{RECOMMENDED_SECTIONS.map((k) => META[k].title).join("・")}も書いておくのがおすすめです。どれもあとからいつでも直せます。
            </HelpTip>
          </span>
        }
      />
      <div className="flex flex-col gap-3 px-6 pt-1 pb-5 max-sm:px-4">
        <p className="num text-[15px] text-faint">
          <b className="text-metric leading-none text-fg">{done.length}</b> / {SECTION_KEYS.length} 記入済み
        </p>
        <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
          <span className="block h-full rounded-full bg-success" style={{ width: `${(done.length / SECTION_KEYS.length) * 100}%` }} />
        </span>
        {/* 縦に積む幅では、すぐ下にセクションが並ぶので一覧は出さない */}
        <ul className="flex flex-col text-[15px] max-xl:hidden">
          {SECTION_KEYS.map((k, i) => (
            <li key={k} className="border-t border-dashed border-line first:border-t-0">
              <a href={planHref ? `${planHref}?open=${k}#plan-${k}-head` : `#plan-${k}-head`} className="flex items-center gap-2.5 py-2 hover:no-underline">
                <span className="num w-5 text-faint">{i + 1}</span>
                <span className="flex-1 text-fg">{META[k].title}</span>
                {!done.includes(k) && RECOMMENDED_SECTIONS.includes(k) && <Badge tone="info">おすすめ</Badge>}
                {done.includes(k) ? <span className="text-sm font-bold text-success">✓</span> : <span className="text-sm text-faint">未記入</span>}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function SectionCard({
  index,
  sectionKey,
  projectId,
  done,
  fromAi,
  aiEnabled,
  recommended,
  open,
  onToggle,
  onSavedNext,
  children,
}: {
  index: number;
  sectionKey: SectionKey;
  projectId: string;
  done: boolean;
  fromAi: boolean;
  aiEnabled: boolean;
  // 済みの判定には入れないが、書くことをすすめるセクション（コンセプト）。まだなら「おすすめ」の印を出す
  recommended: boolean;
  open: boolean;
  onToggle: () => void;
  onSavedNext: () => void;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<SectionFormState, FormData>(guardAction(saveSection.bind(null, projectId, sectionKey), (m) => ({ error: m })), {});
  const goNext = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const meta = META[sectionKey];
  const isLast = index === SECTION_KEYS.length - 1;
  const bodyId = `plan-${sectionKey}`;

  // 書きかけの控え（4.35）。欄を直すたびにこの端末に置き、保存できたら消す。古い画面で保存できず読み込み直したときなどに戻せる
  const draftKey = `plan:${projectId}:${sectionKey}`;
  const rawDraft = useSyncExternalStore(noopSubscribe, () => rawFormDraft(draftKey), () => undefined);
  const [found, setFound] = useState<{ draft: FormDraft<[string, string][]> | null } | undefined>(undefined);
  if (found === undefined && rawDraft !== undefined) setFound({ draft: parseFormDraft<[string, string][]>(rawDraft, getDraftOwner()) });
  const restorable = found?.draft ?? null;
  // 開いたときの欄の値（これと同じなら控えない）
  const initialEntries = useRef<string | null>(null);
  useEffect(() => {
    if (formRef.current) initialEntries.current = JSON.stringify(formEntries(formRef.current));
  }, []);
  function keepDraft() {
    const form = formRef.current;
    if (!form || restorable) return;
    const entries = formEntries(form);
    if (JSON.stringify(entries) === initialEntries.current) clearFormDraft(draftKey);
    else writeFormDraft(draftKey, entries);
  }

  useEffect(() => {
    // 保存できたら、欄を保存した値（# を外したタグなど）に戻し、「数え直す」などの印を外す
    if (state.savedAt) {
      formRef.current?.reset();
      clearFormDraft(draftKey);
    }
    if (state.savedAt && goNext.current) {
      goNext.current = false;
      onSavedNext();
      document.getElementById(`plan-${SECTION_KEYS[index + 1]}-head`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    // onSavedNext は毎回作り直されるので、保存したときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt]);

  return (
    <section className="scroll-mt-6 rounded-lg border border-border bg-surface" id={`${bodyId}-head`}>
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-3 px-6 py-4 text-left max-sm:px-4"
        >
          <span className="num inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-[13px] font-bold text-muted">{index + 1}</span>
          <span className="flex-1 text-[17px] font-bold max-sm:text-base">{meta.title}</span>
          {done && fromAi && (
            <Badge tone="info" className="max-sm:hidden">
              AI の案から
            </Badge>
          )}
          {!done && recommended && <Badge tone="info">おすすめ</Badge>}
          {done ? <Badge tone="success">✓ 記入済み</Badge> : <Badge>未記入</Badge>}
          <svg aria-hidden viewBox="0 0 12 12" className={`size-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </button>
      </h2>
      {/* 閉じても入力中の値が消えないよう、隠すだけにする */}
      {/* action={...} だと React が送ったあとに必ずフォームを戻し、保存できなかったとき（形の誤り）に書いた内容が消える。onSubmit で送り、戻すのは保存できたときだけ */}
      <form
        ref={formRef}
        id={bodyId}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => formAction(data));
        }}
        onInput={keepDraft}
        onChange={keepDraft}
        hidden={!open}
        className="flex flex-col gap-5 border-t border-line px-6 py-5 max-sm:px-4">
        {restorable && (
          <DraftRestoreBar
            at={restorable.at}
            onRestore={() => {
              if (formRef.current) restoreEntries(formRef.current, restorable.value);
              setFound({ draft: null });
            }}
            onDiscard={() => {
              clearFormDraft(draftKey);
              setFound({ draft: null });
            }}
          />
        )}
        {/* 説明は畳む（2026-10-30 オーナーの決定）。空欄を前に考え込ませないよう、このセクションを AI と考える入口を先に置く */}
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface2 px-4 py-3 text-sm">
          <span className="flex min-w-[14rem] flex-1 items-center gap-2">
            {fromAi ? "AI の案から採用した内容です。下の欄で直せます。" : "迷ったら、AI が質問しながら案を出します。"}
            <HelpTip label={`${meta.title}の説明`}>{meta.lead}</HelpTip>
          </span>
          {aiEnabled ? (
            <Link href={`/projects/${projectId}/plan/chat?section=${sectionKey}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              AI と考える
            </Link>
          ) : (
            <NotReadyButton variant="secondary" size="sm">
              AI と考える
            </NotReadyButton>
          )}
        </div>
        {children}
        {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
        {/* 保存したあとの「ひとこと」（4.47。1 日 1 回まで） */}
        <LearningTip trigger="plan_saved" when={Boolean(state.savedAt)} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {state.savedAt && !pending && (
            <span role="status" className="mr-auto text-sm font-semibold text-success">
              保存しました
            </span>
          )}
          <Button type="submit" variant={isLast ? "primary" : "secondary"} disabled={pending} onClick={() => (goNext.current = false)}>
            保存する
          </Button>
          {!isLast && (
            <Button type="submit" disabled={pending} onClick={() => (goNext.current = true)}>
              保存して次へ進む
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

// 記入例は宣伝するものの種類ごと（src/lib/ai/product-guide.ts の PLAN_EXAMPLES）
function examplesOf(ctx: ProfileContext): PlanExamples {
  return PLAN_EXAMPLES[ctx.productType ?? "app"];
}

function SectionFields({
  sectionKey,
  plan,
  profileCtx,
  cycle,
  onOpenSection,
}: {
  sectionKey: SectionKey;
  plan: PlanData;
  profileCtx: ProfileContext;
  cycle: CycleInfo | null;
  onOpenSection: (k: SectionKey) => void;
}) {
  switch (sectionKey) {
    case "goal":
      return <GoalFields v={plan.goal} productType={profileCtx.productType ?? "app"} />;
    case "story":
      return <StoryFields v={plan.story} ex={examplesOf(profileCtx)} />;
    case "concept":
      return <ConceptFields v={plan.concept} audience={plan.audience} ex={examplesOf(profileCtx)} onEditAudience={() => onOpenSection("audience")} />;
    case "audience":
      return <AudienceFields v={plan.audience} ex={examplesOf(profileCtx)} />;
    case "ownership":
      return <OwnershipFields v={plan.ownership} ex={examplesOf(profileCtx)} />;
    case "profile":
      return <ProfileFields v={plan.profile} roles={plan.cadence.roles} ctx={profileCtx} />;
    case "pillars":
      return <PillarsFields v={plan.pillars} ex={examplesOf(profileCtx)} inUse={snsInUse(plan, profileCtx)} />;
    case "hashtags":
      return <HashtagsFields v={plan.hashtags} ex={examplesOf(profileCtx)} />;
    case "cadence":
      return <CadenceFields v={plan.cadence} ex={examplesOf(profileCtx)} />;
    case "first_month":
      return (
        <FirstMonthFields
          v={plan.first_month}
          projectId={profileCtx.projectId}
          cycle={cycle}
          // 週の回数の欄を出す SNS: 役割を書いた SNS・つないだ SNS・もう回数を決めた SNS（ほかは折りたたむ）
          mainSns={snsInUse(plan, profileCtx)}
        />
      );
  }
}

// SNS ごとの口調（2026-11-03 オーナーの決定。名前とプロフィールの SNS ごとの上書きと同じ作り）。畳んで置き、もう書いた SNS があれば開いておく。
// 空欄は共通の口調を使う（欄は tone-<SNS>）
function ToneBySnsFields({ toneBySns, main }: { toneBySns: PlanData["pillars"]["toneBySns"]; main: SnsKey[] }) {
  const others = SNS_KEYS.filter((k) => !main.includes(k));
  const row = (sns: SnsKey) => (
    <div key={sns} className="grid grid-cols-[96px_1fr] items-start gap-2 max-sm:grid-cols-1 max-sm:gap-1">
      <label htmlFor={`pillars-tone-${sns}`} className="pt-2.5 text-[13px] font-bold max-sm:pt-0">
        {SNS[sns].label}
      </label>
      <Textarea id={`pillars-tone-${sns}`} name={`tone-${sns}`} defaultValue={toneBySns[sns] ?? ""} maxLength={300} rows={2} placeholder="共通の口調を使います" />
    </div>
  );
  return (
    <details open={hasToneBySns({ toneBySns })} className="group/tone -mt-2 rounded-md border border-line text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-bold">
        <span aria-hidden className="text-muted transition-transform group-open/tone:rotate-90">
          ▸
        </span>
        口調を SNS ごとに変える（任意）
      </summary>
      <div className="flex flex-col gap-2.5 border-t border-line p-3">
        <p className="text-xs leading-[1.7] text-muted">空欄の SNS は、上の共通の口調で書きます。</p>
        {main.map(row)}
        {others.length > 0 && (
          <details className="group/others rounded-md border border-line">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-bold">
              <span aria-hidden className="text-muted transition-transform group-open/others:rotate-90">
                ▸
              </span>
              ほかの SNS（{others.length}）
            </summary>
            <div className="flex flex-col gap-2.5 border-t border-line p-3">{others.map(row)}</div>
          </details>
        )}
      </div>
    </details>
  );
}

// 使っている SNS: 役割を書いた SNS・つないだ SNS・週の回数を決めた SNS
function snsInUse(plan: PlanData, ctx: ProfileContext): SnsKey[] {
  return SNS_KEYS.filter((k) => plan.cadence.roles[k]?.trim() || ctx.accounts.some((a) => a.sns === k) || (plan.first_month.weekly[k] ?? 0) > 0);
}

// SNS ごとにまとめて見る: SNS ごとに、その SNS で使う柱と割合、割合の合計
function PillarsBySnsView({ pillars, snsList }: { pillars: Pillar[]; snsList: SnsKey[] }) {
  return (
    <div className="mt-1 flex flex-col gap-2">
      <p className="text-xs font-bold text-muted">SNS ごとの柱と割合</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
        {pillarsBySns(pillars, snsList).map(({ sns, pillars: ps, total }) => (
          <div key={sns} className="rounded-md border border-line bg-surface2 px-3 py-2.5 text-[13px]">
            <p className="flex items-baseline gap-2 font-bold">
              {SNS[sns].label}
              <span className={`num ml-auto text-xs ${total > 100 ? "text-danger" : total === 100 ? "text-success" : "text-muted"}`}>
                合計 {total}%
              </span>
            </p>
            {ps.length ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {ps.map((p, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="num text-muted">{p.share !== null ? `${p.share}%` : "—"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted">この SNS で使う柱がありません</p>
            )}
            {total > 100 && <p className="mt-1 text-xs font-semibold text-danger">100% を超えています</p>}
            {total > 0 && total < 100 && <p className="mt-1 text-xs text-muted">100% にすると配分がはっきりします</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// 選択肢（ラジオボタン）
function Choices<T extends string>({
  name,
  legend,
  hint,
  value,
  options,
}: {
  name: string;
  legend: ReactNode;
  hint?: ReactNode;
  value: T | null;
  options: { value: T; label: ReactNode; description?: string }[];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[14px] font-bold">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer gap-3 rounded-md border border-input px-3.5 py-3 has-checked:border-primary has-checked:bg-primary-soft">
          <input type="radio" name={name} value={o.value} defaultChecked={value === o.value} className="mt-1 size-4 accent-[var(--primary)]" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] font-bold">{o.label}</span>
            {o.description && <span className="text-sm text-muted">{o.description}</span>}
          </span>
        </label>
      ))}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}

function GoalFields({ v, productType }: { v: PlanData["goal"]; productType: ProductType }) {
  // 種類ごとのおすすめを先に（決定 D34）。説明は選択肢の下に小さく
  // 「ダウンロードしてもらう」は開発しているもの（アプリ・Web のサービス）のときだけ選べる（いま選んでいる値は残す）
  const order = [...RECOMMENDED_ACTIONS[productType], ...DESIRED_ACTIONS.filter((a) => !RECOMMENDED_ACTIONS[productType].includes(a))].filter(
    (a) => a !== "download" || isDevProject({ product_type: productType }) || v.goalType === "download",
  );
  return (
    <>
      <Field label="何を広めたいか" htmlFor="goal-what" hint="お店・商品・サービス・作品・アプリそのもの、それが解決する困りごと、やっているあなた自身など">
        <Textarea id="goal-what" name="what" defaultValue={v.what} maxLength={500} placeholder="例: 駅前の小さなパン屋「こむぎ日和」の、朝 7 時に焼き上がる食パン" />
      </Field>
      <Choices
        name="goalType"
        legend={
          <>
            見た人にいちばんしてほしいこと（<Term k="kgi" /> の方向）
          </>
        }
        hint={`「${PRODUCT_TYPE_DEFS[productType].label}」のおすすめを先に並べています。迷ったら「まず知ってもらう」。これが 3 か月の目標（KGI）の数字になります。具体的な数字はロードマップで決めます。`}
        value={v.goalType}
        options={order.map((a) => ({
          value: a,
          label:
            a === "awareness" ? (
              <>
                {DESIRED_ACTION_DEFS[a].label}（<Term k="awareness" />）
              </>
            ) : (
              DESIRED_ACTION_DEFS[a].label
            ),
          description: DESIRED_ACTION_DEFS[a].description,
        }))}
      />
      <Field label="補足" htmlFor="goal-note">
        <Textarea id="goal-note" name="note" defaultValue={v.note} maxLength={500} rows={2} placeholder="例: 半年で有料プランの利用者を 100 人にしたい" />
      </Field>
    </>
  );
}

function AudienceFields({ v, ex }: { v: PlanData["audience"]; ex: PlanExamples }) {
  return (
    <>
      <Field label="どんな人か" htmlFor="audience-who" hint="ここに書いた内容は、プロジェクトの「届けたい相手」と同じものです">
        <Textarea id="audience-who" name="who" defaultValue={v.who} maxLength={1000} placeholder={`例: ${ex.who}`} />
      </Field>
      <Field label="その人の困りごと" htmlFor="audience-pain">
        <Textarea id="audience-pain" name="pain" defaultValue={v.pain} maxLength={500} rows={2} placeholder={`例: ${ex.pain}`} />
      </Field>
      <Field label="どこで・いつ SNS を見ているか" htmlFor="audience-where">
        <Textarea id="audience-where" name="where" defaultValue={v.where} maxLength={500} rows={2} placeholder={`例: ${ex.where}`} />
      </Field>
    </>
  );
}

// あなたらしさ（4.50）。項目ごとに文と「投稿に使ってよい」のスイッチ（欄は <項目> と <項目>-shareable）。
// スイッチは初期オン。オフの項目は設計の相棒（まとめるため）にしか渡さない（src/lib/plan/story.ts）
const STORY_ROWS: Record<StoryField, { rows: number; max: number; hint?: string }> = {
  why: { rows: 2, max: 500 },
  background: { rows: 2, max: 500, hint: "前の仕事、修業、続けてきたことなど" },
  struggle: { rows: 2, max: 500, hint: "届けたい相手と同じ悩みだと、共感されやすくなります" },
  strength: { rows: 2, max: 300 },
  summary: { rows: 4, max: 300, hint: "上の 4 つをまとめた、200 字くらいの話。迷ったら「AI と考える」で案を出せます" },
};

function StoryFields({ v, ex }: { v: PlanData["story"]; ex: PlanExamples }) {
  return (
    <>
      <p className="-mb-1 text-xs leading-[1.7] text-muted">
        どれも任意です。病気や家族のことなど、知られたくないことは書かなくて大丈夫です。「投稿に使ってよい」をオフにした項目は、ネタ出しや下書きの AI には渡さず、設計の相棒がまとめるときだけ使います。
      </p>
      {STORY_FIELDS.map((f) => (
        <div key={f} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label htmlFor={`story-${f}`} className="flex-1 text-[14px] leading-normal font-bold">
              {STORY_LABEL[f]}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" name={`${f}-shareable`} defaultChecked={v[f].shareable} className="size-4 accent-[var(--primary)]" />
              投稿に使ってよい
            </label>
          </div>
          <Textarea id={`story-${f}`} name={f} defaultValue={v[f].text} maxLength={STORY_ROWS[f].max} rows={STORY_ROWS[f].rows} placeholder={`例: ${ex.story[f]}`} />
          {STORY_ROWS[f].hint && <p className="text-xs text-muted">{STORY_ROWS[f].hint}</p>}
          {storyNeedsCheck(v, f) && (
            <p className="text-xs font-bold text-signal">● 「投稿に使わない」項目が入っていないか確かめてから、「投稿に使ってよい」をオンにしてください</p>
          )}
        </div>
      ))}
    </>
  );
}

// コンセプト（4.50）。Who と What は届けたい相手の値を見せるだけ（直すのは届けたい相手のセクションで）。How と 1 文は書ける
function ConceptFields({ v, audience, ex, onEditAudience }: { v: PlanData["concept"]; audience: PlanData["audience"]; ex: PlanExamples; onEditAudience: () => void }) {
  const row = (label: string, text: string) => (
    <div className="grid grid-cols-[88px_1fr] gap-2 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-[13px] font-bold text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap">{text.trim() || <span className="text-muted">まだ書いていません</span>}</dd>
    </div>
  );
  return (
    <>
      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface2 px-4 py-3 text-sm">
        <dl className="flex flex-col gap-2">
          {row("Who（誰の）", audience.who)}
          {row("What（悩み）", audience.pain)}
        </dl>
        <p className="text-xs text-muted">
          届けたい相手のセクションの値です。
          <button type="button" onClick={onEditAudience} className="font-semibold text-primary hover:underline">
            届けたい相手を直す
          </button>
        </p>
      </div>
      <Field label="How（どうやって解決するか）" htmlFor="concept-how" hint="あなたの商品・サービスならではのやり方">
        <Textarea id="concept-how" name="how" defaultValue={v.how} maxLength={500} rows={2} placeholder={`例: ${ex.concept.how}`} />
      </Field>
      <Field label="1 文のコンセプト" htmlFor="concept-statement" hint="「〇〇な人の『△△』を、□□で解決する」の形が基本です">
        <Textarea id="concept-statement" name="statement" defaultValue={v.statement} maxLength={200} rows={3} placeholder={`例: ${ex.concept.statement}`} />
      </Field>
    </>
  );
}

function OwnershipFields({ v, ex }: { v: PlanData["ownership"]; ex: PlanExamples }) {
  return (
    <>
      <Choices
        name="mode"
        legend="どちらで発信するか"
        value={v.mode}
        options={[
          { value: "personal", label: "個人のアカウントを使う", description: "作る・営む裏側や人柄も含めて発信できる。宣伝するものが増えても、まとめて育てられる" },
          { value: "dedicated", label: "専用のアカウントを作る", description: "お店・商品・作品などの情報だけを届けられ、見る人に目的が伝わりやすい。フォロワー 0 から育てる必要がある" },
          { value: "undecided", label: "まだ決めていない" },
        ]}
      />
      <Field label="そう決めた理由" htmlFor="ownership-reason">
        <Textarea id="ownership-reason" name="reason" defaultValue={v.reason} maxLength={500} rows={2} placeholder={`例: ${ex.ownershipReason}`} />
      </Field>
    </>
  );
}


// 柱ごとに「使う SNS」を選べる（2026-11-03 オーナーの要望。src/lib/plan/pillars.ts）。何も選ばなければすべての SNS。
// 割合は SNS ごとに、その SNS に付いた柱の中で数え、SNS ごとの合計と中身を下にまとめて出す（どの SNS で何を出すかをひと目で確かめる）
type PillarRow = { name: string; share: string; sns: SnsKey[] };
const FIRST_PILLAR_SNS: SnsKey[] = ["x", "threads", "instagram", "facebook"];

function PillarsFields({ v, ex: examples, inUse }: { v: PlanData["pillars"]; ex: PlanExamples; inUse: SnsKey[] }) {
  const [rows, setRows] = useState<PillarRow[]>(() =>
    Array.from({ length: MAX_PILLARS }, (_, i) => ({ name: v.items[i]?.name ?? "", share: v.items[i]?.share != null ? String(v.items[i].share) : "", sns: v.items[i]?.sns ?? [] })),
  );
  const [allSns, setAllSns] = useState(false);
  const update = (i: number, patch: Partial<PillarRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const asPillars = rows.map((r) => ({ name: r.name, share: Number(r.share) || null, example: "", sns: r.sns }));
  const split = isSplitBySns(asPillars);
  // チップに出す SNS: 使っている SNS（役割・つないだ・週の回数。まだなければ X・Threads・Instagram・Facebook）と、もう選んだ SNS。ほかは「ほかの SNS」で出す
  const base = inUse.length ? inUse : FIRST_PILLAR_SNS;
  const options = allSns ? SNS_KEYS : SNS_KEYS.filter((k) => base.includes(k) || rows.some((r) => r.sns.includes(k)));
  const total = rows.reduce((sum, r) => sum + (Number(r.share) || 0), 0);

  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[14px] font-bold">柱（最大 {MAX_PILLARS} つ）</legend>
        <div className="grid grid-cols-[1fr_72px_1.4fr] gap-x-2 text-xs text-muted max-sm:hidden">
          <span>柱の名前</span>
          <span>割合（%）</span>
          <span>投稿の例</span>
        </div>
        {Array.from({ length: MAX_PILLARS }, (_, i) => {
          const item = v.items[i];
          const row = rows[i];
          const ex = examples.pillars[i] ?? { name: "", share: "", example: "" };
          return (
            <div key={i} className="flex flex-col gap-2 border-b border-line pb-3 last:border-b-0">
              <div className="grid grid-cols-[1fr_72px_1.4fr] gap-2 max-sm:grid-cols-[1fr_72px]">
                <Input
                  name={`pillar-${i}-name`}
                  aria-label={`柱 ${i + 1} の名前`}
                  value={row.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  maxLength={50}
                  placeholder={ex.name && `例: ${ex.name}`}
                />
                <Input
                  name={`pillar-${i}-share`}
                  aria-label={`柱 ${i + 1} の割合（%）`}
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={row.share}
                  onChange={(e) => update(i, { share: e.target.value })}
                  placeholder={ex.share}
                />
                <Input
                  name={`pillar-${i}-example`}
                  aria-label={`柱 ${i + 1} の投稿の例`}
                  defaultValue={item?.example ?? ""}
                  maxLength={200}
                  placeholder={ex.example && `例: ${ex.example}`}
                  className="max-sm:col-span-2"
                />
              </div>
              <div role="group" aria-label={`柱 ${i + 1} を使う SNS`} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted">使う SNS</span>
                <button type="button" aria-pressed={row.sns.length === 0} onClick={() => update(i, { sns: [] })} className={chipClass({ on: row.sns.length === 0, className: "h-7 px-2.5 text-xs" })}>
                  すべて
                </button>
                {options.map((k) => {
                  const on = row.sns.includes(k);
                  return (
                    <label key={k} className={`cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-primary ${chipClass({ on, className: "h-7 px-2.5 text-xs" })}`}>
                      <input
                        type="checkbox"
                        name={`pillar-${i}-sns`}
                        value={k}
                        checked={on}
                        onChange={() => update(i, { sns: on ? row.sns.filter((x) => x !== k) : SNS_KEYS.filter((x) => x === k || row.sns.includes(x)) })}
                        className="sr-only"
                      />
                      {SNS[k].label}
                    </label>
                  );
                })}
                {!allSns && options.length < SNS_KEYS.length && (
                  <button type="button" onClick={() => setAllSns(true)} className="text-xs font-semibold text-primary hover:underline">
                    ほかの SNS
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {split ? (
          <PillarsBySnsView pillars={asPillars} snsList={pillarViewSns(asPillars, inUse)} />
        ) : (
          <p className={`text-xs ${total > 100 ? "font-semibold text-danger" : "text-muted"}`}>
            割合の合計: {total}%{total > 100 ? "（100% を超えています）" : total > 0 && total < 100 ? "（100% にすると配分がはっきりします）" : ""}
          </p>
        )}
      </fieldset>
      <Field
        label={
          <>
            口調（<Term k="toneAndManner" />）
          </>
        }
        htmlFor="pillars-tone"
      >
        <Textarea id="pillars-tone" name="tone" defaultValue={v.tone} maxLength={300} rows={2} placeholder={`例: ${examples.tone}`} />
      </Field>
      <ToneBySnsFields
        toneBySns={v.toneBySns}
        // 欄を出す SNS: 使っている SNS（まだなければ X・Threads・Instagram・Facebook）・柱で選んだ SNS・もう口調を書いた SNS。ほかは「ほかの SNS」に
        main={SNS_KEYS.filter((k) => base.includes(k) || rows.some((r) => r.sns.includes(k)) || v.toneBySns[k]?.trim())}
      />
      <Field label="やらないこと" htmlFor="pillars-avoid" hint="決めておくと、迷ったときや炎上しそうなときの歯止めになります">
        <Textarea id="pillars-avoid" name="avoid" defaultValue={v.avoid} maxLength={500} rows={2} placeholder={`例: ${examples.avoid}`} />
      </Field>
    </>
  );
}


function HashtagsFields({ v, ex: examples }: { v: PlanData["hashtags"]; ex: PlanExamples }) {
  const [rows, setRows] = useState(() => Math.min(MAX_HASHTAGS, Math.max(3, v.items.length + 1)));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-[14px] font-bold">候補（最大 {MAX_HASHTAGS} 個）</legend>
      <p className="text-xs leading-[1.7] text-muted">
        # は付けなくても大丈夫です。タグの中に空白や記号は入れられません。1 投稿に付けるのは、X は 1〜2 個、Threads は 1 つ、Instagram は 5 個までです（どれも、ネタに合うものだけ）。
      </p>
      {Array.from({ length: rows }, (_, i) => {
        const item = v.items[i];
        const ex = i === 0 ? examples.hashtag : null;
        return (
          <div key={i} className="grid grid-cols-[160px_1fr_1fr] gap-2 max-sm:grid-cols-1 max-sm:border-b max-sm:border-line max-sm:pb-3">
            <div className="flex items-center gap-1">
              <span aria-hidden className="text-muted">
                #
              </span>
              <Input name={`hashtag-${i}-tag`} aria-label={`ハッシュタグ ${i + 1}`} defaultValue={item?.tag ?? ""} maxLength={51} placeholder={ex ? `例: ${ex.tag}` : ""} />
            </div>
            <Input
              name={`hashtag-${i}-why`}
              aria-label={`ハッシュタグ ${i + 1} を見ている人・使う理由`}
              defaultValue={item?.why ?? ""}
              maxLength={200}
              placeholder={ex ? `どんな人が見ているか 例: ${ex.why}` : "どんな人が見ているか・なぜ使うか"}
            />
            <Input
              name={`hashtag-${i}-when`}
              aria-label={`ハッシュタグ ${i + 1} を付けるとき`}
              defaultValue={item?.when ?? ""}
              maxLength={200}
              placeholder={ex ? `付けるとき 例: ${ex.when}` : "どの柱・どんなネタのときに付けるか"}
            />
          </div>
        );
      })}
      {rows < MAX_HASHTAGS && (
        <button type="button" onClick={() => setRows((n) => n + 1)} className="self-start text-sm font-semibold text-primary hover:underline">
          ＋ 候補を足す
        </button>
      )}
      <p className="text-xs text-muted">タグの欄を空にして保存すると、その候補は消えます。</p>
    </fieldset>
  );
}


function CadenceFields({ v, ex }: { v: PlanData["cadence"]; ex: PlanExamples }) {
  return (
    <>
      <Field label="投稿の頻度" htmlFor="cadence-frequency">
        <Input id="cadence-frequency" name="frequency" defaultValue={v.frequency} maxLength={200} placeholder={`例: ${ex.frequency}`} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[14px] font-bold">SNS ごとの役割</legend>
        {SNS_KEYS.map((sns) => (
          <label key={sns} className="grid grid-cols-[96px_1fr] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1">
            <span className="flex flex-col text-sm font-bold">
              {SNS[sns].label}
              {SNS[sns].delivery === "manual" && <span className="text-xs font-normal text-muted">手で投稿</span>}
            </span>
            <Input name={`role-${sns}`} defaultValue={v.roles[sns] ?? ""} maxLength={200} placeholder={`例: ${ex.roles[sns]}`} />
          </label>
        ))}
        <p className="text-xs text-muted">使わない SNS は空欄で構いません。note と Substack は自動では送れず、手で投稿します（そのぶん手間がかかります）。</p>
      </fieldset>
    </>
  );
}

// 週の回数（段階 ② から。前は「最初の 1 か月」）: SNS ごとの週の投稿の本数だけ。いまの目標の行動の目標（goal_kpis の action）に書く。
// 3 か月の目標（KGI）・中間の目標・KPI はロードマップで決める（docs/design/goals-model.md の 5.）
function FirstMonthFields({ v, projectId, cycle, mainSns }: { v: PlanData["first_month"]; projectId: string; cycle: CycleInfo | null; mainSns: SnsKey[] }) {
  const otherSns = SNS_KEYS.filter((k) => !mainSns.includes(k));
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[14px] font-bold">SNS ごとの週の投稿の本数（伴走）</legend>
        <p className="text-xs leading-[1.7] text-muted">
          決めると、yabumi が週ごとのペース（送った投稿と予約した投稿）を見守り、概要の「いまやること」の帯と、遅れそうなとき・毎週月曜のメールで声をかけます。迷ったら、メインの SNS に週 2、ほかは週 1。使わない SNS は空欄で構いません。
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          {mainSns.map((sns) => (
            <WeeklyInput key={sns} sns={sns} value={v.weekly[sns]} />
          ))}
        </div>
        {otherSns.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">{mainSns.length ? `ほかの SNS（${otherSns.length}）` : "SNS を選んで回数を決める"}</summary>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {otherSns.map((sns) => (
                <WeeklyInput key={sns} sns={sns} value={v.weekly[sns]} />
              ))}
            </div>
          </details>
        )}
        {cycle && (
          <div className="flex flex-col gap-1 rounded-md border border-line bg-surface2 px-3 py-2 text-xs leading-[1.7]">
            <p>
              {cycle.ended
                ? `前の 1 か月（${md(cycle.startedOn)}〜${md(cycle.endsOn)}）は終わりました。保存すると、今週から次の 1 か月を数え始めます。`
                : `いまの 1 か月: ${md(cycle.startedOn)}〜${md(cycle.endsOn)}（${cycle.weekIndex} 週目）。回数を変えても、数え始めの日は変わりません。`}
            </p>
            {!cycle.ended && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="restart" value="1" className="size-4 accent-[var(--primary)]" />
                次の 1 か月を始める（今週から数え直す）
              </label>
            )}
          </div>
        )}
      </fieldset>
      <p className="text-xs leading-[1.7] text-muted">
        3 か月の目標（<Term k="kgi" />）と、途中で追いかける数字（<Term k="kpi" />）は、
        <Link href={`/projects/${projectId}/roadmap`} className="font-bold text-primary underline">
          ロードマップ
        </Link>
        で決めます。
      </p>
    </>
  );
}

function WeeklyInput({ sns, value }: { sns: SnsKey; value: number | undefined }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-20 shrink-0 font-bold">{SNS[sns].label}</span>
      <span className="text-muted">週</span>
      <Input name={`weekly-${sns}`} type="number" inputMode="numeric" min={0} max={MAX_WEEKLY_PER_SNS} defaultValue={value ?? ""} className="w-16" aria-label={`${SNS[sns].label} の週の回数`} />
      <span className="text-muted">回</span>
    </label>
  );
}

const noopSubscribe = () => () => {};

// フォームの文字の欄を、並び順のまま [名前, 値] で取る（同じ名前の欄が並ぶ柱などもそのまま）
function formEntries(form: HTMLFormElement): [string, string][] {
  return [...new FormData(form).entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION"));
}

// 控えた値を欄に戻す。React が見ている欄も変わるよう、ブラウザの値の入れ方で入れて input・change を起こす。
// 欄の数が控えたときと違う（柱を足した・減らした）ときは、ある欄の分だけ戻す
function restoreEntries(form: HTMLFormElement, entries: [string, string][]) {
  const byName = new Map<string, string[]>();
  for (const [k, v] of entries) byName.set(k, [...(byName.get(k) ?? []), v]);
  // 控えは欄の全部を写したものなので、控えに名前のないチェックの欄は、どれも選んでいなかったもの（柱の「使う SNS」を外した、など）
  for (const el of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (el.name && !byName.has(el.name) && el.checked) el.click();
  }
  for (const [name, values] of byName) {
    const fields = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`)];
    let i = 0;
    for (const el of fields) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        const on = values.includes(el.value);
        if (el.checked !== on) el.click();
        continue;
      }
      if (i >= values.length) break;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, values[i++]);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}
