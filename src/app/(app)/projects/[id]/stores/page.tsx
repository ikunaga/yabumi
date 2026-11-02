import type { Metadata } from "next";
import Link from "next/link";
import { isAppProject, isProductType, PRODUCT_TYPE_DEFS } from "@/lib/projects/product-types";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/links/link-forms";
import { AppStoreConnectForm, AppStoreViewsForm, GooglePlayForm, RevenueCatForm, StartGooglePlayButton } from "@/components/stores/store-forms";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { Disclosure, HelpTip } from "@/components/ui/help";
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

type State = "ok" | "error" | "waiting" | "none";

function StateBadge({ state }: { state: State }) {
  if (state === "ok") return <Badge tone="success">✓ つないでいます</Badge>;
  if (state === "error") return <Badge tone="signal">● 要確認</Badge>;
  if (state === "waiting") return <Badge>招待と入力を待っています</Badge>;
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

// つないだあとの状態（取り込んだ日・エラー・外す）
function Connected({ s, remove, removeLabel }: { s: CredentialStatus; remove: () => Promise<void>; removeLabel: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-surface2 px-4 py-3 text-sm">
      <p>
        <span className="text-muted">{s.hint}</span>
        <span className="num ml-2 text-faint">{s.lastImportedDay ? `${s.lastImportedDay} の分まで取り込みました` : "まだ取り込んでいません"}</span>
      </p>
      {s.status === "error" && s.lastError && <p className="text-danger">{s.lastError}</p>}
      <form action={remove}>
        <button type="submit" className="text-xs text-muted hover:text-fg hover:underline">
          {removeLabel}
        </button>
      </form>
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
  const stateOf = (s?: CredentialStatus): State => (s ? s.status : "none");
  const playState: State = !play ? "none" : play.status === "ok" ? "ok" : play.status === "error" ? "error" : "waiting";

  const ascSteps = (
    <Steps>
      <li>
        <ExternalLink href="https://appstoreconnect.apple.com/access/integrations/api">App Store Connect</ExternalLink>
        に、アカウント保持者（Account Holder）か管理（Admin）の役割でログインし、「ユーザとアクセス」→「統合」→「App Store Connect API」→「チームキー」を開く
      </li>
      <li>はじめてのときは「アクセスをリクエスト」を押す（アカウント保持者だけができます）</li>
      <li>
        「キーを生成」（＋）で、名前を「yabumi」、アクセスを<b>「Sales and Reports」</b>にして生成する（売上とダウンロードを読むだけの役割です。Admin は選ばないでください）
      </li>
      <li>上のほうにある「Issuer ID」と、作ったキーの「Key ID」を下に貼る</li>
      <li>「API キーをダウンロード」で .p8 ファイルを保存し、下で選ぶ（ダウンロードは 1 回しかできません。なくしたら、キーを取り消して作り直します）</li>
      <li>「支払いと財務報告」の画面の左上に出ている「ベンダー番号」（数字）を下に入れる</li>
    </Steps>
  );
  const rcSteps = (
    <Steps>
      <li>
        <ExternalLink href="https://app.revenuecat.com">RevenueCat</ExternalLink>
        にログインし、アプリのプロジェクトの「Project settings」→「API keys」を開く
      </li>
      <li>「+ New secret API key」で、名前を「yabumi」、Version を「V2」にする</li>
      <li>
        権限は<b>「Charts &amp; metrics」だけを「Read only」</b>にし、ほかは「No access」にして作る
      </li>
      <li>作ったキー（sk_ で始まる）と、プロジェクトの ID（Project settings の画面、または URL の /projects/ のあとの部分）を下に貼る</li>
    </Steps>
  );

  return (
    <div className="flex flex-col gap-4 max-sm:gap-3">
      <PageHeader
        title="ストアと課金をつなぐ"
        help={
          <>
            <p>
              つなぐと、ダウンロードの数と売上を毎日取り込み、分析の画面で投稿やクリックと並べて見られます（<Term k="conversion">コンバージョン</Term>
              ）。どの投稿から来たかまではわからないので、同じ日の動きを見比べます。
            </p>
            <p className="mt-2">預ける鍵は読むためだけに使い、暗号化して保存します。アプリの情報を書き換えることはありません。いつでも外せて、退会すると消えます。</p>
          </>
        }
        sub="任意・毎日 3 時ごろに自動で取り込みます"
        actions={
          <ButtonLink href={`/projects/${project.id}/metrics`} variant="secondary" size="sm">
            分析を見る
          </ButtonLink>
        }
      />

      {!ready && <p className="rounded-lg border border-border bg-surface px-5 py-3 text-sm text-muted">ストアと課金の取り込みは準備中です。</p>}

      <StoreCard
        title="App Store"
        gets="ダウンロードと売上"
        state={stateOf(asc)}
        help={
          <HelpTip label="App Store のつなぎ方の注意">
            画面の名前は、App Store Connect の表示の言語や更新で少し違うことがあります。Team キーはチームのすべてのアプリに届くので、yabumi はこのプロジェクトの App Store の URL（id の数字）のアプリだけを数えます。
          </HelpTip>
        }
      >
        {asc ? (
          <>
            <Connected s={asc} remove={removeStoreCredential.bind(null, project.id, "app_store_connect")} removeLabel="外す（預けた鍵を消す。取り込んだ数字は残ります）" />
            {ready && (
              <Disclosure summary="鍵を入れ替える">
                <div className="flex flex-col gap-4 text-fg">
                  {ascSteps}
                  <AppStoreConnectForm projectId={project.id} />
                </div>
              </Disclosure>
            )}
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Term k="storeListing">ストアのページ</Term>の閲覧数（任意）
                {views && <StateBadge state={views.status === "ok" ? "ok" : "error"} />}
              </p>
              {views ? (
                <div className="flex flex-col gap-1 text-sm">
                  <p className="num text-faint">{views.last_imported_day ? `${views.last_imported_day} の回まで取り込みました` : "Apple がレポートを作り始めるまで 1〜2 日かかります"}</p>
                  {views.status === "error" && views.last_error && <p className="text-danger">{views.last_error}</p>}
                  <form action={removeAppStorePageViews.bind(null, project.id)}>
                    <button type="submit" className="text-xs text-muted hover:text-fg hover:underline">
                      やめる（取り込んだ数字は残ります）
                    </button>
                  </form>
                </div>
              ) : (
                <Disclosure summary="依頼のしかた（Admin のキーを 1 回だけ使います）">
                  <div className="flex flex-col gap-4">
                    <p>
                      ストアのページを見た人の数は、Apple に「レポートの依頼」を一度だけ出すと、毎日読めるようになります。依頼を出せるのは役割が<b>「Admin」</b>のキーだけなので、上とは別に Admin のキーを作り、下に入れてください。yabumi は Admin のキーを依頼を出す 1 回だけ使い、<b>保存しません</b>（依頼のあとは、App Store Connect でそのキーを取り消してかまいません）。
                    </p>
                    <AppStoreViewsForm projectId={project.id} />
                  </div>
                </Disclosure>
              )}
            </div>
          </>
        ) : (
          ready && (
            <>
              {ascSteps}
              <AppStoreConnectForm projectId={project.id} />
            </>
          )
        )}
      </StoreCard>

      <StoreCard title="Google Play" gets="インストールとストアのページの閲覧" state={playState}>
        {play && (
          <div className="flex flex-col gap-1 rounded-md bg-surface2 px-4 py-3 text-sm">
            {play.package_name && <p className="text-muted">{play.package_name}</p>}
            {play.status === "error" && play.last_error && <p className="text-danger">{play.last_error}</p>}
            <form action={removeGooglePlay.bind(null, project.id)}>
              <button type="submit" className="text-xs text-muted hover:text-fg hover:underline">
                外す（読み取り用のアカウントを消す。取り込んだ数字は残ります）
              </button>
            </form>
          </div>
        )}
        {!playReady ? (
          <p className="text-sm text-muted">Google Play の取り込みは準備中です。</p>
        ) : !play ? (
          <>
            <p className="text-sm leading-[1.8]">
             yabumi が、このプロジェクト専用の<b>読み取り用のアカウント</b>（メールアドレスの形）を用意します。それを Play Console に招待すると、毎日のインストールとストアのページの閲覧の数を読めるようになります。鍵を預ける必要はありません。
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
                の「ユーザーと権限」→「新しいユーザーを招待」を開く
              </li>
              <li>上のメールアドレスを貼る</li>
              <li>
                「アカウントの権限」で<b>「アプリ情報の表示と一括レポートのダウンロード（読み取り専用）」だけ</b>に印を付ける（ほかは付けない）→「ユーザーを招待」
              </li>
              <li>「レポートをダウンロード」→「統計情報」を開き、「Cloud Storage の URI をコピー」で出る値（gs://pubsite_prod_rev_…）を下に貼る</li>
              <li>アプリのパッケージ名を確かめて「確かめて保存する」（招待が反映されるまで数分かかることがあります）</li>
            </Steps>
            <GooglePlayForm projectId={project.id} defaultPackage={play.package_name ?? packageFromUrl(project.play_store_url) ?? ""} defaultBucket={play.bucket ?? ""} />
          </PlaySetup>
        )}
      </StoreCard>

      <StoreCard title="RevenueCat" gets="課金（使っている場合）" state={stateOf(rc)}>
        {rc ? (
          <>
            <Connected s={rc} remove={removeStoreCredential.bind(null, project.id, "revenuecat")} removeLabel="外す（預けた鍵を消す。取り込んだ数字は残ります）" />
            {ready && (
              <Disclosure summary="鍵を入れ替える">
                <div className="flex flex-col gap-4 text-fg">
                  {rcSteps}
                  <RevenueCatForm projectId={project.id} />
                </div>
              </Disclosure>
            )}
          </>
        ) : (
          ready && (
            <>
              {rcSteps}
              <RevenueCatForm projectId={project.id} />
            </>
          )
        )}
      </StoreCard>
    </div>
  );
}

// Google Play の招待と入力: まだ済んでいなければそのまま出し、済んだら開く欄に畳む
function PlaySetup({ open, children }: { open: boolean; children: ReactNode }) {
  if (open) return <div className="flex flex-col gap-4">{children}</div>;
  return (
    <Disclosure summary="招待と置き場所を確かめ直す">
      <div className="flex flex-col gap-4 text-fg">{children}</div>
    </Disclosure>
  );
}
