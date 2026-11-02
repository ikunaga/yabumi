"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { ProjectFormState } from "@/lib/projects/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { HelpTip } from "@/components/ui/help";
import { MAX_DESTINATIONS } from "@/lib/projects/destinations";
import {
  DESTINATION_KIND_DEFS,
  DESTINATION_KINDS,
  PRODUCT_TYPE_DEFS,
  PRODUCT_TYPES,
  RECOMMENDED_DESTINATIONS,
  isProductType,
  type DestinationKind,
  type ProductType,
} from "@/lib/projects/product-types";

type FieldKey = "name" | "description" | "target_audience" | "app_store_url" | "play_store_url";

const FIELD_ORDER: FieldKey[] = ["name", "description", "target_audience", "app_store_url", "play_store_url"];

type Values = Partial<Record<FieldKey, string | null>> & { product_type?: string | null };

// 行き先の URL の 1 行（フォームの中だけ。保存は src/lib/projects/destinations.ts）
type DestRow = { key: number; id: string | null; kind: DestinationKind; label: string; url: string };

// 種類ごとの欄の名前と例（決定 D34。アプリのときは前の文言のまま）
const NAME_LABEL: Record<ProductType, string> = {
  app: "アプリ名",
  web_service: "サービスの名前",
  shop: "お店の名前",
  online_shop: "お店・商品の名前",
  service: "サービス・教室の名前",
  creator: "作品・活動の名前",
  other: "名前",
};
const NAME_PLACEHOLDER: Record<ProductType, string> = {
  app: "例: かけいぼ日和",
  web_service: "例: よやくらく",
  shop: "例: こむぎ日和（パン屋）",
  online_shop: "例: 手づくり革小物 kotori",
  service: "例: 朝ヨガ教室 ひだまり",
  creator: "例: イラストレーター 山田はな",
  other: "例: 手づくり市 2026",
};
const DESCRIPTION_LABEL: Record<ProductType, string> = {
  app: "どんなアプリか",
  web_service: "どんなサービスか",
  shop: "どんなお店か",
  online_shop: "どんなものを売っているか",
  service: "どんなサービスか",
  creator: "どんな作品・発信か",
  other: "どんなものか",
};
const AUDIENCE_PLACEHOLDER: Record<ProductType, string> = {
  app: "例: 家計簿を何度も挫折している 20〜30 代の会社員",
  web_service: "例: 電話の予約受けに困っている、ひとりで営む美容室の店主",
  shop: "例: 駅を使う通勤・通学の人と、近所の子育て世帯",
  online_shop: "例: 長く使える革小物を贈り物に探している 30 代",
  service: "例: 運動を始めたいけれどジムは続かなかった 40 代",
  creator: "例: 動物のイラストが好きで、LINE スタンプをよく買う人",
  other: "例: 手づくりの品が好きな、近くに住む家族連れ",
};
const DESCRIPTION_PLACEHOLDER: Record<ProductType, string> = {
  app: "例: レシートを撮るだけで家計簿がつく",
  web_service: "例: 美容室の予約を LINE で受けられる",
  shop: "例: 駅前の小さなパン屋。朝 7 時に食パンが焼き上がる",
  online_shop: "例: 牛革のキーケースと財布。名入れができる",
  service: "例: 朝 7 時からの少人数のヨガ。初心者向け",
  creator: "例: 動物のゆるいイラスト。LINE スタンプも作っている",
  other: "例: 月に 1 回の手づくり品の市",
};

// 右の欄に出す「この欄について」。選んでいる欄の説明を出す
const HELP: Record<"name" | "description" | "target_audience" | "store", { title: string; body: ReactNode }> = {
  name: {
    title: "アプリ名",
    body: "宣伝したいアプリの名前です。ストアに載せている名前と同じにしておくと、投稿を見た人が探しやすくなります。",
  },
  description: {
    title: "どんなアプリか",
    body: "何ができて、誰のどんな困りごとを解決するのか。AI が投稿のネタを考えるときの材料になります。",
  },
  target_audience: {
    title: "届けたい相手",
    body: (
      <>
        アプリを届けたい人の像（<Term k="persona" />
        ）です。具体的なほど、投稿の言葉選びがぶれなくなります。
      </>
    ),
  },
  store: {
    title: "ストアページの URL",
    body: (
      <>
        投稿からストアへ何人来たかを測るのに使います（
        <Term k="conversion" />
        の計測）。リリース前なら空欄で構いません。
      </>
    ),
  },
};

function helpKey(field: FieldKey): keyof typeof HELP {
  return field === "app_store_url" || field === "play_store_url" ? "store" : field;
}

export function ProjectForm({
  action,
  initial = {},
  title,
  titleAs = "h1",
  lead,
  submitLabel,
  pendingLabel,
  cancelHref,
  initialDestinations = [],
}: {
  action: (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;
  initial?: Values;
  // 行き先の URL（設定の画面では登録してあるもの）
  initialDestinations?: { id: string; kind: DestinationKind; label: string; url: string }[];
  title: string;
  // 設定の画面では、画面の見出し（h1）の下の区切りとして h2 にする
  titleAs?: "h1" | "h2";
  lead?: string;
  submitLabel: string;
  // 押したあと、終わるまでの表示（「作成しています…」など）
  pendingLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [focused, setFocused] = useState<FieldKey>("name");
  const v: Values = { ...initial, ...state.values };
  const fe = state.fieldErrors ?? {};
  const errorCount = Object.keys(fe).length;
  // 種類と行き先は、送信でフォームが空になっても残るように、画面の中で持つ
  const [productType, setProductType] = useState<ProductType>(isProductType(initial.product_type) ? initial.product_type : "app");
  const [dests, setDests] = useState<DestRow[]>(() =>
    initialDestinations.length ? initialDestinations.map((d, i) => ({ key: i, ...d })) : [{ key: 0, id: null, kind: RECOMMENDED_DESTINATIONS.app[0], label: "", url: "" }],
  );
  const isApp = productType === "app";
  // 右の「この欄について」。名前と説明は、アプリでなければアプリの言葉を使わない
  const help =
    !isApp && helpKey(focused) === "name"
      ? { title: NAME_LABEL[productType], body: "宣伝したいものの名前です。お店や看板、サイトと同じ名前にしておくと、投稿を見た人が探しやすくなります。" }
      : !isApp && helpKey(focused) === "description"
        ? { title: DESCRIPTION_LABEL[productType], body: "何を提供していて、誰のどんな困りごとや楽しみに応えるのか。AI が投稿のネタを考えるときの材料になります。" }
        : HELP[helpKey(focused)];
  const updateDest = (key: number, patch: Partial<DestRow>) => setDests((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // 送信してエラーがあれば、最初のエラー欄へ移る
  useEffect(() => {
    const first = FIELD_ORDER.find((k) => state.fieldErrors?.[k]);
    if (first) document.getElementById(first)?.focus();
    else if (state.error) document.getElementById("project-form-error")?.focus();
  }, [state]);

  const fieldProps = (key: FieldKey) => ({
    id: key,
    name: key,
    defaultValue: v[key] ?? "",
    invalid: Boolean(fe[key]),
    onFocus: () => setFocused(key),
  });

  return (
    <div className="grid grid-cols-[680px_1fr] gap-14 max-xl:grid-cols-1">
      <div className="flex flex-col gap-6 max-sm:gap-5">
        <div className="flex flex-col gap-1.5">
          {titleAs === "h2" ? (
            <h2 className="text-[18px] font-bold">{title}</h2>
          ) : (
            <h1 className="font-heading text-[30px] font-bold max-sm:hidden">{title}</h1>
          )}
          {lead && <p className="text-base text-muted max-sm:text-[14px] max-sm:leading-[1.7]">{lead}</p>}
        </div>

        {errorCount > 0 && <ErrorBanner>{errorCount} か所を直してください</ErrorBanner>}
        {state.error && <ErrorBanner id="project-form-error">{state.error}</ErrorBanner>}

        <form
          action={formAction}
          noValidate
          className="flex flex-col gap-[22px] rounded-lg border border-border bg-surface p-7 max-sm:gap-5 max-sm:border-0 max-sm:bg-transparent max-sm:p-0"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 flex items-center gap-2 text-sm font-bold">
              種類
              <HelpTip label="宣伝するものの種類">
                選んだ種類に合わせて、欄の名前・AI の案・追いかける数字が変わります。アプリを選ぶと、ストアの数字の取り込みと GitHub の機能が使えます。あとから設定で変えられます。
              </HelpTip>
            </legend>
            <input type="hidden" name="product_type" value={productType} />
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              {PRODUCT_TYPES.map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2.5 text-sm ${productType === t ? "border-primary bg-primary-soft" : "border-border hover:border-input"}`}
                >
                  <span className="flex items-center gap-2 font-bold">
                    <input
                      type="radio"
                      name="product_type_choice"
                      value={t}
                      checked={productType === t}
                      onChange={() => {
                        setProductType(t);
                        // まだ何も入れていない行き先は、種類のおすすめに合わせる
                        setDests((rows) => rows.map((r) => (r.url || r.label || r.id ? r : { ...r, kind: RECOMMENDED_DESTINATIONS[t][0] })));
                      }}
                    />
                    {PRODUCT_TYPE_DEFS[t].label}
                  </span>
                  <span className="pl-6 text-xs text-muted">{PRODUCT_TYPE_DEFS[t].examples}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">{PRODUCT_TYPE_DEFS[productType].description}</p>
          </fieldset>

          <Field label={NAME_LABEL[productType]} htmlFor="name" required error={fe.name}>
            <Input {...fieldProps("name")} required maxLength={100} placeholder={NAME_PLACEHOLDER[productType]} autoComplete="off" />
          </Field>

          <Field
            label={DESCRIPTION_LABEL[productType]}
            htmlFor="description"
            error={fe.description}
            hint="何ができて、誰のどんな困りごとを解決するのか。AI がネタを考えるときの材料になります。"
          >
            <Textarea
              {...fieldProps("description")}
              maxLength={2000}
              placeholder={DESCRIPTION_PLACEHOLDER[productType]}
            />
          </Field>

          <Field
            label={
              <>
                届けたい相手（<Term k="persona" />）
              </>
            }
            htmlFor="target_audience"
            error={fe.target_audience}
            hint="まだ決まっていなくても大丈夫です。後から AI と一緒に考えられます。"
          >
            <Input
              {...fieldProps("target_audience")}
              maxLength={1000}
              placeholder={AUDIENCE_PLACEHOLDER[productType]}
              autoComplete="off"
            />
          </Field>

          {isApp && (
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1 max-sm:gap-5">
              <Field label="App Store の URL" htmlFor="app_store_url" error={fe.app_store_url}>
                <Input {...fieldProps("app_store_url")} type="url" inputMode="url" placeholder="https://apps.apple.com/…" />
              </Field>
              <Field label="Google Play の URL" htmlFor="play_store_url" error={fe.play_store_url}>
                <Input {...fieldProps("play_store_url")} type="url" inputMode="url" placeholder="リリース前なら空欄で OK" />
              </Field>
            </div>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 flex items-center gap-2 text-sm font-bold">
              {isApp ? "ほかの行き先の URL（任意）" : "行き先の URL（任意）"}
              <HelpTip label="行き先の URL">
                投稿やプロフィールから案内したいページです（サイト・予約・ネットのお店・申し込みのフォームなど）。短縮リンクの行き先になり、SNS から何人来たかを数えられます。https:// から始まる URL を入れてください。
              </HelpTip>
            </legend>
            {dests.map((d, i) => (
              <div key={d.key} className="grid grid-cols-[9rem_8rem_1fr_auto] items-center gap-2 max-sm:grid-cols-[1fr_auto]">
                <input type="hidden" name={`dest-${i}-id`} value={d.id ?? ""} />
                <select
                  name={`dest-${i}-kind`}
                  value={d.kind}
                  onChange={(e) => updateDest(d.key, { kind: e.target.value as DestinationKind })}
                  aria-label="行き先の種類"
                  className="h-10 rounded-md border border-input bg-surface px-2 text-sm max-sm:col-span-2"
                >
                  {DESTINATION_KINDS.filter((k) => isApp || k !== "store").map((k) => (
                    <option key={k} value={k}>
                      {DESTINATION_KIND_DEFS[k].label}
                    </option>
                  ))}
                </select>
                <Input
                  name={`dest-${i}-label`}
                  value={d.label}
                  onChange={(e) => updateDest(d.key, { label: e.target.value })}
                  maxLength={60}
                  placeholder="名前（任意）"
                  aria-label="行き先の名前"
                  className="max-sm:col-span-2"
                />
                <Input
                  name={`dest-${i}-url`}
                  value={d.url}
                  onChange={(e) => updateDest(d.key, { url: e.target.value })}
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  aria-label="行き先の URL"
                />
                <button type="button" onClick={() => setDests((rows) => rows.filter((r) => r.key !== d.key))} className="text-sm text-muted hover:text-fg hover:underline">
                  外す
                </button>
              </div>
            ))}
            {dests.length < MAX_DESTINATIONS && (
              <button
                type="button"
                onClick={() => setDests((rows) => [...rows, { key: Math.max(-1, ...rows.map((r) => r.key)) + 1, id: null, kind: RECOMMENDED_DESTINATIONS[productType][0], label: "", url: "" }])}
                className="self-start text-sm font-bold text-fg underline"
              >
                ＋ 行き先を足す
              </button>
            )}
          </fieldset>

          <div className="flex gap-3 border-t border-line pt-6 max-sm:border-0 max-sm:pt-0">
            <Button type="submit" disabled={pending} className="px-6 max-sm:h-13 max-sm:w-full">
              {pending ? pendingLabel : submitLabel}
            </Button>
            <ButtonLink href={cancelHref} variant="text" className="max-sm:hidden">
              やめる
            </ButtonLink>
          </div>
        </form>
      </div>

      <aside aria-live="polite" className="flex flex-col gap-3 pt-[120px] max-xl:hidden">
        <p className="text-sm font-bold text-muted">この欄について</p>
        <p className="text-[14px] leading-[1.8] text-muted">
          <b className="text-fg">{help.title}</b> {help.body}
        </p>
      </aside>
    </div>
  );
}
