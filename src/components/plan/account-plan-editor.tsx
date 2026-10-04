"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { saveSection, type SectionFormState } from "@/lib/plan/actions";
import { MAX_PILLARS, REQUIRED_FOR_DONE, SECTION_KEYS, isSectionDone, type PlanData, type SectionKey } from "@/lib/plan/schema";
import { SNS, SNS_KEYS } from "@/lib/sns";

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
}: {
  projectId: string;
  plan: PlanData;
  sources: Partial<Record<SectionKey, "ai" | "manual">>;
  // AI と考える（Claude API のキーがあるときだけ）
  aiEnabled: boolean;
}) {
  // 最初に開くのは、まだ書いていない最初のセクション
  const [open, setOpen] = useState<SectionKey | null>(() => SECTION_KEYS.find((k) => !isSectionDone(k, plan[k])) ?? null);
  const doneCount = SECTION_KEYS.filter((k) => isSectionDone(k, plan[k])).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        記入済み {doneCount} / {SECTION_KEYS.length}　・　{REQUIRED_FOR_DONE.map((k) => META[k].title).join("・")}
        の 3 つが書けたら、「いまやること」が次（SNS をつなぐ）に進みます。
      </p>
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
          <SectionFields sectionKey={key} plan={plan} />
        </SectionCard>
      ))}
    </div>
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
  const meta = META[sectionKey];
  const isLast = index === SECTION_KEYS.length - 1;
  const bodyId = `plan-${sectionKey}`;

  useEffect(() => {
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
          <span className="w-5 text-[14px] font-bold text-primary">{index + 1}</span>
          <span className="flex-1 text-base font-bold">{meta.title}</span>
          {done && fromAi && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary max-sm:hidden">AI の案から</span>}
          {done ? <span className="text-sm font-bold text-success">✓ 記入済み</span> : <span className="text-sm text-muted">未記入</span>}
          <span aria-hidden className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
      </h2>
      {/* 閉じても入力中の値が消えないよう、隠すだけにする */}
      <form id={bodyId} action={formAction} hidden={!open} className="flex flex-col gap-5 border-t border-line px-6 py-5 max-sm:px-4">
        <p className="text-[14px] leading-[1.8] text-muted">{meta.lead}</p>
        {/* 空欄を前に考え込ませないよう、このセクションを AI と考える入口を先に置く */}
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-primary-soft px-4 py-3 text-sm">
          <span className="flex-1">
            {fromAi ? "AI の案から採用した内容です。直したいところは下の欄で直せます。" : "何を書けばいいか迷ったら、AI が質問しながら案を出します。"}
          </span>
          {aiEnabled ? (
            <Link href={`/projects/${projectId}/plan/chat?section=${sectionKey}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              AI と考える
            </Link>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">準備中</span>
              <button type="button" disabled className={buttonClass({ variant: "secondary", size: "sm" })}>
                AI と考える
              </button>
            </span>
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
            保存
          </Button>
          {!isLast && (
            <Button type="submit" disabled={pending} onClick={() => (goNext.current = true)}>
              保存して次へ
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function SectionFields({ sectionKey, plan }: { sectionKey: SectionKey; plan: PlanData }) {
  switch (sectionKey) {
    case "goal":
      return <GoalFields v={plan.goal} />;
    case "audience":
      return <AudienceFields v={plan.audience} />;
    case "ownership":
      return <OwnershipFields v={plan.ownership} />;
    case "profile":
      return <ProfileFields v={plan.profile} />;
    case "pillars":
      return <PillarsFields v={plan.pillars} />;
    case "cadence":
      return <CadenceFields v={plan.cadence} />;
    case "first_month":
      return <FirstMonthFields v={plan.first_month} />;
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
            いちばんの目標（<Term k="kgi" />
            の方向）
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

// 各 SNS でユーザー名が取れるかを確かめる場所（おおまかな案内。各社の画面は変わることがある）
const HANDLE_CHECK_STEPS: { sns: string; how: string }[] = [
  { sns: "X", how: "設定 → アカウント情報 → ユーザー名 に入力すると、使えるかどうかがその場で出ます" },
  { sns: "Instagram", how: "プロフィールを編集 → ユーザーネーム に入力すると、使えるかどうかが出ます" },
  { sns: "Threads", how: "Instagram のユーザーネームがそのまま使われます。Instagram で確かめれば十分です" },
  { sns: "TikTok", how: "プロフィールを編集 → ユーザー名 に入力すると、使えるかどうかが出ます" },
  { sns: "YouTube", how: "チャンネルのカスタマイズ（YouTube Studio）→ ハンドル に入力すると、使えるかどうかが出ます" },
  { sns: "Facebook", how: "Facebook ページを作る場合だけ。ページの設定 → ユーザーネーム に入力すると出ます。使わないなら飛ばして構いません" },
];

function ProfileFields({ v }: { v: PlanData["profile"] }) {
  return (
    <>
      <div className="rounded-md bg-primary-soft px-4 py-3 text-sm leading-[1.8]">
        <p>
          <b>ユーザー名は慎重に、表示名は気軽に。</b>
          ユーザー名（@ のあとの英数字）は、変えるとこれまでのリンクや検索で見つけてもらえなくなるため、後から変えにくいものです。表示名はいつでも変えられます。
        </p>
      </div>
      <Field label="表示名" htmlFor="profile-name" hint="あとからいつでも変えられます。名前のあとに「何をしている人か」を添えると伝わりやすくなります">
        <Input id="profile-name" name="displayName" defaultValue={v.displayName} maxLength={50} placeholder="例: まさ｜家計簿アプリを作っています" />
      </Field>
      <Field label="ユーザー名（第一候補）" htmlFor="profile-handle" hint="6 つの SNS で同じ綴りにそろえると、見つけてもらいやすくなります">
        <Input id="profile-handle" name="handle" defaultValue={v.handle} maxLength={30} placeholder="例: kakeibo_biyori" autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="予備のユーザー名" htmlFor="profile-handle-backups" hint="第一候補が取れない SNS があったときのために、2〜3 個。1 行に 1 つ">
        <Textarea
          id="profile-handle-backups"
          name="handleBackups"
          defaultValue={v.handleBackups}
          maxLength={200}
          rows={3}
          spellCheck={false}
          placeholder={"例: kakeibo_biyori_app\nkakeibobiyori\nmasa_kakeibo"}
        />
      </Field>
      <details className="group rounded-md border border-line text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-bold">
          <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
            ▸
          </span>
          6 つの SNS で同じユーザー名が取れるか確かめる
        </summary>
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 leading-[1.8]">
          <p>
            それぞれの SNS に<b>ログインした状態</b>で、ユーザー名を変える画面に候補を入力してみます。使えるかどうかがその場で出ます。保存しなければ、今のユーザー名は変わりません。新しくアカウントを作る場合は、新規登録の画面で入力しても確かめられます。
          </p>
          <ul className="flex flex-col gap-1.5">
            {HANDLE_CHECK_STEPS.map((s) => (
              <li key={s.sns} className="grid grid-cols-[84px_1fr] gap-2 max-sm:grid-cols-1 max-sm:gap-0">
                <b>{s.sns}</b>
                <span>{s.how}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            画面の場所は各 SNS の変更で変わることがあります。ログインしていないと空いているかどうかを正しく判定できないため、矢書では空きを自動で調べません。
          </p>
        </div>
      </details>
      <p className="text-sm">
        <span className="font-bold text-signal">注意</span>　Instagram のアカウントで Threads を使う場合、Threads のユーザー名は Instagram のユーザーネームと同じになります（Threads だけ別の名前にはできません）。
      </p>
      <Field label="自己紹介文" htmlFor="profile-bio" hint="160 文字くらいまでが目安です（X の上限）">
        <Textarea
          id="profile-bio"
          name="bio"
          defaultValue={v.bio}
          maxLength={300}
          placeholder="例: 家計簿が続かない人のためのアプリ「かけいぼ日和」を個人で開発中。お金が貯まる小さなコツと、開発の裏側を発信します。"
        />
      </Field>
      <Field label="リンク先" htmlFor="profile-link" hint="プロフィールに 1 つだけ置くリンク。迷ったらストアページ">
        <Input id="profile-link" name="link" defaultValue={v.link} maxLength={300} placeholder="例: App Store のページの URL" />
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

function FirstMonthFields({ v }: { v: PlanData["first_month"] }) {
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
      <p className="text-xs text-muted">
        表示回数は <Term k="impression" />
        とも呼ばれます。指標の画面ができたら、ここで決めた数字を矢書の中で追えるようにします。
      </p>
    </>
  );
}
