"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { saveAppStoreConnect, saveGooglePlay, saveRevenueCat, startAppStorePageViews, startGooglePlay, type StoreFormState } from "@/lib/stores/actions";

// 鍵を入れる欄（docs/architecture.md の 4.22）。保存を押すと、1 回呼んで使えるかを確かめてから保存する

export function AppStoreConnectForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<StoreFormState, FormData>(saveAppStoreConnect.bind(null, projectId), {});
  const [privateKey, setPrivateKey] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {state.ok && <SuccessBanner>{state.ok}</SuccessBanner>}
      <Field label="Issuer ID" htmlFor="issuerId" hint="キーの一覧の上にある、英数字とハイフンの長い ID">
        <Input id="issuerId" name="issuerId" autoComplete="off" spellCheck={false} placeholder="57246542-96fe-1a63-e053-0824d011072a" />
      </Field>
      <Field label="Key ID" htmlFor="keyId" hint="作ったキーの行にある、英大文字と数字の ID">
        <Input id="keyId" name="keyId" autoComplete="off" spellCheck={false} placeholder="2X9R4HXF34" />
      </Field>
      <Field label="秘密鍵（.p8 ファイル）" htmlFor="privateKey" hint="ダウンロードした .p8 ファイルを選ぶか、中身をそのまま貼ります。矢書は暗号化して保存し、二度と画面に出しません">
        <input
          type="file"
          accept=".p8,text/plain"
          aria-label=".p8 ファイルを選ぶ"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file && file.size < 10_000) setPrivateKey(await file.text());
          }}
          className="text-sm"
        />
        <Textarea
          id="privateKey"
          name="privateKey"
          rows={4}
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          spellCheck={false}
          placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
          className="font-mono text-xs"
        />
      </Field>
      <Field label="ベンダー番号" htmlFor="vendorNumber" hint="数字だけ（例: 85123456）">
        <Input id="vendorNumber" name="vendorNumber" inputMode="numeric" autoComplete="off" className="max-w-[240px]" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "確かめています…" : "確かめて保存する"}
        </Button>
      </div>
    </form>
  );
}

export function RevenueCatForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<StoreFormState, FormData>(saveRevenueCat.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {state.ok && <SuccessBanner>{state.ok}</SuccessBanner>}
      <Field label="プロジェクトの ID" htmlFor="rcProjectId" hint="RevenueCat の Project settings にある ID（URL の /projects/ のあとの部分）">
        <Input id="rcProjectId" name="rcProjectId" autoComplete="off" spellCheck={false} placeholder="proj1ab2c3d4" className="max-w-[320px]" />
      </Field>
      <Field label="シークレットキー（v2）" htmlFor="secretKey" hint="sk_ で始まる値。矢書は暗号化して保存し、二度と画面に出しません">
        <Input id="secretKey" name="secretKey" type="password" autoComplete="off" spellCheck={false} placeholder="sk_…" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "確かめています…" : "確かめて保存する"}
        </Button>
      </div>
    </form>
  );
}

// ===== Google Play（段取り ⑤） =====

export function StartGooglePlayButton({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<StoreFormState, FormData>(async () => startGooglePlay(projectId), {});
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "用意しています…" : "Google Play をつなぐ（読み取り用のアカウントを用意する）"}
        </Button>
      </div>
    </form>
  );
}

export function GooglePlayForm({ projectId, defaultPackage, defaultBucket }: { projectId: string; defaultPackage: string; defaultBucket: string }) {
  const [state, action, pending] = useActionState<StoreFormState, FormData>(saveGooglePlay.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {state.ok && <SuccessBanner>{state.ok}</SuccessBanner>}
      <Field label="一括レポートの置き場所" htmlFor="bucket" hint="Play Console の「レポートをダウンロード」→「統計情報」の「Cloud Storage の URI をコピー」の値（gs://pubsite_prod_rev_… のまま貼って大丈夫です）">
        <Input id="bucket" name="bucket" autoComplete="off" spellCheck={false} defaultValue={defaultBucket} placeholder="gs://pubsite_prod_rev_01234567890987654321" />
      </Field>
      <Field label="パッケージ名" htmlFor="package" hint="Google Play の URL の id= のあとの部分（例: com.example.kakeibo）">
        <Input id="package" name="package" autoComplete="off" spellCheck={false} defaultValue={defaultPackage} className="max-w-[360px]" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "確かめています…" : "確かめて保存する"}
        </Button>
      </div>
    </form>
  );
}

// ===== App Store のストアのページの閲覧数（段取り ⑤） =====

export function AppStoreViewsForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<StoreFormState, FormData>(startAppStorePageViews.bind(null, projectId), {});
  const [privateKey, setPrivateKey] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {state.ok && <SuccessBanner>{state.ok}</SuccessBanner>}
      <Field label="Issuer ID" htmlFor="views-issuerId">
        <Input id="views-issuerId" name="issuerId" autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Admin のキーの Key ID" htmlFor="views-keyId">
        <Input id="views-keyId" name="keyId" autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Admin のキーの秘密鍵（.p8）" htmlFor="views-privateKey" hint="この 1 回だけ使い、保存しません">
        <input
          type="file"
          accept=".p8,text/plain"
          aria-label=".p8 ファイルを選ぶ"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file && file.size < 10_000) setPrivateKey(await file.text());
          }}
          className="text-sm"
        />
        <Textarea
          id="views-privateKey"
          name="privateKey"
          rows={3}
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
        />
      </Field>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "依頼しています…" : "閲覧数のレポートを依頼する"}
        </Button>
      </div>
    </form>
  );
}
