"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CopyButton } from "@/components/links/link-forms";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { createLink } from "@/lib/links/actions";
import {
  PROFILE_RULES,
  charCount,
  effectiveProfile,
  handleMismatches,
  profileIssues,
  profileTargetSns,
  type ProfileIssue,
} from "@/lib/plan/profile";
import { type PlanData, type ProfileOverride, type ProfileOverrideField } from "@/lib/plan/schema";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";

// 名前とプロフィール（アカウント設計の 5）。共通を土台に、SNS ごとに上書きできる（決定 D26、docs/architecture.md の 4.8）

export type ProfileContext = {
  projectId: string;
  // つないだアカウント（実際のユーザー名を設計と比べる）
  accounts: { sns: SnsKey; handle: string }[];
  // SNS ごとのプロフィールの短縮リンク（短縮リンクの画面の「プロフィールに置くリンク」）
  profileLinks: Partial<Record<SnsKey, string>>;
  // 短縮リンクの行き先（プロジェクトのストアの URL）。空なら短縮リンクの画面へ案内する
  destination: string | null;
};

type Common = Pick<PlanData["profile"], "displayName" | "handle" | "handleBackups" | "bio" | "link">;
type Overrides = Partial<Record<SnsKey, ProfileOverride>>;

const FIELD_LABEL: Record<ProfileOverrideField, string> = { displayName: "表示名", handle: "ユーザー名", bio: "自己紹介文", link: "リンク先" };

// 各 SNS でユーザー名が取れるかを確かめる場所（おおまかな案内。各社の画面は変わることがある）
const HANDLE_CHECK_STEPS: { sns: string; how: string }[] = [
  { sns: "X", how: "設定 → アカウント情報 → ユーザー名 に入力すると、使えるかどうかがその場で出ます" },
  { sns: "Instagram", how: "プロフィールを編集 → ユーザーネーム に入力すると、使えるかどうかが出ます" },
  { sns: "Threads", how: "Instagram とつないだ Threads は、Instagram のユーザーネームがそのまま使われます。Instagram で確かめれば十分です" },
  { sns: "TikTok", how: "プロフィールを編集 → ユーザー名 に入力すると、使えるかどうかが出ます" },
  { sns: "YouTube", how: "チャンネルのカスタマイズ（YouTube Studio）→ ハンドル に入力すると、使えるかどうかが出ます" },
  { sns: "Facebook", how: "Facebook ページを作る場合だけ。ページの設定 → ユーザーネーム に入力すると出ます。使わないなら飛ばして構いません" },
];

const emptyOverride = (): ProfileOverride => ({ displayName: "", handle: "", bio: "", link: "" });

export function ProfileFields({ v, roles, ctx }: { v: PlanData["profile"]; roles: PlanData["cadence"]["roles"]; ctx: ProfileContext }) {
  const [common, setCommon] = useState<Common>({ displayName: v.displayName, handle: v.handle, handleBackups: v.handleBackups, bio: v.bio, link: v.link });
  const [overrides, setOverrides] = useState<Overrides>(v.bySns);
  const rootRef = useRef<HTMLDivElement>(null);

  const profile: PlanData["profile"] = { ...common, bySns: overrides };
  const connected = ctx.accounts.map((a) => a.sns);
  const targets = profileTargetSns({ profile, cadence: { frequency: "", roles } }, connected);
  const others = SNS_KEYS.filter((s) => !targets.includes(s));
  const mismatches = handleMismatches(profile, ctx.accounts);

  const setOverride = (sns: SnsKey, field: ProfileOverrideField, value: string) =>
    setOverrides((prev) => ({ ...prev, [sns]: { ...(prev[sns] ?? emptyOverride()), [field]: value } }));

  // 設計のユーザー名を、つないだアカウントに合わせて保存する（共通と同じなら上書きを消す）
  const matchHandle = (sns: SnsKey, actual: string) => {
    const base = sns === "threads" ? effectiveProfile(profile, "instagram").handle : common.handle.trim().replace(/^@/, "");
    setOverride(sns, "handle", actual.toLowerCase() === base.toLowerCase() ? "" : actual);
    // 値が欄に入ってから送る
    requestAnimationFrame(() => rootRef.current?.closest("form")?.requestSubmit());
  };

  const commonBioLimits = targets
    .map((s) => PROFILE_RULES[s].bioMax && { sns: s, max: PROFILE_RULES[s].bioMax! })
    .filter((x): x is { sns: SnsKey; max: number } => Boolean(x));

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      <div className="rounded-md bg-primary-soft px-4 py-3 text-sm leading-[1.8]">
        <p>
          <b>ユーザー名は慎重に、表示名は気軽に。</b>
          ユーザー名（@ のあとの英数字）は、変えるとこれまでのリンクや検索で見つけてもらえなくなるため、後から変えにくいものです。表示名はいつでも変えられます。
        </p>
      </div>

      {mismatches.map((m) => (
        <div key={m.sns} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line px-4 py-3 text-sm leading-[1.7]">
          <span className="flex-1">
            <b>{SNS[m.sns].label}</b>: 設計では {m.planned ? <b>@{m.planned}</b> : "まだ決めていません"}、つないだのは <b>@{m.actual}</b> です。
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={() => matchHandle(m.sns, m.actual)}>
            設計を @{m.actual} に合わせる
          </Button>
        </div>
      ))}

      <p className="text-[14px] font-bold">共通（どの SNS でも使う名前とプロフィール）</p>
      <Field label="表示名" htmlFor="profile-name" hint="あとからいつでも変えられます。名前のあとに「何をしている人か」を添えると伝わりやすくなります">
        <Input
          id="profile-name"
          name="displayName"
          value={common.displayName}
          onChange={(e) => setCommon({ ...common, displayName: e.target.value })}
          maxLength={50}
          placeholder="例: まさ｜家計簿アプリを作っています"
        />
      </Field>
      <Field label="ユーザー名（第一候補）" htmlFor="profile-handle" hint="どの SNS でも同じ綴りにそろえると、見つけてもらいやすくなります。X は 15 字まで">
        <Input
          id="profile-handle"
          name="handle"
          value={common.handle}
          onChange={(e) => setCommon({ ...common, handle: e.target.value })}
          maxLength={30}
          placeholder="例: kakeibo_biyori"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label="予備のユーザー名" htmlFor="profile-handle-backups" hint="第一候補が取れない SNS があったときのために、2〜3 個。1 行に 1 つ">
        <Textarea
          id="profile-handle-backups"
          name="handleBackups"
          value={common.handleBackups}
          onChange={(e) => setCommon({ ...common, handleBackups: e.target.value })}
          maxLength={200}
          rows={3}
          spellCheck={false}
          placeholder={"例: kakeibo_biyori_app\nkakeibobiyori\nmasa_kakeibo"}
        />
      </Field>
      <HandleCheckSteps />
      <Field
        label="自己紹介文"
        htmlFor="profile-bio"
        hint={
          <>
            いま {charCount(common.bio)} 字。
            {commonBioLimits.length
              ? `上限は ${commonBioLimits.map((l) => `${SNS[l.sns].label} ${l.max} 字`).join("、")}。超える SNS は、下の SNS ごとの欄で短くします`
              : "上限は SNS ごとに違います（X 160 字、Instagram・Threads 150 字など）"}
          </>
        }
      >
        <Textarea
          id="profile-bio"
          name="bio"
          value={common.bio}
          onChange={(e) => setCommon({ ...common, bio: e.target.value })}
          maxLength={300}
          placeholder="例: 家計簿が続かない人のためのアプリ「かけいぼ日和」を個人で開発中。お金が貯まる小さなコツと、開発の裏側を発信します。"
        />
      </Field>
      <Field label="リンク先" htmlFor="profile-link" hint="プロフィールに置くリンク。迷ったらストアページ。SNS ごとの短縮リンクにすると、どの SNS から来たかがわかります">
        <Input id="profile-link" name="link" value={common.link} onChange={(e) => setCommon({ ...common, link: e.target.value })} maxLength={300} placeholder="例: App Store のページの URL" />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-bold">SNS ごとに変える（任意）</legend>
        <p className="mb-1 text-xs leading-[1.7] text-muted">
          SNS ごとに役割が違うときは、その SNS だけ名前や自己紹介文を変えられます。空欄の項目は、上の共通を使います。
          {targets.length > 0 && "「頻度と SNS ごとの役割」に書いた SNS と、つないだ SNS を並べています。"}
        </p>
        {targets.map((sns) => (
          <SnsRow key={sns} sns={sns} profile={profile} role={roles[sns]} ctx={ctx} onChange={setOverride} />
        ))}
        {others.length > 0 && (
          <details className="group/others rounded-md border border-line text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-bold">
              <span aria-hidden className="text-muted transition-transform group-open/others:rotate-90">
                ▸
              </span>
              {targets.length ? `ほかの SNS（${others.length}）` : "SNS を選んで変える"}
            </summary>
            <div className="flex flex-col gap-2 border-t border-line p-3">
              {others.map((sns) => (
                <SnsRow key={sns} sns={sns} profile={profile} role={roles[sns]} ctx={ctx} onChange={setOverride} />
              ))}
            </div>
          </details>
        )}
      </fieldset>
    </div>
  );
}

function HandleCheckSteps() {
  return (
    <details className="group rounded-md border border-line text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-bold">
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ▸
        </span>
        それぞれの SNS で同じユーザー名が取れるか確かめる
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
  );
}

// その SNS の決まりを 1 行で
function ruleSummary(sns: SnsKey): string {
  const r = PROFILE_RULES[sns];
  const parts: string[] = [];
  if (r.handle) parts.push(`ユーザー名 ${r.handle.min}〜${r.handle.max} 字（${r.handle.chars}）`);
  if (r.displayNameMax) parts.push(`表示名 ${r.displayNameMax} 字まで`);
  if (r.bioMax) parts.push(`自己紹介文 ${r.bioMax.toLocaleString("ja-JP")} 字まで`);
  parts.push(`リンク: ${r.linkNote}`);
  return parts.join("・");
}

function SnsRow({
  sns,
  profile,
  role,
  ctx,
  onChange,
}: {
  sns: SnsKey;
  profile: PlanData["profile"];
  role: string | undefined;
  ctx: ProfileContext;
  onChange: (sns: SnsKey, field: ProfileOverrideField, value: string) => void;
}) {
  const o = profile.bySns[sns] ?? emptyOverride();
  const e = effectiveProfile(profile, sns);
  const issues = profileIssues(profile, sns);
  const rule = PROFILE_RULES[sns];
  const id = (f: ProfileOverrideField) => `profile-${sns}-${f}`;
  const issueOf = (f: ProfileOverrideField) => {
    const msg = issues.filter((i: ProfileIssue) => i.field === f).map((i) => i.message).join("。");
    if (!msg) return undefined;
    // 共通の値が合わないときは、この欄に SNS 用の値を入れれば直せる
    return e.overridden.includes(f) ? msg : `${msg}。この欄に ${SNS[sns].label} 用の${FIELD_LABEL[f]}を入れると直せます`;
  };
  const changed = e.overridden.map((f) => FIELD_LABEL[f]);
  const commonOf: Record<ProfileOverrideField, string> = { displayName: profile.displayName, handle: profile.handle, bio: profile.bio, link: profile.link };
  // Threads は、上書きがなければ Instagram と同じユーザー名
  const threadsBase = sns === "threads" ? effectiveProfile(profile, "instagram").handle : "";
  const handlePlaceholder =
    sns === "threads" ? (threadsBase ? `Instagram と同じ: ${threadsBase}` : "空欄なら Instagram と同じ") : commonOf.handle ? `共通: ${commonOf.handle}` : "空欄なら共通を使います";

  return (
    <details className="group/sns rounded-md border border-line bg-surface text-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
        <span aria-hidden className="text-muted transition-transform group-open/sns:rotate-90">
          ▸
        </span>
        <b className="w-[84px] max-sm:w-auto">{SNS[sns].label}</b>
        <span className="min-w-0 flex-1 text-muted">{changed.length ? `${changed.join("・")}を変えています` : "共通と同じ"}</span>
        {issues.length > 0 && <span className="text-xs font-bold text-danger">決まりに合わないところがあります</span>}
      </summary>
      <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
        {role?.trim() && (
          <p className="text-xs leading-[1.7] text-muted">
            この SNS の役割: <span className="text-fg">{role}</span>
          </p>
        )}
        <p className="text-xs leading-[1.7] text-muted">{ruleSummary(sns)}</p>
        <Field label={FIELD_LABEL.displayName} htmlFor={id("displayName")} error={issueOf("displayName")} hint={rule.displayNameMax ? `${charCount(e.displayName)} / ${rule.displayNameMax} 字` : undefined}>
          <Input
            id={id("displayName")}
            name={`sns-${sns}-displayName`}
            value={o.displayName}
            onChange={(ev) => onChange(sns, "displayName", ev.target.value)}
            maxLength={50}
            placeholder={commonOf.displayName ? `共通: ${commonOf.displayName}` : "空欄なら共通を使います"}
            invalid={Boolean(issueOf("displayName"))}
          />
        </Field>
        <Field
          label={FIELD_LABEL.handle}
          htmlFor={id("handle")}
          error={issueOf("handle")}
          hint={rule.handle ? `${charCount(e.handle)} / ${rule.handle.max} 字${rule.handle.note ? `。${rule.handle.note}` : ""}` : undefined}
        >
          <Input
            id={id("handle")}
            name={`sns-${sns}-handle`}
            value={o.handle}
            onChange={(ev) => onChange(sns, "handle", ev.target.value)}
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            placeholder={handlePlaceholder}
            invalid={Boolean(issueOf("handle"))}
          />
        </Field>
        <Field label={FIELD_LABEL.bio} htmlFor={id("bio")} error={issueOf("bio")} hint={rule.bioMax ? `${charCount(e.bio)} / ${rule.bioMax.toLocaleString("ja-JP")} 字` : undefined}>
          <Textarea
            id={id("bio")}
            name={`sns-${sns}-bio`}
            value={o.bio}
            onChange={(ev) => onChange(sns, "bio", ev.target.value)}
            maxLength={300}
            rows={3}
            placeholder={commonOf.bio ? `共通: ${commonOf.bio}` : "空欄なら共通を使います"}
            invalid={Boolean(issueOf("bio"))}
          />
        </Field>
        <Field label={FIELD_LABEL.link} htmlFor={id("link")}>
          <Input
            id={id("link")}
            name={`sns-${sns}-link`}
            value={o.link}
            onChange={(ev) => onChange(sns, "link", ev.target.value)}
            maxLength={300}
            placeholder={commonOf.link ? `共通: ${commonOf.link}` : "空欄なら共通を使います"}
          />
        </Field>
        <ShortLink sns={sns} ctx={ctx} current={e.link} onUse={(url) => onChange(sns, "link", url)} />
      </div>
    </details>
  );
}

// その SNS のプロフィール用の短縮リンク（短縮リンクの画面と同じもの。docs/architecture.md の 4.22）
function ShortLink({ sns, ctx, current, onUse }: { sns: SnsKey; ctx: ProfileContext; current: string; onUse: (url: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const url = ctx.profileLinks[sns];

  if (url) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface2 px-3 py-2 text-xs">
        <span className="text-muted">
          <Term k="shortLink" />:
        </span>
        <b className="break-all">{url.replace(/^https:\/\//, "")}</b>
        <CopyButton text={url} />
        {current !== url && (
          <button type="button" onClick={() => onUse(url)} className="shrink-0 text-sm font-semibold text-primary hover:underline">
            リンク先に入れる
          </button>
        )}
      </div>
    );
  }
  if (!ctx.destination) {
    return (
      <p className="text-xs leading-[1.7] text-muted">
        この SNS から何人来たかを数えるには、<Link href={`/projects/${ctx.projectId}/links`} className="text-primary hover:underline">短縮リンク</Link>
        をリンク先にします（先にプロジェクトにストアの URL を入れます）。
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = new FormData();
              fd.set("kind", "profile");
              fd.set("sns", sns);
              fd.set("label", `${SNS[sns].label} のプロフィール`);
              fd.set("destination", ctx.destination!);
              const r = await createLink(ctx.projectId, {}, fd);
              if (r.error) setError(r.error);
              else router.refresh();
            })
          }
        >
          {pending ? "作っています…" : `${SNS[sns].label} 用の短縮リンクを作る`}
        </Button>
        <span className="text-muted">どの SNS から何人来たかを数えられます。行き先: {ctx.destination}</span>
      </div>
      {error && <p className="font-semibold text-danger">{error}</p>}
    </div>
  );
}

