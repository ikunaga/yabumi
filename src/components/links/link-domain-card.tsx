"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { addLinkDomainAction, checkLinkDomainAction, removeLinkDomainAction, type LinkDomainActionState } from "@/lib/links/actions";
import { apexOf, dnsRecordName } from "@/lib/links/domain-rules";
import { CopyButton } from "./link-forms";

// 短縮リンクを自分のドメインで作る（F07、決定 D28。docs/architecture.md の 4.22）。
// ① ドメインを入れる ② DNS に 1 行足す ③ 確かめる、の 3 段を見せ、今どこかを示す。ドメインを持っていない人には無理に勧めない

export type LinkDomainView = {
  domain: string;
  status: "pending" | "active";
  cnameTarget: string;
  txtName: string;
  txtValue: string;
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

const CHECK_MESSAGE: Record<string, { tone: "wait" | "fix" | "ok"; text: string }> = {
  dns_missing: { tone: "wait", text: "まだ DNS が届いていません。足してから届くまで、数分〜数時間かかることがあります。少しおいてから、もう一度「確かめる」を押してください。" },
  wrong_value: {
    tone: "fix",
    text: "DNS の値が違います。下の表の「種類」「名前」「値」と同じになっているか確かめてください。同じ名前の古い行（A や CNAME）があれば消してください。",
  },
  proxied: { tone: "fix", text: "Cloudflare の Proxy がオン（オレンジの雲）になっています。その行の雲を押して、灰色（DNS only）にしてから保存してください。" },
  txt_missing: { tone: "fix", text: "持ち主の確認の行（TXT）がまだ見えません。下の表の 2 行目（TXT）も足してください。" },
  cert_pending: {
    tone: "wait",
    text: "DNS は届きました。いま、安全につなぐための証明書（https）を用意しています（数分〜1 時間ほど）。少しおいてから、もう一度「確かめる」を押してください。",
  },
  error: { tone: "fix", text: "いま確かめられませんでした。時間をおいてもう一度お試しください。" },
};

export function LinkDomainCard({ projectId, ready, domain, defaultHost, profileLinks }: Props) {
  const step = !domain ? 1 : domain.status === "active" ? 4 : 2;
  const [open, setOpen] = useState(Boolean(domain));

  return (
    <section aria-labelledby="link-domain-heading" className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-x-3 gap-y-3 px-5 py-4 max-sm:flex-col max-sm:items-start max-sm:px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="link-domain-heading" className="text-base font-bold">
            自分のドメインで作る<span className="ml-1.5 text-sm font-normal text-muted">（任意）</span>
          </h2>
          <p className="text-sm leading-[1.7] text-muted">
            {domain?.status === "active" ? (
              <>
                短縮リンクを <b className="text-fg">{domain.domain}</b> で作っています。
              </>
            ) : (
              <>
                今の短縮リンクは <b className="text-fg">{defaultHost}/…</b> です。自分のドメイン（例: go.<i>あなたのドメイン</i>
                ）にすると、押す人に「どこへ行くリンクか」が伝わりやすくなります。ドメインがなくても、今のままで数えられます。
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
            <NotReadyButton variant="secondary" size="sm">
              設定する
            </NotReadyButton>
          ))}
      </div>

      {ready && (open || domain) && (
        <div id="link-domain-body" className="flex flex-col gap-5 border-t border-line px-5 py-5 max-sm:px-4">
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
  const items = ["ドメインを入れる", "DNS に 1 行足す", "確かめる"];
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
  const [state, action, pending] = useActionState<LinkDomainActionState, FormData>(addLinkDomainAction.bind(null, projectId), {});
  const [value, setValue] = useState("");
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm leading-[1.8]">
        持っているドメインに、短縮リンク用の<Term k="subdomain">サブドメイン</Term>を 1 つ作ります。おすすめは <b>go.</b>
        <i>あなたのドメイン</i>（例: go.example.com）です。今のホームページやメールには影響しません。追加の料金もかかりません。
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
      <Field label="使うドメイン" htmlFor="link-domain" hint="ドメインだけを入れます（https:// は要りません）。1 人 1 つまで、ほかの人が使っているものは使えません。">
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
          {pending ? "受け付けています…" : "次へ（DNS の設定を出す）"}
        </Button>
      </div>
    </form>
  );
}

type DnsRecord = { type: string; name: string; value: string };

function records(domain: LinkDomainView): DnsRecord[] {
  const apex = apexOf(domain.domain);
  const list = [{ type: "CNAME", name: dnsRecordName(domain.domain, apex), value: domain.cnameTarget }];
  if (domain.txtValue) list.push({ type: "TXT", name: dnsRecordName(domain.txtName || `_vercel.${apex}`, apex), value: domain.txtValue });
  return list;
}

function RecordTable({ domain }: { domain: LinkDomainView }) {
  const rows = records(domain);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <dl key={r.type} className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface2 px-4 py-3 text-sm">
          {rows.length > 1 && <p className="col-span-2 text-xs font-bold text-muted">{i + 1} 行目</p>}
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
        「名前」の欄に <code>{domain.domain}</code> まですべて入れる形のサービスもあります。そのときは <code>{domain.domain}</code> と入れてください。TTL（反映の間隔）は、選べるなら「自動」か短いものにします。
      </p>
    </div>
  );
}

// よく使う DNS のサービスごとの手順（画面の名前は、サービスの側で変わることがある。2026-10 時点）
const PROVIDERS: { key: string; label: string; steps: (r: { name: string; value: string; fqdn: string }) => ReactNode[] }[] = [
  {
    key: "cloudflare",
    label: "Cloudflare",
    steps: (r) => [
      <>Cloudflare にログインし、ドメインを選んで、左の「DNS」→「Records」を開く</>,
      <>「Add record」を押す</>,
      <>
        Type は <b>CNAME</b>、Name に <b>{r.name}</b>、Target に <b className="break-all">{r.value}</b> を入れる
      </>,
      <>
        <b className="text-danger">Proxy status を押して、灰色の雲（DNS only）にする。</b>オレンジの雲（Proxied）のままだと、つながりません
      </>,
      <>「Save」を押す</>,
    ],
  },
  {
    key: "onamae",
    label: "お名前.com",
    steps: (r) => [
      <>お名前.com Navi にログインし、「ネームサーバーの設定」→「DNS 設定/転送設定」を開く</>,
      <>ドメインを選んで「次へ」、「DNS レコード設定を利用する」の「設定する」を押す</>,
      <>
        ホスト名に <b>{r.name}</b>、TYPE は <b>CNAME</b>、VALUE に <b className="break-all">{r.value}</b> を入れて「追加」を押す
      </>,
      <>下の「確認画面へ進む」→「設定する」を押す（お名前.com のネームサーバーを使っているときだけ効きます）</>,
    ],
  },
  {
    key: "muumuu",
    label: "ムームードメイン",
    steps: (r) => [
      <>コントロールパネルにログインし、「ドメイン管理」→「ムームー DNS」を開く</>,
      <>ドメインの「変更」を押し、「カスタム設定」を開く</>,
      <>
        サブドメインに <b>{r.name}</b>、種別は <b>CNAME</b>、内容に <b className="break-all">{r.value}</b> を入れる
      </>,
      <>「セットアップ情報変更」を押す</>,
    ],
  },
  {
    key: "squarespace",
    label: "Squarespace（旧 Google Domains）",
    steps: (r) => [
      <>Squarespace にログインし、「Domains」→ ドメインを選んで「DNS」→「DNS Settings」を開く</>,
      <>「Custom records」の「Add record」を押す</>,
      <>
        Host に <b>{r.name}</b>、Type は <b>CNAME</b>、Data に <b className="break-all">{r.value}</b> を入れる
      </>,
      <>「Save」を押す</>,
    ],
  },
  {
    key: "xserver",
    label: "Xserver",
    steps: (r) => [
      <>サーバーパネル（または Xserver アカウントのドメインの管理）にログインし、「DNS レコード設定」を開く</>,
      <>ドメインを選び、「DNS レコード追加」のタブを開く</>,
      <>
        ホスト名に <b>{r.name}</b>、種別は <b>CNAME</b>、内容に <b className="break-all">{r.value}</b> を入れる
      </>,
      <>「確認画面へ進む」→「追加する」を押す</>,
    ],
  },
  {
    key: "other",
    label: "そのほか",
    steps: (r) => [
      <>ドメインを買ったサービス（または DNS を預けているサービス）の管理画面で、「DNS」「DNS レコード」「ゾーン」などの画面を開く</>,
      <>
        種類（タイプ）は <b>CNAME</b>、名前（ホスト）に <b>{r.name}</b>（または <b>{r.fqdn}</b>）、値（向け先・内容・Target）に <b className="break-all">{r.value}</b> を入れて足す
      </>,
      <>どこで設定するかわからないときは、そのサービスのヘルプで「CNAME 設定」と探すと見つかります</>,
    ],
  },
];

function DnsStep({ projectId, domain, defaultHost }: { projectId: string; domain: LinkDomainView; defaultHost: string }) {
  const [provider, setProvider] = useState("cloudflare");
  const [state, action, pending] = useActionState<LinkDomainActionState, FormData>(checkLinkDomainAction.bind(null, projectId), {});
  const cname = records(domain)[0];
  const current = PROVIDERS.find((p) => p.key === provider) ?? PROVIDERS[0];
  const message = CHECK_MESSAGE[domain.lastCheck];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold">
          ② <Term k="dns">DNS</Term> に次の行を足す
        </h3>
        <p className="text-sm leading-[1.8] text-muted">
          <b className="text-fg">{domain.domain}</b> を矢書につなぐための<Term k="cname">CNAME</Term>
          の行です。ドメインを買ったサービス（お名前.com や Cloudflare など）の管理画面で足します。
          {domain.txtValue && "このドメインでは、持ち主の確認のための TXT の行も要ります（2 行とも足してください）。"}
        </p>
        <RecordTable domain={domain} />
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
              className={`rounded-full border px-3 py-1 text-sm ${provider === p.key ? "border-primary bg-primary font-bold text-on-primary" : "border-border text-fg hover:bg-primary-soft"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <ol role="tabpanel" className="flex list-decimal flex-col gap-1.5 rounded-md border border-border px-4 py-3 pl-9 text-sm leading-[1.7]">
          {current.steps({ name: cname.name, value: cname.value, fqdn: domain.domain }).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {domain.txtValue && <p className="text-xs leading-[1.7] text-muted">TXT の行も、同じ画面で種類を TXT にして足します（名前と値は上の表の 2 行目）。</p>}
        <p className="text-xs leading-[1.7] text-muted">画面の名前は、サービスの側で変わることがあります。</p>
      </div>

      <form action={action} className="flex flex-col gap-3">
        <h3 className="text-[15px] font-bold">③ 足したら、確かめる</h3>
        {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
        {message && !state.error && (
          <p className={`rounded-md border px-4 py-3 text-sm leading-[1.7] ${message.tone === "fix" ? "border-danger text-fg" : "border-border text-fg"}`} role="status">
            <b className={message.tone === "fix" ? "text-danger" : "text-primary"}>{message.tone === "fix" ? "直してください: " : "待っています: "}</b>
            {message.text}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "確かめています…" : "確かめる"}
          </Button>
          {domain.lastCheckedAt && (
            <span className="text-xs text-muted">最後に確かめた時刻: {new Date(domain.lastCheckedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
        <p className="text-xs leading-[1.7] text-muted">つながるまでは、今のまま {defaultHost} で短縮リンクを作ります。</p>
      </form>
    </div>
  );
}

function Connected({ domain, profileLinks }: { domain: LinkDomainView; profileLinks: { sns: string; url: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <SuccessBanner>
        つながりました。これから作る短縮リンク（プロフィール用・投稿の本文用とも）は <b>{domain.domain}</b> になります。前に作ったリンクも、前のドメインと {domain.domain}{" "}
        の両方で開けます。
      </SuccessBanner>
      {profileLinks.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-[1.7]">
            <b>プロフィールのリンクを貼り直してください。</b>前の URL のままでも開けますが、新しい URL のほうが、押す人に行き先が伝わりやすくなります。
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
  const [state, action, pending] = useActionState<LinkDomainActionState, FormData>(removeLinkDomainAction.bind(null, projectId), {});
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {!confirming ? (
        <div>
          <button type="button" onClick={() => setConfirming(true)} className="text-sm text-muted hover:text-fg hover:underline">
            {domain.status === "active" ? "このドメインを外す" : "やめる（このドメインを使わない）"}
          </button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-2 rounded-md border border-danger px-4 py-3 text-sm leading-[1.7]">
          <p>
            <b>{domain.domain}</b> を外すと、これからの短縮リンクは {defaultHost} で作ります。
            {domain.status === "active" && (
              <>
                <b className="text-danger"> {domain.domain} で始まる短縮リンクは開けなくなります。</b>プロフィールや投稿に貼ったものは、{defaultHost} の URL に貼り直してください。
              </>
            )}
            外したあと、DNS に足した行は消してかまいません。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              {pending ? "外しています…" : "外す"}
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
