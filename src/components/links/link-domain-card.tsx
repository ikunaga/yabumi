"use client";

import { guardAction } from "@/lib/client-errors";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { addLinkDomainAction, checkLinkDomainAction, removeLinkDomainAction, type LinkDomainActionState } from "@/lib/links/actions";
import { apexOf, checkCooldownSeconds, dnsRecordName, LINK_DOMAIN_CHECK_INTERVAL_MS } from "@/lib/links/domain-rules";
import { ownershipRecordName, ownershipRecordValue } from "@/lib/links/doh";
import { CopyButton } from "./link-forms";

// 短縮リンクを自分のドメインで作る（F07、決定 D28。docs/architecture.md の 4.22）。
// ① ドメインを入れる ② DNS に行を足す（つなぐ CNAME と、持ち主の確認の TXT） ③ 確かめる、の 3 段を見せ、今どこかを示す。ドメインを持っていない人には無理に勧めない

export type LinkDomainView = {
  domain: string;
  status: "pending" | "active";
  cnameTarget: string;
  txtName: string;
  txtValue: string;
  // yabumi の持ち主の確認の合言葉（_yabumi.<ドメイン> の TXT）
  ownershipToken: string;
  // pending になった日時（ここから 7 日で取り消す）と、前につながっていた日時（外れて戻したときに知らせる）
  pendingSince: string;
  verifiedAt: string | null;
  lastCheck: string;
  lastCheckedAt: string | null;
};

type Props = {
  projectId: string;
  // Vercel の API の設定があるか（ないときは「準備中」）
  ready: boolean;
  domain: LinkDomainView | null;
  // 今の短縮リンクのドメイン（例 go.yabumi.app）
  defaultHost: string;
  // 貼り直してほしいプロフィールのリンク（SNS の名前と、新しい URL）
  profileLinks: { sns: string; url: string }[];
};

// tone: fix は直すことがはっきりしているとき、check は入れたものを見てほしいとき（まだ入っていないか、見えるまで待つか、どちらもあり得る）、wait は待てばよいとき。
// 見出しと本文が食い違わないように分ける（2026-11-28 ja-copy-reviewer の指摘）
const CHECK_HEAD = { fix: "直してください: ", check: "見てください: ", wait: "このまま待ってください: " } as const;
const CHECK_MESSAGE: Record<string, { tone: keyof typeof CHECK_HEAD; text: string }> = {
  dns_missing: { tone: "check", text: "追加した行が、まだ見えません。見えるまで、数分〜数時間かかることがあります。まだ追加していなければ、上の行を追加してください。少しおいてから、もう一度「確認する」を押してください。" },
  wrong_value: {
    tone: "fix",
    text: "DNS の値が違います。上の表と同じになっているか確認してください。種類が A か CNAME で、名前が同じ古い行があれば、削除してください。",
  },
  proxied: { tone: "fix", text: "Cloudflare の Proxy がオンになっています。オレンジの雲の印です。その行の雲を押して灰色の DNS only にしてから、保存してください。" },
  owner_txt_missing: { tone: "check", text: "2 行目の TXT が、まだ見えません。名前と値が、上の 2 行目と同じか見てください。追加したばかりなら、数分おいてからもう一度「確認する」を押してください。" },
  txt_missing: { tone: "fix", text: "3 行目の TXT が、まだ見えません。3 行目も追加してください。" },
  cert_pending: {
    tone: "wait",
    text: "行は確認できました。いま、リンクを安全に開けるように準備しています。数分〜1 時間ほどかかります。少しおいてから、もう一度「確認する」を押してください。",
  },
  error: { tone: "wait", text: "いま確認できませんでした。時間をおいてもう一度お試しください。" },
};

export function LinkDomainCard({ projectId, ready, domain, defaultHost, profileLinks }: Props) {
  const step = !domain ? 1 : domain.status === "active" ? 4 : 2;
  const [open, setOpen] = useState(Boolean(domain));

  return (
    <section aria-labelledby="link-domain-heading" className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-x-3 gap-y-3 px-6 py-5 max-sm:flex-col max-sm:items-start max-sm:px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="link-domain-heading" className="text-[18px] font-bold max-sm:text-[16px]">
            自分のドメインで作る
          </h2>
          <p className="text-sm leading-[1.7] text-muted">
            {domain?.status === "active" ? (
              <>
                短縮リンクを <b className="text-fg">{domain.domain}</b> で作っています。
              </>
            ) : (
              <>
                今の短縮リンクは <b className="text-fg">{defaultHost}/…</b> です。自分のドメインにすると、押す人に「どこへ行くリンクか」が伝わりやすくなります。リンクは go.
                <i>あなたのドメイン</i>/… の形になります。ドメインがなくても、今のリンクのまま使えます。
              </>
            )}
          </p>
        </div>
        {!domain &&
          (ready ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="link-domain-body">
              {open ? "閉じる" : "設定する"}
            </Button>
          ) : (
            // 運営の準備（Vercel のトークン）ができていないとき。利用者にできることはないので、操作は出さない（ストアの画面と同じ。2026-11-21 PM の指示）
            <Badge>まだ使えません</Badge>
          ))}
      </div>

      {!ready && !domain && (
        <p className="border-t border-line px-6 py-4 text-sm text-muted max-sm:px-4">いまは、することはありません。yabumi の運営の準備ができたら、ここで設定できます。</p>
      )}
      {ready && (open || domain) && (
        <div id="link-domain-body" className="flex flex-col gap-5 border-t border-line px-6 py-5 max-sm:px-4">
          <Steps step={step} />
          {!domain && <DomainForm projectId={projectId} />}
          {domain && domain.status === "pending" && <DnsStep projectId={projectId} domain={domain} defaultHost={defaultHost} />}
          {domain && domain.status === "active" && <Connected domain={domain} profileLinks={profileLinks} />}
          {domain && <RemoveDomain projectId={projectId} domain={domain} defaultHost={defaultHost} />}
        </div>
      )}
    </section>
  );
}

function Steps({ step }: { step: number }) {
  const items = ["ドメインを入れる", "DNS に行を追加", "確認する"];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="手順">
      {items.map((label, i) => {
        const n = i + 1;
        // ② を表示している間は、③（確かめる）も同じ画面で行う
        const current = n === step || (step === 2 && n === 3);
        const done = n < step;
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="flex min-w-0 items-center gap-2">
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
                done ? "bg-success text-surface" : current ? "bg-primary text-on-primary" : "border border-border text-muted"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={`text-sm leading-tight ${current ? "font-bold text-fg" : "text-muted"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DomainForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<LinkDomainActionState, FormData>(guardAction(addLinkDomainAction.bind(null, projectId), (m) => ({ error: m })), {});
  const [value, setValue] = useState("");
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm leading-[1.8]">
        持っているドメインの前に <b>go.</b> を付けて、短縮リンクに使います。これを<Term k="subdomain">サブドメイン</Term>と呼びます。たとえば go.example.com です。今のホームページやメールには影響しません。追加の料金もかかりません。
      </p>
      {state.error && (
        <ErrorBanner>
          {state.error}
          {state.suggestion && (
            <button type="button" onClick={() => setValue(state.suggestion!)} className="ml-1 font-bold text-primary hover:underline">
              {state.suggestion} にする
            </button>
          )}
        </ErrorBanner>
      )}
      <Field label="短縮リンクに使う名前" htmlFor="link-domain" hint="go.あなたのドメイン の形で入れます。https:// は要りません。1 人 1 つまでです。ほかの人が使っているものは使えません。">
        <Input
          id="link-domain"
          name="domain"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="go.example.com"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          maxLength={253}
          required
        />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "受け付けています…" : "次へ: 追加する行を見る"}
        </Button>
      </div>
    </form>
  );
}

type DnsRecord = { type: string; name: string; value: string; why: string };

// 1 行目はつなぐため、2 行目はあなたのドメインだと yabumi が確かめるため、3 行目（要るときだけ）は Vercel が確かめるため
function records(domain: LinkDomainView): DnsRecord[] {
  const apex = apexOf(domain.domain);
  const list: DnsRecord[] = [
    { type: "CNAME", name: dnsRecordName(domain.domain, apex), value: domain.cnameTarget, why: "yabumi につなぐため" },
    { type: "TXT", name: dnsRecordName(ownershipRecordName(domain.domain), apex), value: ownershipRecordValue(domain.ownershipToken), why: "あなたのドメインだと確認するため" },
  ];
  if (domain.txtValue) list.push({ type: "TXT", name: dnsRecordName(thirdRecordName(domain), apex), value: domain.txtValue, why: "yabumi が使っているサービスの確認のため" });
  return list;
}

// 3 行目（Vercel の確認の TXT）の、ドメインまでの名前
function thirdRecordName(domain: LinkDomainView): string {
  return domain.txtName || `_vercel.${apexOf(domain.domain)}`;
}

function RecordTable({ domain }: { domain: LinkDomainView }) {
  const rows = records(domain);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <dl key={r.name} className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface2 px-4 py-3 text-sm">
          <p className="col-span-2 text-xs font-bold text-muted">
            {i + 1} 行目: {r.why}
          </p>
          <dt className="text-muted">種類</dt>
          <dd className="font-bold">{r.type}</dd>
          <dt className="text-muted">名前</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-3">
            <code className="font-bold break-all">{r.name}</code>
            <CopyButton text={r.name} />
          </dd>
          <dt className="text-muted">値</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-3">
            <code className="font-bold break-all">{r.value}</code>
            <CopyButton text={r.value} />
          </dd>
        </dl>
      ))}
      <p className="text-xs leading-[1.7] text-muted">
        「名前」の欄に、ドメインまですべて入れる形のサービスもあります。そのときは、1 行目は <code>{domain.domain}</code>、2 行目は{" "}
        <code>{ownershipRecordName(domain.domain)}</code>
        {domain.txtValue && (
          <>
            、3 行目は <code>{thirdRecordName(domain)}</code>
          </>
        )}{" "}
        と入れてください。保存したら、一覧の名前を見てください。末尾に <code>{apexOf(domain.domain)}</code> が 2 回付いていたら、編集して短い形にしてください。TTL
        という欄があれば、「自動」のままでかまいません。
      </p>
    </div>
  );
}

// よく使う DNS のサービスごとの手順（画面の名前は、サービスの側で変わることがある。2026-10 時点）。
// TXT の行も番号つきの段に入れる（2026-11-28 オーナーの指摘「TXT の入れ方が手順にない」）。
// 名前の欄にサブドメインの部分だけを入れることを公式のヘルプで確かめたのは Cloudflare とお名前.com（2026-11-28）。
// ほかは確かめられないので、TXT の段は「そのほか」と同じく 2 つの形を出し、1 行目と同じ形にするよう書く（ja-copy-reviewer の指摘）
type StepRecord = { row: number; name: string; value: string; fqdn: string };
type StepInput = { cname: StepRecord; txts: StepRecord[] };

// 名前の形を確かめられていないサービスの TXT の段。欄の名前はそのサービスの 1 行目の段と同じにし、保存の段まで書く
function txtSteps(t: StepRecord, f: { cnameStep: number; open: ReactNode; name: string; type: string; value: string; save: ReactNode }): ReactNode[] {
  return [
    f.open,
    <>
      {f.name}に <b>{t.name}</b>、{f.type}は <b>TXT</b>、{f.value}に <b className="break-all">{t.value}</b> を入れる。上の {t.row} 行目です。{f.cnameStep}. でドメインまで入れたときは、{f.name}を{" "}
      <b className="break-all">{t.fqdn}</b> にする
    </>,
    f.save,
  ];
}

const PROVIDERS: { key: string; label: string; steps: (r: StepInput) => ReactNode[] }[] = [
  {
    key: "cloudflare",
    label: "Cloudflare",
    steps: ({ cname, txts }) => [
      <>Cloudflare にログインし、ドメインを選んで、左の「DNS」→「Records」を開く</>,
      <>「Add record」を押す</>,
      <>
        Type は <b>CNAME</b>、Name に <b>{cname.name}</b>、Target に <b className="break-all">{cname.value}</b> を入れる
      </>,
      <>
        <b className="text-danger">Proxy status を押して、灰色の雲の DNS only にする。</b>オレンジの雲の Proxied のままだと、つながりません
      </>,
      <>「Save」を押す</>,
      ...txts.flatMap((t) => [
        <>もう一度「Add record」を押す</>,
        <>
          Type は <b>TXT</b>、Name に <b>{t.name}</b>、Content に <b className="break-all">{t.value}</b> を入れる。上の {t.row} 行目です。TXT では Proxy status を押さなくてかまいません
        </>,
        <>「Save」を押す</>,
      ]),
    ],
  },
  {
    key: "onamae",
    label: "お名前.com",
    steps: ({ cname, txts }) => [
      <>お名前.com Navi にログインし、「ネームサーバーの設定」→「DNS 設定/転送設定」を開く</>,
      <>ドメインを選んで「次へ」、「DNS レコード設定を利用する」の「設定する」を押す</>,
      <>
        ホスト名に <b>{cname.name}</b>、TYPE は <b>CNAME</b>、VALUE に <b className="break-all">{cname.value}</b> を入れて「追加」を押す
      </>,
      ...txts.map((t) => (
        <>
          同じ画面で、ホスト名に <b>{t.name}</b>、TYPE は <b>TXT</b> にする。VALUE に <b className="break-all">{t.value}</b> を入れて「追加」を押す。上の {t.row} 行目です
        </>
      )),
      <>下の「確認画面へ進む」を押し、「設定する」を押す。うまくいかないときは、ホームページを作った人に聞いてください</>,
    ],
  },
  {
    key: "muumuu",
    label: "ムームードメイン",
    steps: ({ cname, txts }) => [
      <>コントロールパネルにログインし、「ドメイン管理」→「ムームー DNS」を開く</>,
      <>ドメインの「変更」を押し、「カスタム設定」を開く</>,
      <>
        サブドメインに <b>{cname.name}</b>、種別は <b>CNAME</b>、内容に <b className="break-all">{cname.value}</b> を入れる
      </>,
      <>「セットアップ情報変更」を押す</>,
      ...txts.flatMap((t) => txtSteps(t, { cnameStep: 3, open: <>もう一度「カスタム設定」を開く</>, name: "サブドメイン", type: "種別", value: "内容", save: <>「セットアップ情報変更」を押す</> })),
    ],
  },
  {
    key: "squarespace",
    label: "Squarespace・旧 Google Domains",
    steps: ({ cname, txts }) => [
      <>Squarespace にログインし、「Domains」→ ドメインを選んで「DNS」→「DNS Settings」を開く</>,
      <>「Custom records」の「Add record」を押す</>,
      <>
        Host に <b>{cname.name}</b>、Type は <b>CNAME</b>、Data に <b className="break-all">{cname.value}</b> を入れる
      </>,
      <>「Save」を押す</>,
      ...txts.flatMap((t) => txtSteps(t, { cnameStep: 3, open: <>もう一度「Add record」を押す</>, name: "Host ", type: "Type ", value: "Data ", save: <>「Save」を押す</> })),
    ],
  },
  {
    key: "xserver",
    label: "Xserver",
    steps: ({ cname, txts }) => [
      <>サーバーパネルか、Xserver アカウントのドメインの管理にログインし、「DNS レコード設定」を開く</>,
      <>ドメインを選び、「DNS レコード追加」のタブを開く</>,
      <>
        ホスト名に <b>{cname.name}</b>、種別は <b>CNAME</b>、内容に <b className="break-all">{cname.value}</b> を入れる
      </>,
      <>「確認画面へ進む」→「追加する」を押す</>,
      ...txts.flatMap((t) => txtSteps(t, { cnameStep: 3, open: <>もう一度「DNS レコード追加」のタブを開く</>, name: "ホスト名", type: "種別", value: "内容", save: <>「確認画面へ進む」→「追加する」を押す</> })),
    ],
  },
  {
    key: "other",
    label: "そのほか",
    steps: ({ cname, txts }) => [
      <>ドメインを買ったサービスか、DNS を任せているサービスの管理画面で、「DNS」「DNS レコード」「ゾーン」などの画面を開く</>,
      <>
        種類は <b>CNAME</b>、名前に <b>{cname.name}</b> か <b>{cname.fqdn}</b>、値に <b className="break-all">{cname.value}</b> を入れて保存する。名前は「ホスト」、値は「向け先」「内容」「Target」と書かれていることもあります
      </>,
      ...txts.flatMap((t) => txtSteps(t, { cnameStep: 2, open: <>もう一度、行を追加する</>, name: "名前", type: "種類", value: "値", save: <>保存する</> })),
      <>どこで設定するかわからないときは、そのサービスのヘルプで「CNAME 設定」と探すと見つかります</>,
    ],
  },
];

// 上の行を、手順に入れる形にする（名前はサブドメインの部分と、ドメインまでの全部の 2 つ）
function stepInput(domain: LinkDomainView): StepInput {
  const rows = records(domain);
  const full = [domain.domain, ownershipRecordName(domain.domain), thirdRecordName(domain)];
  const list = rows.map((r, i) => ({ row: i + 1, name: r.name, value: r.value, fqdn: full[i] }));
  return { cname: list[0], txts: list.slice(1) };
}

function DnsStep({ projectId, domain, defaultHost }: { projectId: string; domain: LinkDomainView; defaultHost: string }) {
  const [provider, setProvider] = useState("cloudflare");
  const [state, action, pending] = useActionState<LinkDomainActionState, FormData>(guardAction(checkLinkDomainAction.bind(null, projectId), (m) => ({ error: m })), {});
  const input = stepInput(domain);
  const current = PROVIDERS.find((p) => p.key === provider) ?? PROVIDERS[0];
  const message = CHECK_MESSAGE[domain.lastCheck];
  // また押せるまでの秒。最後に確認した時刻（サーバーの行）と、続けて押して断られたときの時刻の、遅いほうから数える
  const cooldown = useCooldown([domain.lastCheckedAt, state.cooldownUntil ? new Date(new Date(state.cooldownUntil).getTime() - LINK_DOMAIN_CHECK_INTERVAL_MS).toISOString() : null]);

  return (
    <div className="flex flex-col gap-5">
      {domain.verifiedAt && (
        <ErrorBanner>
          {domain.lastCheck === "error" ? (
            <>
              {domain.domain} の DNS の行を、何日か確認できませんでした。そのため、念のため yabumi のドメインに戻しました。下の行が入っているか確認して、「確認する」を押してください。また {domain.domain} で短縮リンクを作れます。
            </>
          ) : (
            <>
              {domain.domain} の DNS で、{domain.lastCheck === "owner_txt_missing" ? "あなたのドメインだと確認する TXT" : "yabumi につなぐ CNAME"}
              の行が見えなくなりました。そのため、yabumi のドメインに戻しました。下の行を、もう一度 DNS に追加して、「確認する」を押してください。また {domain.domain} で短縮リンクを作れます。
            </>
          )}
        </ErrorBanner>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold">
          ② <Term k="dns">DNS</Term> に次の行を追加
        </h3>
        <p className="text-sm leading-[1.8] text-muted">
          ドメインを買ったサービスの管理画面で、{domain.txtValue ? "3" : "2"} 行とも追加します。たとえば、お名前.com や Cloudflare です。どこで買ったかわからないときは、ホームページを作った人に聞いてください。1 行目の <Term k="cname">CNAME</Term> は、
          <b className="text-fg">{domain.domain}</b> を yabumi につなぐためです。2 行目の TXT は、あなたのドメインだと確認するためです。ほかの人が勝手に使えないようにします。
          {domain.txtValue && "このドメインでは、3 行目も追加します。yabumi が使っているサービスが、確認に使います。"}
        </p>
        <RecordTable domain={domain} />
        <p className="text-xs leading-[1.7] text-muted">
          {deadline(domain.pendingSince)} までに「確認する」でつながらないと、入れたドメインを削除します。削除したあとも、もう一度入れられます。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold">使っているサービスの手順</p>
        <div role="tablist" aria-label="DNS のサービス" className="flex flex-wrap gap-1.5">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={provider === p.key}
              onClick={() => setProvider(p.key)}
              className={`rounded-full border px-3 py-1 text-sm ${provider === p.key ? "border-primary bg-surface font-bold text-fg" : "border-border text-muted hover:bg-primary-soft"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <ol role="tabpanel" className="flex list-decimal flex-col gap-1.5 rounded-md border border-border px-4 py-3 pl-9 text-sm leading-[1.7]">
          {current.steps(input).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="text-xs leading-[1.7] text-muted">画面の名前は、サービスの側で変わることがあります。</p>
      </div>

      <form action={action} className="flex flex-col gap-3">
        <h3 className="text-[15px] font-bold">③ 追加したら、確認する</h3>
        {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
        {message && !state.error && (
          <p className={`rounded-md border px-4 py-3 text-sm leading-[1.7] ${message.tone === "fix" ? "border-danger text-fg" : "border-border text-fg"}`} role="status">
            <b className={message.tone === "fix" ? "text-danger" : "text-primary"}>{CHECK_HEAD[message.tone]}</b>
            {message.text}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || cooldown > 0}>
            {pending ? "確認しています…" : cooldown > 0 ? `確認する・あと ${cooldown} 秒` : "確認する"}
          </Button>
          {domain.lastCheckedAt && (
            <span className="text-xs text-muted">最後に確認した時刻: {new Date(domain.lastCheckedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
        <p className="text-xs leading-[1.7] text-muted">つながるまでは、今のまま {defaultHost} で短縮リンクを作ります。</p>
      </form>
    </div>
  );
}

// 取り消す日（pending になってから 7 日）
function deadline(pendingSince: string): string {
  return new Date(new Date(pendingSince).getTime() + 7 * 86_400_000).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}

function Connected({ domain, profileLinks }: { domain: LinkDomainView; profileLinks: { sns: string; url: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <SuccessBanner>
        つながりました。これから作る短縮リンクは <b>{domain.domain}</b> になります。プロフィール用も、投稿の本文用も同じです。前に作ったリンクも、前のドメインと {domain.domain}{" "}
        の両方で開けます。
      </SuccessBanner>
      {profileLinks.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-[1.7]">
            <b>プロフィールのリンクを貼り直してください。</b>前の URL のままでも開けます。新しい URL のほうが、どこへ行くリンクか伝わります。
          </p>
          <ul className="flex flex-col gap-1.5">
            {profileLinks.map((l) => (
              <li key={l.sns} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-border px-4 py-2.5 text-sm">
                <span className="w-24 shrink-0 font-bold">{l.sns}</span>
                <span className="min-w-0 break-all">{l.url.replace(/^https:\/\//, "")}</span>
                <CopyButton text={l.url} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">例: X のプロフィールの「ウェブサイト」を、上の X の URL に貼り直す。</p>
        </div>
      )}
    </div>
  );
}

function RemoveDomain({ projectId, domain, defaultHost }: { projectId: string; domain: LinkDomainView; defaultHost: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<LinkDomainActionState, FormData>(guardAction(removeLinkDomainAction.bind(null, projectId), (m) => ({ error: m })), {});
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {!confirming ? (
        <div>
          <button type="button" onClick={() => setConfirming(true)} className="text-sm text-muted hover:text-fg hover:underline">
            このドメインを使うのをやめる
          </button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-2 rounded-md border border-danger px-4 py-3 text-sm leading-[1.7]">
          <p>
            <b>{domain.domain}</b> を使うのをやめると、これからの短縮リンクは {defaultHost} で作ります。
            {domain.status === "active" && (
              <>
                <b className="text-danger"> {domain.domain} で始まる短縮リンクは開けなくなります。</b>プロフィールや投稿に貼ったものは、{defaultHost} の URL に貼り直してください。
              </>
            )}
            やめたあと、DNS に追加した行は削除してかまいません。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              {pending ? "やめています…" : "使うのをやめる"}
            </Button>
            <Button type="button" variant="text" size="sm" onClick={() => setConfirming(false)}>
              やめる
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// 「確認する」をまた押せるまでの秒を、1 秒ごとに数え直す（描くときに時刻を読まない。最初は 0 で描き、あとから数える）
function useCooldown(checkedAts: (string | null | undefined)[]): number {
  // DB の時刻（+00:00）と ISO（Z）が混ざるので、文字ではなく時刻で比べる
  const times = checkedAts.filter((t): t is string => !!t).map((t) => Date.parse(t)).filter((n) => !Number.isNaN(n));
  const latest = times.length ? new Date(Math.max(...times)).toISOString() : null;
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!latest) return;
    const tick = () => setLeft(checkCooldownSeconds(latest, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [latest]);
  return latest ? left : 0;
}

