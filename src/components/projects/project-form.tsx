"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { ProjectFormState } from "@/lib/projects/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Term } from "@/components/ui/term";

type FieldKey = "name" | "description" | "target_audience" | "app_store_url" | "play_store_url";

const FIELD_ORDER: FieldKey[] = ["name", "description", "target_audience", "app_store_url", "play_store_url"];

type Values = Partial<Record<FieldKey, string | null>>;

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
  lead,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;
  initial?: Values;
  title: string;
  lead?: string;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [focused, setFocused] = useState<FieldKey>("name");
  const v: Values = { ...initial, ...state.values };
  const fe = state.fieldErrors ?? {};
  const errorCount = Object.keys(fe).length;
  const help = HELP[helpKey(focused)];

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
          <h1 className="font-heading text-[30px] font-bold max-sm:hidden">{title}</h1>
          {lead && <p className="text-base text-muted max-sm:text-[14px] max-sm:leading-[1.7]">{lead}</p>}
        </div>

        {errorCount > 0 && <ErrorBanner>{errorCount} か所を直してください</ErrorBanner>}
        {state.error && <ErrorBanner id="project-form-error">{state.error}</ErrorBanner>}

        <form
          action={formAction}
          noValidate
          className="flex flex-col gap-[22px] rounded-lg border border-border bg-surface p-7 max-sm:gap-5 max-sm:border-0 max-sm:bg-transparent max-sm:p-0"
        >
          <Field label="アプリ名" htmlFor="name" required error={fe.name}>
            <Input {...fieldProps("name")} required maxLength={100} placeholder="例: かけいぼ日和" autoComplete="off" />
          </Field>

          <Field
            label="どんなアプリか"
            htmlFor="description"
            error={fe.description}
            hint="何ができて、誰のどんな困りごとを解決するのか。AI がネタを考えるときの材料になります。"
          >
            <Textarea
              {...fieldProps("description")}
              maxLength={2000}
              placeholder="例: レシートを撮るだけで家計簿がつく"
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
              placeholder="例: 家計簿を何度も挫折している 20〜30 代の会社員"
              autoComplete="off"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1 max-sm:gap-5">
            <Field label="App Store の URL" htmlFor="app_store_url" error={fe.app_store_url}>
              <Input {...fieldProps("app_store_url")} type="url" inputMode="url" placeholder="https://apps.apple.com/…" />
            </Field>
            <Field label="Google Play の URL" htmlFor="play_store_url" error={fe.play_store_url}>
              <Input {...fieldProps("play_store_url")} type="url" inputMode="url" placeholder="リリース前なら空欄で OK" />
            </Field>
          </div>

          <div className="flex gap-3 border-t border-line pt-6 max-sm:border-0 max-sm:pt-0">
            <Button type="submit" disabled={pending} className="px-6 max-sm:h-13 max-sm:w-full">
              {pending ? "保存中…" : submitLabel}
            </Button>
            <ButtonLink href={cancelHref} variant="text" className="max-sm:hidden">
              キャンセル
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
