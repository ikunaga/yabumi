"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { saveSection, type SectionFormState } from "@/lib/plan/actions";
import { MAX_HASHTAGS, MAX_PILLARS, MAX_WEEKLY_PER_SNS, REQUIRED_FOR_DONE, SECTION_KEYS, isSectionDone, type PlanData, type SectionKey } from "@/lib/plan/schema";
import { cycleInfo } from "@/lib/coach/pace";
import { toYmd } from "@/lib/time";
import { KPI_KEYS, KPIS, MAX_KPIS, recommendedKpis, type KpiKey } from "@/lib/metrics/kpis";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { ProfileFields, type ProfileContext } from "./profile-fields";

// 見出しはボタンの中に置くので、用語解説（これもボタン）は説明文のほうに付ける
type Meta = { title: string; lead: ReactNode };

// セクションごとの見出しと、素人向けの短い説明
const META: Record<SectionKey, Meta> = {
  goal: {
    title: "目的",
    lead: "このアカウントで何を広めて、最終的にどうなってほしいかを決めます。投稿で迷ったときの判断の軸になります。",
  },
  audience: {
    title: "届けたい相手",
    lead: (
      <>
        アプリを届けたい人を 1 人に絞って思い浮かべます（<Term k="persona" />
        ）。広く狙うより、1 人に刺さる言葉のほうが、結果的に多くの人に届きます。
      </>
    ),
  },
  ownership: {
    title: "アカウントの持ち方",
    lead: "あなた個人のアカウントで発信するか、アプリ専用のアカウントを作るかを決めます。個人開発では、作っている人の顔が見える個人のアカウントのほうが反応を得やすいこともあります。",
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
    title: "最初の 1 か月",
    lead: "最初の 1 か月で目指すことと、うまくいっているかを何で判断するかを決めます。最初は数字が小さくて当たり前なので、「続けられたか」も立派な目標です。",
  },
};

export function AccountPlanEditor({
  projectId,
  plan,
  sources,
  aiEnabled,
  profileCtx,
  initialOpen = null,
}: {
  projectId: string;
  plan: PlanData;
  // 名前とプロフィールの SNS ごとの欄に使う（つないだアカウント、短縮リンク）
  profileCtx: ProfileContext;
  sources: Partial<Record<SectionKey, "ai" | "manual">>;
  // AI と考える（Claude API のキーがあるときだけ）
  aiEnabled: boolean;
  // 開いておくセクション（URL の ?open=）
  initialOpen?: SectionKey | null;
}) {
  // 最初に開くのは、指定があればそのセクション、なければまだ書いていない最初のセクション
  const [open, setOpen] = useState<SectionKey | null>(() => initialOpen ?? SECTION_KEYS.find((k) => !isSectionDone(k, plan[k])) ?? null);

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
          onSavedNext={() => setOpen(SECTION_KEYS[i + 1] ?? null)}
        >
          <SectionFields sectionKey={key} plan={plan} profileCtx={profileCtx} />
        </SectionCard>
      ))}
    </div>
  );
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
              {REQUIRED_FOR_DONE.map((k) => META[k].title).join("・")}の 3 つが書けたら、「いまやること」が次（SNS をつなぐ）に進みます。どれも任意で、あとからいつでも直せます。
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
  open: boolean;
  onToggle: () => void;
  onSavedNext: () => void;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<SectionFormState, FormData>(saveSection.bind(null, projectId, sectionKey), {});
  const goNext = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const meta = META[sectionKey];
  const isLast = index === SECTION_KEYS.length - 1;
  const bodyId = `plan-${sectionKey}`;

  useEffect(() => {
    // 保存できたら、欄を保存した値（# を外したタグなど）に戻し、「数え直す」などの印を外す
    if (state.savedAt) formRef.current?.reset();
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
        hidden={!open}
        className="flex flex-col gap-5 border-t border-line px-6 py-5 max-sm:px-4">
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

function SectionFields({ sectionKey, plan, profileCtx }: { sectionKey: SectionKey; plan: PlanData; profileCtx: ProfileContext }) {
  switch (sectionKey) {
    case "goal":
      return <GoalFields v={plan.goal} />;
    case "audience":
      return <AudienceFields v={plan.audience} />;
    case "ownership":
      return <OwnershipFields v={plan.ownership} />;
    case "profile":
      return <ProfileFields v={plan.profile} roles={plan.cadence.roles} ctx={profileCtx} />;
    case "pillars":
      return <PillarsFields v={plan.pillars} />;
    case "hashtags":
      return <HashtagsFields v={plan.hashtags} />;
    case "cadence":
      return <CadenceFields v={plan.cadence} />;
    case "first_month":
      return (
        <FirstMonthFields
          v={plan.first_month}
          goalType={plan.goal.goalType}
          // 週の回数の欄を出す SNS: 役割を書いた SNS・つないだ SNS・もう回数を決めた SNS（ほかは折りたたむ）
          mainSns={SNS_KEYS.filter((k) => plan.cadence.roles[k]?.trim() || profileCtx.accounts.some((a) => a.sns === k) || (plan.first_month.weekly[k] ?? 0) > 0)}
        />
      );
  }
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

function GoalFields({ v }: { v: PlanData["goal"] }) {
  return (
    <>
      <Field label="何を広めたいか" htmlFor="goal-what" hint="アプリそのもの、アプリが解決する困りごと、作っているあなた自身など">
        <Textarea id="goal-what" name="what" defaultValue={v.what} maxLength={500} placeholder="例: レシートを撮るだけで続く家計簿アプリ「かけいぼ日和」" />
      </Field>
      <Choices
        name="goalType"
        legend={
          <>
            いちばんの目標（<Term k="kgi" /> の方向）
          </>
        }
        hint="迷ったら「まず知ってもらう」。具体的な数字は「最初の 1 か月」で決めます。"
        value={v.goalType}
        options={[
          { value: "downloads", label: "ダウンロードを増やす" },
          { value: "paid", label: "課金してもらう" },
          {
            value: "awareness",
            label: (
              <>
                まず知ってもらう（<Term k="awareness" />）
              </>
            ),
          },
          { value: "other", label: "その他" },
        ]}
      />
      <Field label="補足" htmlFor="goal-note">
        <Textarea id="goal-note" name="note" defaultValue={v.note} maxLength={500} rows={2} placeholder="例: 半年で有料プランの利用者を 100 人にしたい" />
      </Field>
    </>
  );
}

function AudienceFields({ v }: { v: PlanData["audience"] }) {
  return (
    <>
      <Field label="どんな人か" htmlFor="audience-who" hint="ここに書いた内容は、プロジェクトの「届けたい相手」と同じものです">
        <Textarea id="audience-who" name="who" defaultValue={v.who} maxLength={1000} placeholder="例: 残業続きで家計簿が続かない 28 歳の会社員" />
      </Field>
      <Field label="その人の困りごと" htmlFor="audience-pain">
        <Textarea id="audience-pain" name="pain" defaultValue={v.pain} maxLength={500} rows={2} placeholder="例: 毎月お金が残らないが、何に使ったのかわからない" />
      </Field>
      <Field label="どこで・いつ SNS を見ているか" htmlFor="audience-where">
        <Textarea id="audience-where" name="where" defaultValue={v.where} maxLength={500} rows={2} placeholder="例: 平日の夜 23 時ごろ、布団の中で X と Threads を眺めている" />
      </Field>
    </>
  );
}

function OwnershipFields({ v }: { v: PlanData["ownership"] }) {
  return (
    <>
      <Choices
        name="mode"
        legend="どちらで発信するか"
        value={v.mode}
        options={[
          { value: "personal", label: "個人のアカウントを使う", description: "開発の裏側や人柄も含めて発信できる。アプリが増えても、まとめて育てられる" },
          { value: "dedicated", label: "アプリ専用のアカウントを作る", description: "アプリの情報だけを届けられ、見る人に目的が伝わりやすい。フォロワー 0 から育てる必要がある" },
          { value: "undecided", label: "まだ決めていない" },
        ]}
      />
      <Field label="そう決めた理由" htmlFor="ownership-reason">
        <Textarea id="ownership-reason" name="reason" defaultValue={v.reason} maxLength={500} rows={2} placeholder="例: 開発日記と一緒に出したいので、個人のアカウントにする" />
      </Field>
    </>
  );
}

const PILLAR_EXAMPLES = [
  { name: "お金のちょっとしたコツ", share: "40", example: "コンビニに寄る回数を減らしたら、月 3,000 円浮いた話" },
  { name: "開発の裏側", share: "30", example: "新しいグラフ機能を作るまでの試行錯誤" },
  { name: "アプリの紹介", share: "20", example: "レシートの読み取りが速くなりました" },
  { name: "利用者の声", share: "10", example: "使ってくれた方の感想を紹介" },
  { name: "", share: "", example: "" },
];

function PillarsFields({ v }: { v: PlanData["pillars"] }) {
  const [shares, setShares] = useState<string[]>(() =>
    Array.from({ length: MAX_PILLARS }, (_, i) => (v.items[i]?.share != null ? String(v.items[i].share) : "")),
  );
  const total = shares.reduce((sum, s) => sum + (Number(s) || 0), 0);

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
          const ex = PILLAR_EXAMPLES[i];
          return (
            <div key={i} className="grid grid-cols-[1fr_72px_1.4fr] gap-2 max-sm:grid-cols-[1fr_72px] max-sm:border-b max-sm:border-line max-sm:pb-3">
              <Input name={`pillar-${i}-name`} aria-label={`柱 ${i + 1} の名前`} defaultValue={item?.name ?? ""} maxLength={50} placeholder={ex.name && `例: ${ex.name}`} />
              <Input
                name={`pillar-${i}-share`}
                aria-label={`柱 ${i + 1} の割合（%）`}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={shares[i]}
                onChange={(e) => setShares((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
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
          );
        })}
        <p className={`text-xs ${total > 100 ? "font-semibold text-danger" : "text-muted"}`}>
          割合の合計: {total}%{total > 100 ? "（100% を超えています）" : total > 0 && total < 100 ? "（100% にすると配分がはっきりします）" : ""}
        </p>
      </fieldset>
      <Field
        label={
          <>
            口調（<Term k="toneAndManner" />）
          </>
        }
        htmlFor="pillars-tone"
      >
        <Textarea id="pillars-tone" name="tone" defaultValue={v.tone} maxLength={300} rows={2} placeholder="例: です・ます調。親しみやすく、専門用語は使わない。絵文字は 1 投稿に 1 つまで" />
      </Field>
      <Field label="やらないこと" htmlFor="pillars-avoid" hint="決めておくと、迷ったときや炎上しそうなときの歯止めになります">
        <Textarea id="pillars-avoid" name="avoid" defaultValue={v.avoid} maxLength={500} rows={2} placeholder="例: 他のアプリを悪く言わない。宣伝だけの投稿を続けない。政治の話はしない" />
      </Field>
    </>
  );
}

// 1 行目だけに例を出す（作品好きの人に届けたい、読書記録のアプリの例）
const HASHTAG_EXAMPLE = { tag: "読書記録", why: "本の感想を投稿している人が見ている。人が多すぎず、話題がはっきりしている", when: "「読んだ本とアプリ」の柱のとき" };

function HashtagsFields({ v }: { v: PlanData["hashtags"] }) {
  const [rows, setRows] = useState(() => Math.min(MAX_HASHTAGS, Math.max(3, v.items.length + 1)));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-[14px] font-bold">候補（最大 {MAX_HASHTAGS} 個）</legend>
      <p className="text-xs leading-[1.7] text-muted">
        # は付けなくても大丈夫です。タグの中に空白や記号は入れられません。1 投稿に付けるのは、X は 1〜2 個、Threads は 1 つ、Instagram は 5 個までです（どれも、ネタに合うものだけ）。
      </p>
      {Array.from({ length: rows }, (_, i) => {
        const item = v.items[i];
        const ex = i === 0 ? HASHTAG_EXAMPLE : null;
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

const ROLE_EXAMPLES: Record<string, string> = {
  x: "開発の進み具合と、お金のコツを短く",
  threads: "X と同じ内容を、少し丁寧な言葉で",
  instagram: "アプリの画面とグラフの画像で使い方を見せる",
  facebook: "当面は使わない",
  tiktok: "30 秒で使い方を見せる動画",
  youtube: "当面は使わない",
  note: "月に 1 本、開発の振り返りを長文で（手で投稿）",
  substack: "海外の利用者に、更新のお知らせをメールで（手で投稿）",
};

function CadenceFields({ v }: { v: PlanData["cadence"] }) {
  return (
    <>
      <Field label="投稿の頻度" htmlFor="cadence-frequency">
        <Input id="cadence-frequency" name="frequency" defaultValue={v.frequency} maxLength={200} placeholder="例: 週 3 回（月・水・金の 21 時）" />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[14px] font-bold">SNS ごとの役割</legend>
        {SNS_KEYS.map((sns) => (
          <label key={sns} className="grid grid-cols-[96px_1fr] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1">
            <span className="flex flex-col text-sm font-bold">
              {SNS[sns].label}
              {SNS[sns].delivery === "manual" && <span className="text-xs font-normal text-muted">手で投稿</span>}
            </span>
            <Input name={`role-${sns}`} defaultValue={v.roles[sns] ?? ""} maxLength={200} placeholder={`例: ${ROLE_EXAMPLES[sns]}`} />
          </label>
        ))}
        <p className="text-xs text-muted">使わない SNS は空欄で構いません。note と Substack は自動では送れず、手で投稿します（そのぶん手間がかかります）。</p>
      </fieldset>
    </>
  );
}

function FirstMonthFields({ v, goalType, mainSns }: { v: PlanData["first_month"]; goalType: PlanData["goal"]["goalType"]; mainSns: SnsKey[] }) {
  const recommended = recommendedKpis(goalType);
  const cycle = v.startedOn ? cycleInfo(v.startedOn, toYmd(new Date())) : null;
  const otherSns = SNS_KEYS.filter((k) => !mainSns.includes(k));
  // まだ選んでいなければ、目的からのおすすめを入れておく（保存するまでは決まらない）
  const [kpis, setKpis] = useState<KpiKey[]>(() => ((v.kpis ?? []).length ? (v.kpis ?? []) : recommended.slice(0, MAX_KPIS)));
  return (
    <>
      <Field
        label={
          <>
            1 か月後の目標（<Term k="kpi" />）
          </>
        }
        htmlFor="first-month-goal"
        hint="続けられたかどうか（投稿の回数）も立派な目標です"
      >
        <Textarea id="first-month-goal" name="goal" defaultValue={v.goal} maxLength={300} rows={2} placeholder="例: 12 回投稿する。フォロワー 50 人。ストアページへのアクセス 30 回" />
      </Field>
      <Field label="何を見て判断するか" htmlFor="first-month-metrics">
        <Textarea
          id="first-month-metrics"
          name="metrics"
          defaultValue={v.metrics}
          maxLength={500}
          rows={2}
          placeholder="例: 投稿ごとの表示回数と、ストアページへのアクセス数を、週に 1 回（日曜の夜）見る"
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[14px] font-bold">SNS ごとの週の投稿の回数（伴走）</legend>
        <p className="text-xs leading-[1.7] text-muted">
          決めると、矢書が週ごとのペース（送った投稿と予約した投稿）を見守り、概要の「いまやること」の帯と、遅れそうなとき・毎週月曜のメールで声をかけます。続けられる回数にしましょう（迷ったら、メインの SNS に週 2、ほかは週 1）。使わない SNS は空欄で構いません。
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
                ? `前の 1 か月（${cycle.startedOn.slice(5).replace("-", "/")}〜${cycle.endsOn.slice(5).replace("-", "/")}）は終わりました。保存すると、今週から次の 1 か月を数え始めます。`
                : `いまの 1 か月: ${cycle.startedOn.slice(5).replace("-", "/")}〜${cycle.endsOn.slice(5).replace("-", "/")}（${cycle.weekIndex} 週目）。回数を変えても、数え始めの日は変わりません。`}
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
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[14px] font-bold">
          矢書の「分析」の画面で追いかける数字（<Term k="kpi" />。{MAX_KPIS} つまで）
        </legend>
        <p className="text-xs text-muted">目的に合わせたおすすめに印を付けています。迷ったらそのままで大丈夫です。</p>
        <ul className="flex flex-col gap-1">
          {KPI_KEYS.map((k) => {
            const on = kpis.includes(k);
            return (
              <li key={k}>
                <label className="flex items-start gap-2 text-sm leading-[1.7]">
                  <input
                    type="checkbox"
                    name="kpis"
                    value={k}
                    checked={on}
                    disabled={!on && kpis.length >= MAX_KPIS}
                    onChange={() => setKpis((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))}
                    className="mt-1 size-4 accent-[var(--primary)]"
                  />
                  <span>
                    <b>{KPIS[k].label}</b>
                    {recommended.includes(k) && <span className="ml-1.5 text-xs text-primary">おすすめ</span>}
                    {KPIS[k].availability === "connect" && (
                      <span className="ml-1.5 text-xs text-muted">（{KPIS[k].connectTo === "stores" ? "ストアや課金をつなぐと出ます" : "SNS をつなぐと出ます"}）</span>
                    )}
                    {(KPIS[k].availability === "later" || KPIS[k].availability === "partial") && <span className="ml-1.5 text-xs text-muted">（いまは準備中）</span>}
                    <span className="block text-xs text-muted">{KPIS[k].meaning}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p className="text-xs text-muted">
        投稿の閲覧数（表示回数）は <Term k="impression" />
        とも呼ばれます。
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
