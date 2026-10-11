"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { createLink, saveProviderToken, type LinkActionState } from "@/lib/links/actions";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";

// 短縮リンクの画面の、コピーのボタンと入力の欄（docs/architecture.md の 4.22）

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 text-sm font-semibold text-primary hover:underline"
    >
      {copied ? "コピーしました" : "コピー"}
    </button>
  );
}

type Destination = { label: string; url: string };

// 行き先: プロジェクトのストアの URL から選ぶか、自分で入れる
function DestinationField({ destinations, id }: { destinations: Destination[]; id: string }) {
  const [choice, setChoice] = useState(destinations[0]?.url ?? "");
  const [custom, setCustom] = useState("");
  const value = choice === "" ? custom : choice;
  return (
    <Field label="行き先" htmlFor={`${id}-choice`} hint="押した人を、ここへ送ります。https:// で始まる URL だけです。">
      <select
        id={`${id}-choice`}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="w-full rounded-md border border-input bg-surface px-3.5 py-3 text-base text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
      >
        {destinations.map((d) => (
          <option key={d.url} value={d.url}>
            {d.label}
          </option>
        ))}
        <option value="">ほかの URL を入れる</option>
      </select>
      {choice === "" && (
        <Input aria-label="行き先の URL" type="url" inputMode="url" placeholder="https://" value={custom} onChange={(e) => setCustom(e.target.value)} />
      )}
      <input type="hidden" name="destination" value={value} />
    </Field>
  );
}

export function ProfileLinkForm({ projectId, sns, destinations }: { projectId: string; sns: SnsKey; destinations: Destination[] }) {
  const [state, action, pending] = useActionState<LinkActionState, FormData>(createLink.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value="profile" />
      <input type="hidden" name="sns" value={sns} />
      <input type="hidden" name="label" value={`${SNS[sns].label} のプロフィール`} />
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      <DestinationField destinations={destinations} id={`profile-${sns}`} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "作っています…" : `${SNS[sns].label} 用のリンクを作る`}
        </Button>
      </div>
    </form>
  );
}

export function CustomLinkForm({ projectId, destinations }: { projectId: string; destinations: Destination[] }) {
  const [state, action, pending] = useActionState<LinkActionState, FormData>(createLink.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="kind" value="custom" />
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {state.ok && <SuccessBanner>{state.ok}</SuccessBanner>}
      <Field label="名前" htmlFor="custom-label" optional hint="あとで見分けるための名前。例: note の記事の最後">
        <Input id="custom-label" name="label" maxLength={100} />
      </Field>
      <Field label="どこで使うか" htmlFor="custom-sns" optional hint="選ぶと、SNS ごとの数字に分けて数えます">
        <select
          id="custom-sns"
          name="sns"
          defaultValue=""
          className="w-full rounded-md border border-input bg-surface px-3.5 py-3 text-base text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
        >
          <option value="">決めない</option>
          {SNS_KEYS.map((k) => (
            <option key={k} value={k}>
              {SNS[k].label}
            </option>
          ))}
        </select>
      </Field>
      <DestinationField destinations={destinations} id="custom" />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "作っています…" : "リンクを作る"}
        </Button>
      </div>
    </form>
  );
}

export function ProviderTokenForm({ projectId, current }: { projectId: string; current: string | null }) {
  const [state, action, pending] = useActionState<LinkActionState, FormData>(saveProviderToken.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      {state.ok && <SuccessBanner>{state.ok}</SuccessBanner>}
      <Field label="provider token（pt）" htmlFor="pt" optional hint="数字だけ。例: 123456">
        <Input id="pt" name="pt" inputMode="numeric" defaultValue={current ?? ""} maxLength={20} className="max-w-[240px]" />
      </Field>
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          保存する
        </Button>
      </div>
    </form>
  );
}
