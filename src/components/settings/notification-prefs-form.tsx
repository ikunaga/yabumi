"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { saveNotificationPrefs, type PrefsFormState } from "@/lib/coach/prefs-actions";

type Mode = "weekly_and_behind" | "weekly" | "off";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "weekly_and_behind", label: "毎週の振り返り＋遅れそうなとき", hint: "おすすめ。月曜の朝と、決めた曜日に今週まだ投稿がないとき" },
  { value: "weekly", label: "毎週の振り返りだけ", hint: "月曜の朝に、先週の結果と今週の目標" },
  { value: "off", label: "送らない", hint: "画面の声かけ（概要の一番上）だけにする" },
];

const WEEKDAYS = ["月", "火", "水", "木", "金"];

// 伴走のお知らせの設定（4.27）。メールとスマホの通知を別々に選ぶ
export function NotificationPrefsForm({ emailMode, pushMode, behindWeekday }: { emailMode: Mode; pushMode: Mode; behindWeekday: number }) {
  const [state, action, pending] = useActionState<PrefsFormState, FormData>(saveNotificationPrefs, {});
  return (
    <form action={action} className="flex flex-col gap-5 px-5 py-4 text-[14px] max-sm:px-4">
      <ModeGroup name="email_mode" legend="メール" value={emailMode} />
      <ModeGroup name="push_mode" legend="スマホの通知" value={pushMode} note="スマホの通知は、下の「スマホの通知」でこの端末を登録すると届きます。" />
      <label className="flex flex-wrap items-center gap-2">
        <span className="font-bold">遅れそうなときに知らせる曜日</span>
        <select name="behind_weekday" defaultValue={behindWeekday} className="rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm max-sm:text-[16px]">
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}曜日の朝
            </option>
          ))}
        </select>
        <span className="w-full text-xs text-muted">その曜日の朝 7 時ごろに、今週まだ 1 本も投稿（予約を含む）がない SNS があれば知らせます。</span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          保存する
        </Button>
        {state.savedAt && !pending && <span className="text-sm font-bold text-success">保存しました</span>}
      </div>
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
    </form>
  );
}

function ModeGroup({ name, legend, value, note }: { name: string; legend: string; value: Mode; note?: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-bold">{legend}</legend>
      {MODES.map((m) => (
        <label key={m.value} className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name={name} value={m.value} defaultChecked={value === m.value} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            {m.label}
            <span className="block text-xs text-muted">{m.hint}</span>
          </span>
        </label>
      ))}
      {note && <p className="text-xs text-muted">{note}</p>}
    </fieldset>
  );
}
