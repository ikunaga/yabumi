import type { Metadata } from "next";
import Link from "next/link";
import { isAppProject, isProductType, PRODUCT_TYPE_DEFS } from "@/lib/projects/product-types";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/links/link-forms";
import { AppStoreConnectForm, AppStoreViewsForm, GooglePlayForm, RevenueCatForm, StartGooglePlayButton } from "@/components/stores/store-forms";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";
import { DisclosureBox } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { Term } from "@/components/ui/term";
import { credentialsConfigured } from "@/lib/crypto/credential-cipher";
import { getProject } from "@/lib/projects/queries";
import { removeAppStorePageViews, removeGooglePlay, removeStoreCredential } from "@/lib/stores/actions";
import { googlePlayConfigured, packageFromUrl } from "@/lib/stores/google";
import { credentialStatuses, type CredentialStatus, type Provider } from "@/lib/stores/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ストアと課金をつなぐ" };

// unavailable: yabumi の運営の準備（鍵）ができていない。利用者には何もできないので、つなぐ操作は出さない（2026-11-21 PM の指示）
type State = "ok" | "error" | "waiting" | "none" | "unavailable";

function StateBadge({ state }: { state: State }) {
  if (state === "ok") return <Badge tone="success">✓ つないでいます</Badge>;
  if (state === "error") return <Badge tone="signal">● 要確認</Badge>;
  if (state === "waiting") return <Badge>招待と入力を待っています</Badge>;
  if (state === "unavailable") return <Badge>まだ使えません</Badge>;
  return <Badge>まだつないでいません</Badge>;
}

// つなぐ先 1 つの箱: 名前・何が取れるか・状態の札。つないだあとは状態と「外す」、手順は開く欄に畳む
function StoreCard({ title, gets, state, help, children }: { title: string; gets: string; state: State; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface px-5 py-4 max-sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-[16px] font-bold">{title}</h2>
        {help}
        <span className="text-sm text-faint">{gets}</span>
        <span className="ml-auto">
          <StateBadge state={state} />
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function NotYet() {
  return <p className="text-sm text-muted">いまは、することはありません。yabumi の運営の準備ができたら、ここでつなぐことができます。</p>;
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-[1.8]">{children}</ol>;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-fg underline">
      {children}
    </a>
  );
}

// 外す・やめるのボタンと、押すとどうなるかの 1 行（かっこ書きにしない。2026-11-21）
function RemoveForm({ action, label, note }: { action: () => Promise<void>; label: string; note: string }) {
  return (
    <form action={action} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <button type="submit" className="text-xs text-muted hover:text-fg hover:underline">
        {label}
      </button>
      <span className="text-xs text-faint">{note}</span>
    </form>
  );
}

// つないだあとの状態（取り込んだ日・エラー・外す）
function Connected({ s, remove }: { s: CredentialStatus; remove: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-surface2 px-4 py-3 text-sm">
      <p>
        <span className="text-muted">{s.hint}</span>
        <span className="num ml-2 text-faint">{s.lastImportedDay ? `${s.lastImportedDay} の分まで取り込みました` : "まだ取り込んでいません"}</span>
      </p>
      {s.status === "error" && s.lastError && <p className="text-danger">{s.lastError}</p>}
      <RemoveForm action={remove} label="外す" note="保存したキーを消します。取り込んだ数字は残ります。" />
    </div>
  );
}

// ストアと課金をつなぐ（F07 の段取り ③。docs/architecture.md の 4.22）。鍵の中身は二度と画面に出さない
export default async function StoresPage(props: PageProps<"/projects/[id]/stores">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  // ストアと課金の取り込みは、宣伝するものがアプリのときだけ（決定 D34）
  if (!isAppProject(project)) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="ストアと課金をつなぐ" />
        <p className="rounded-lg border border-border bg-surface px-5 py-4 text-sm leading-[1.8] text-muted">
          App Store・Google Play・RevenueCat の数字の取り込みは、宣伝するものが「アプリ」のときに使えます。いまの種類は「{isProductType(project.product_type) ? PRODUCT_TYPE_DEFS[project.product_type].label : "そのほか"}」です。
          <Link href={`/projects/${project.id}/edit`} className="ml-1 font-bold text-fg underline">
            プロジェクトの設定で変える
          </Link>
        </p>
      </div>
    );
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const ownerId = claims!.claims!.sub;
  const admin = createAdminClient();
  const ready = credentialsConfigured();
  const statuses: Partial<Record<Provider, CredentialStatus>> = ready ? await credentialStatuses(admin, ownerId, project.id) : {};
  const playReady = googlePlayConfigured();
  const [{ data: play }, { data: views }] = await Promise.all([
    admin.from("play_connections").select("service_account_email, bucket, package_name, status, last_error, last_checked_at").eq("project_id", project.id).eq("owner_id", ownerId).maybeSingle(),
    admin.from("app_store_report_requests").select("status, last_error, last_imported_day").eq("project_id", project.id).eq("owner_id", ownerId).maybeSingle(),
  ]);
  const asc = statuses.app_store_connect;
  const rc = statuses.revenuecat;
  const stateOf = (s?: CredentialStatus): State => (s ? s.status : ready ? "none" : "unavailable");
  const playState: State = !play ? (playReady ? "none" : "unavailable") : play.status === "ok" ? "ok" : play.status === "error" ? "error" : "waiting";

  const ascSteps = (
    <Steps>
      <li>
        <ExternalLink href="https://appstoreconnect.apple.com/access/integrations/api">App Store Connect</ExternalLink>
        にログインします。開発者として登録した本人なら、そのまま進めます。
      </li>
      <li>「ユーザとアクセス」→「統合」を開きます。</li>
      <li>「App Store Connect API」→「チームキー」を開きます。</li>
      <li>「アクセスをリクエスト」が出ていたら、押します。押せるのは、アカウント保持者だけです。</li>
      <li>
        「キーを生成」の＋を押します。名前は「yabumi」にします。アクセスは<b>「Sales and Reports」</b>にして、生成します。キーのアクセスに、Admin は選ばないでください。売上とダウンロードを読むだけなら、これで足ります。
      </li>
      <li>チームキーの画面の上にある「Issuer ID」を、下の欄に貼ります。</li>
      <li>作ったキーの行にある「Key ID」も、下の欄に貼ります。</li>
      <li>「API キーをダウンロード」で .p8 ファイルを保存し、下の欄で選びます。ダウンロードは 1 回しかできません。なくしたら、キーを取り消して作り直します。</li>
      <li>App Store Connect のホームに戻り、「支払いと財務報告」を開きます。</li>
      <li>左上にある数字の「ベンダー番号」を、下の欄に入れます。</li>
    </Steps>
  );
  const rcSteps = (
    <Steps>
      <li>
        <ExternalLink href="https://app.revenuecat.com">RevenueCat</ExternalLink>
        にログインします。
      </li>
      <li>アプリの「Project settings」を開きます。</li>
      <li>その中の「API keys」を開きます。</li>
      <li>「+ New secret API key」を押します。名前は「yabumi」、Version は「V2」にします。</li>
      <li>
        権限は<b>「Charts &amp; metrics」だけ</b>を選びます。それを「Read only」にします。ほかは「No access」にして作ります。
      </li>
      <li>作ったキーを、下の欄に貼ります。sk_ で始まる値です。</li>
      <li>「Project settings」の画面にある ID も、下の欄に貼ります。ブラウザの URL の /projects/ のあとと同じ文字です。</li>
    </Steps>
  );

  return (
    <div className="flex flex-col gap-4 max-sm:gap-3">
      <PageHeader
        title="ストアと課金をつなぐ"
        help={
          <>
            <p>
              つなぐと、ダウンロードの数と売上を毎日取り込みます。「分析」の画面で、投稿やクリックと並べて見られます。投稿を見た人がダウンロードや購入をすることを、
              <Term k="conversion">コンバージョン</Term>と呼びます。どの投稿から来たかまではわからないので、同じ日の動きを見比べます。
            </p>
            <p className="mt-2">保存したキーは読むためだけに使い、暗号化しておきます。アプリの情報を書き換えることはありません。いつでも外せて、退会すると消えます。</p>
          </>
        }
        sub="つながなくても使えます。つなぐと、毎日午前 3 時ごろに数字が入ります。"
        actions={
          <ButtonLink href={`/projects/${project.id}/metrics`} variant="secondary" size="sm">
            分析を見る
          </ButtonLink>
        }
      />

      <StoreCard
        title="App Store"
        gets="ダウンロードと売上"
        state={stateOf(asc)}
        help={
          <HelpTip label="App Store のつなぎ方の注意">
            画面の名前は、表示の言語や更新で少し違うことがあります。チームキーでは、チームのすべてのアプリの数字が読めます。取り込むのは、ここで宣伝しているアプリの数字だけです。
          </HelpTip>
        }
      >
        {asc ? (
          <>
            <Connected s={asc} remove={removeStoreCredential.bind(null, project.id, "app_store_connect")} />
            {ready && (
              <DisclosureBox label="App Store Connect のキーを入れ替える欄を表示" bodyClassName="mt-2 text-[14px] leading-[1.75] text-muted">
                <div className="flex flex-col gap-4 text-fg">
                  {ascSteps}
                  <AppStoreConnectForm projectId={project.id} />
                </div>
              </DisclosureBox>
            )}
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Term k="storeListing">ストアのページ</Term>を見た人の数
                {views && <StateBadge state={views.status === "ok" ? "ok" : "error"} />}
              </p>
              {views ? (
                <div className="flex flex-col gap-1 text-sm">
                  <p className="num text-faint">{views.last_imported_day ? `${views.last_imported_day} の分まで取り込みました` : "Apple がレポートを作り始めるまで 1〜2 日かかります"}</p>
                  {views.status === "error" && views.last_error && <p className="text-danger">{views.last_error}</p>}
                  <RemoveForm action={removeAppStorePageViews.bind(null, project.id)} label="やめる" note="取り込んだ数字は残ります。" />
                </div>
              ) : (
                <DisclosureBox label="ストアのページを見た人の数を取り込む手順を表示" bodyClassName="mt-2 text-[14px] leading-[1.75] text-muted">
                  <div className="flex flex-col gap-4">
                    <p>
                      ここをつながなくても、ほかの数字は取り込めます。下のボタンを押すと、Apple にレポートを 1 回だけ頼みます。そのあとは、見た人の数が毎日入ります。頼むには、アクセスが<b>「Admin」</b>のキーが要ります。上の手順と同じやり方で、アクセスだけ「Admin」にして作ります。このキーは 1 回だけ使い、<b>保存しません</b>。頼んだあとは、このキーを取り消してかまいません。
                    </p>
                    <AppStoreViewsForm projectId={project.id} />
                  </div>
                </DisclosureBox>
              )}
            </div>
          </>
        ) : ready ? (
          <>
            {ascSteps}
            <AppStoreConnectForm projectId={project.id} />
          </>
        ) : (
          <NotYet />
        )}
      </StoreCard>

      <StoreCard title="Google Play" gets="インストールの数と、ストアのページを見た人の数" state={playState}>
        {play && (
          <div className="flex flex-col gap-1 rounded-md bg-surface2 px-4 py-3 text-sm">
            {play.package_name && <p className="text-muted">{play.package_name}</p>}
            {play.status === "error" && play.last_error && <p className="text-danger">{play.last_error}</p>}
            <RemoveForm action={removeGooglePlay.bind(null, project.id)} label="外す" note="読み取り用のアカウントを消します。取り込んだ数字は残ります。" />
          </div>
        )}
        {!playReady ? (
          !play && <NotYet />
        ) : !play ? (
          <>
            <p className="text-sm leading-[1.8]">
             yabumi が、このプロジェクト専用の<b>読み取り用のアカウント</b>を用意します。アカウントは、メールアドレスの形をしています。それを Play Console に招待してください。毎日のインストールの数と、ストアのページを見た人の数を読めるようになります。キーを保存する必要はありません。
            </p>
            <StartGooglePlayButton projectId={project.id} />
          </>
        ) : (
          <PlaySetup open={play.status !== "ok"}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface2 px-3 py-2 text-sm">
              <span className="font-mono break-all">{play.service_account_email}</span>
              <CopyButton text={play.service_account_email} />
            </div>
            <Steps>
              <li>
                <ExternalLink href="https://play.google.com/console/developers/users-and-permissions">Play Console</ExternalLink>
                の「ユーザーと権限」→「新しいユーザーを招待」を開きます。
              </li>
              <li>yabumi の画面の、上のメールアドレスをコピーします。</li>
              <li>Play Console の「メールアドレス」の欄に貼ります。</li>
              <li>
                「アカウントの権限」で、次の 1 つだけに印を付けます。<b>「アプリ情報の表示と一括レポートのダウンロード」</b>。読むだけの権限です。ほかは付けません。
              </li>
              <li>「ユーザーを招待」を押します。</li>
              <li>「レポートをダウンロード」→「統計情報」を開きます。</li>
              <li>「Cloud Storage の URI をコピー」を押します。それを、下の「一括レポートの置き場所」に貼ります。</li>
              <li>アプリのパッケージ名を確認して、「確認して保存する」を押します。招待が反映されるまで、数分かかることがあります。</li>
            </Steps>
            <GooglePlayForm projectId={project.id} defaultPackage={play.package_name ?? packageFromUrl(project.play_store_url) ?? ""} defaultBucket={play.bucket ?? ""} />
          </PlaySetup>
        )}
      </StoreCard>

      <StoreCard title="RevenueCat" gets="アプリ内課金の売上。RevenueCat を使う人向け" state={stateOf(rc)}>
        {rc ? (
          <>
            <Connected s={rc} remove={removeStoreCredential.bind(null, project.id, "revenuecat")} />
            {ready && (
              <DisclosureBox label="RevenueCat のキーを入れ替える欄を表示" bodyClassName="mt-2 text-[14px] leading-[1.75] text-muted">
                <div className="flex flex-col gap-4 text-fg">
                  {rcSteps}
                  <RevenueCatForm projectId={project.id} />
                </div>
              </DisclosureBox>
            )}
          </>
        ) : ready ? (
          <>
            {rcSteps}
            <RevenueCatForm projectId={project.id} />
          </>
        ) : (
          <NotYet />
        )}
      </StoreCard>
    </div>
  );
}

// Google Play の招待と入力: まだ済んでいなければそのまま出し、済んだら開く欄に畳む
function PlaySetup({ open, children }: { open: boolean; children: ReactNode }) {
  if (open) return <div className="flex flex-col gap-4">{children}</div>;
  return (
    <DisclosureBox label="Google Play の数字を取り込む手順を表示" bodyClassName="mt-2 text-[14px] leading-[1.75] text-muted">
      <div className="flex flex-col gap-4 text-fg">{children}</div>
    </DisclosureBox>
  );
}
