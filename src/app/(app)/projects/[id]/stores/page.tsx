import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppStoreConnectForm, RevenueCatForm } from "@/components/stores/store-forms";
import { Card, CardHeader } from "@/components/ui/card";
import { Term } from "@/components/ui/term";
import { credentialsConfigured } from "@/lib/crypto/credential-cipher";
import { getProject } from "@/lib/projects/queries";
import { removeStoreCredential } from "@/lib/stores/actions";
import { credentialStatuses, type CredentialStatus, type Provider } from "@/lib/stores/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ストアと課金をつなぐ" };

function Status({ projectId, provider, s }: { projectId: string; provider: Provider; s?: CredentialStatus }) {
  if (!s) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-line px-5 py-3 text-sm max-sm:px-4">
      <p>
        {s.status === "ok" ? <span className="font-bold text-success">✓ つないでいます</span> : <span className="font-bold text-signal">● 要確認</span>}
        <span className="ml-2 text-muted">{s.hint}</span>
      </p>
      {s.status === "error" && s.lastError && <p className="text-danger">{s.lastError}</p>}
      <p className="text-xs text-muted">
        {s.lastImportedDay ? `${s.lastImportedDay} の分まで取り込みました。` : "まだ取り込んでいません。"}毎日 3 時ごろに自動で取り込みます。
      </p>
      <form action={removeStoreCredential.bind(null, projectId, provider)} className="mt-1">
        <button type="submit" className="text-xs text-muted hover:text-fg hover:underline">
          外す（預けた鍵を消す。取り込んだ数字は残ります）
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
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const statuses = credentialsConfigured() ? await credentialStatuses(createAdminClient(), claims!.claims!.sub, project.id) : {};
  const ready = credentialsConfigured();

  return (
    <div className="flex max-w-[860px] flex-col gap-6 max-sm:gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">ストアと課金をつなぐ（任意）</h1>
        <p className="text-base leading-[1.8] text-muted max-sm:text-[14px]">
          つなぐと、ダウンロードの数と売上を毎日取り込み、「
          <Link href={`/projects/${project.id}/metrics`} className="text-primary hover:underline">
            指標
          </Link>
          」の画面で投稿やクリックと並べて見られます（<Term k="conversion">コンバージョン</Term>）。どの投稿から来たかまではわからないので、同じ日の動きを見比べます。
        </p>
        <p className="text-xs leading-[1.7] text-muted">
          預ける鍵は読むためだけに使い、暗号化して保存します。アプリの情報を書き換えることはありません。いつでも外せて、退会すると消えます。
        </p>
      </div>

      {!ready && (
        <p className="rounded-md border border-border bg-surface2 px-4 py-3 text-sm">ストアと課金の取り込みは準備中です（運営者の設定がまだです）。</p>
      )}

      <Card>
        <CardHeader title="App Store（ダウンロードと売上）" />
        <Status projectId={project.id} provider="app_store_connect" s={statuses.app_store_connect} />
        <div className="flex flex-col gap-4 px-5 py-4 max-sm:px-4">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-[1.8]">
            <li>
              <a href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                App Store Connect
              </a>
              に、アカウント保持者（Account Holder）か管理（Admin）の役割でログインし、「ユーザとアクセス」→「統合」→「App Store Connect API」→「チームキー」を開く
            </li>
            <li>はじめてのときは「アクセスをリクエスト」を押す（アカウント保持者だけができます）</li>
            <li>
              「キーを生成」（＋）で、名前を「yabumi」、アクセスを<b>「Sales and Reports」</b>にして生成する（売上とダウンロードを読むだけの役割です。Admin は選ばないでください）
            </li>
            <li>上のほうにある「Issuer ID」と、作ったキーの「Key ID」を下に貼る</li>
            <li>「API キーをダウンロード」で .p8 ファイルを保存し、下で選ぶ（ダウンロードは 1 回しかできません。なくしたら、キーを取り消して作り直します）</li>
            <li>「支払いと財務報告」の画面の左上に出ている「ベンダー番号」（数字）を下に入れる</li>
          </ol>
          <p className="text-xs leading-[1.7] text-muted">
            画面の名前は、App Store Connect の表示の言語や更新で少し違うことがあります。Team キーはチームのすべてのアプリに届くので、矢書はこのプロジェクトの App Store の URL（id の数字）のアプリだけを数えます。
          </p>
          {ready && <AppStoreConnectForm projectId={project.id} />}
        </div>
      </Card>

      <Card>
        <CardHeader title="RevenueCat（課金。使っている場合）" />
        <Status projectId={project.id} provider="revenuecat" s={statuses.revenuecat} />
        <div className="flex flex-col gap-4 px-5 py-4 max-sm:px-4">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-[1.8]">
            <li>
              <a href="https://app.revenuecat.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                RevenueCat
              </a>
              にログインし、アプリのプロジェクトの「Project settings」→「API keys」を開く
            </li>
            <li>「+ New secret API key」で、名前を「yabumi」、Version を「V2」にする</li>
            <li>権限は<b>「Charts &amp; metrics」だけを「Read only」</b>にし、ほかは「No access」にして作る</li>
            <li>作ったキー（sk_ で始まる）と、プロジェクトの ID（Project settings の画面、または URL の /projects/ のあとの部分）を下に貼る</li>
          </ol>
          {ready && <RevenueCatForm projectId={project.id} />}
        </div>
      </Card>

      <p className="text-xs leading-[1.7] text-muted">Google Play の取り込みと、App Store のストアのページの閲覧数は、これから作ります（準備中）。</p>
    </div>
  );
}
