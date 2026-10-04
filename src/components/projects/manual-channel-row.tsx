"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SnsTag } from "@/components/ui/marks";
import { SNS, type SnsKey } from "@/lib/sns";
import { saveManualChannel } from "@/lib/sns/manual-actions";

// 概要の「つないだ SNS」の、手で投稿する SNS の行。つなぐ代わりに、プロフィールの URL を登録できる（任意）
export function ManualChannelRow({ projectId, sns, profileUrl, note }: { projectId: string; sns: SnsKey; profileUrl: string | null; note: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(profileUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = SNS[sns].label;

  return (
    <li className="flex flex-col gap-2 border-b border-line px-5 py-3 text-[14px] last:border-b-0 max-sm:px-4">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0">
          <SnsTag sns={sns} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="mr-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted">手で投稿</span>
          {profileUrl ? (
            <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {profileUrl.replace(/^https:\/\//, "")}
            </a>
          ) : (
            <span className="text-muted">{note}</span>
          )}
        </span>
        <Button type="button" variant="text" size="sm" onClick={() => setEditing((v) => !v)}>
          {profileUrl ? "URL を変える" : "URL を登録"}
        </Button>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-2 pl-[108px] max-sm:pl-0">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={sns === "substack" ? "例: https://masa.substack.com" : "例: https://note.com/masa"}
            aria-label={`${label} のプロフィールの URL`}
            className="min-w-0 flex-1 rounded-md border border-input bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
          />
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await saveManualChannel(projectId, sns, url);
                if (res.error) setError(res.error);
                else setEditing(false);
              })
            }
          >
            保存
          </Button>
          <p className="w-full text-xs text-muted">
            任意です。{sns === "substack" ? "登録すると、投稿の画面にすぐ移れます。" : ""}あとで反応を手で記録するときにも使います。空にして保存すると消えます。
          </p>
          {error && (
            <p role="alert" className="w-full text-sm font-semibold text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
