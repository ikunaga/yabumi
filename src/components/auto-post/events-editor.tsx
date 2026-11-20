"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { deleteEvent, saveEvent } from "@/lib/auto-post/actions";
import { EVENT_BODY_MAX, MAX_PROJECT_EVENTS } from "@/lib/auto-post/schema";
import type { ProjectEvent } from "@/lib/auto-post/types";

// お知らせ・季節の予定（docs/design/auto-post.md の 2.1 の events）。日付と 100 字の中身。足す・直す・削除する
export function EventsEditor({ projectId, initial, today }: { projectId: string; initial: ProjectEvent[]; today: string }) {
  const [events, setEvents] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null); // 直している予定の id（新しいものは "new"）
  const [onDate, setOnDate] = useState(today);
  const [body, setBody] = useState("");
  const [removing, setRemoving] = useState<ProjectEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = (e: ProjectEvent | null) => {
    setError(null);
    setEditing(e?.id ?? "new");
    setOnDate(e?.onDate ?? today);
    setBody(e?.body ?? "");
  };
  const sorted = [...events].sort((a, b) => a.onDate.localeCompare(b.onDate));
  const full = events.length >= MAX_PROJECT_EVENTS;

  const form = (
    <form
      className="flex flex-col gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        start(async () => {
          setError(null);
          const r = await saveEvent(projectId, {
            id: editing && editing !== "new" ? editing : undefined,
            onDate,
            body,
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setEvents((list) => [...list.filter((x) => x.id !== r.data.id), r.data]);
          setEditing(null);
        });
      }}
    >
      <div className="grid grid-cols-[12rem_1fr] gap-3 max-sm:grid-cols-1">
        <Field label="日付" htmlFor="event-date">
          <Input id="event-date" type="date" required value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </Field>
        <Field label="中身" htmlFor="event-body" hint={`${body.length} / ${EVENT_BODY_MAX} 字`}>
          <Input id="event-body" required maxLength={EVENT_BODY_MAX} value={body} placeholder="例: 12/1 から冬の新メニュー" onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
        <Button type="button" variant="text" onClick={() => setEditing(null)}>
          やめる
        </Button>
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending ? "保存しています…" : "保存する"}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {editing === "new" ? (
        <Card>{form}</Card>
      ) : (
        <div className="flex justify-end max-sm:block">
          <Button type="button" disabled={full} onClick={() => open(null)} className="max-sm:w-full">
            ＋ 予定を足す
          </Button>
        </div>
      )}
      <Card className="overflow-hidden">
        {sorted.length === 0 ? (
          <EmptyState title="予定はまだありません" description="新しいメニュー・セール・休みの日などを入れると、「お知らせ・季節」の自動の投稿で、その日の前日と当日に知らせます。" />
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((e) =>
              editing === e.id ? (
                <li key={e.id}>{form}</li>
              ) : (
                <li key={e.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3.5 max-sm:px-4 ${e.onDate < today ? "text-muted" : ""}`}>
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="num text-[15px] font-bold">{e.onDate.replaceAll("-", "/")}</span>
                    <span className="text-[15px] break-words">{e.body}</span>
                    {e.onDate < today && <span className="text-xs">過ぎた予定</span>}
                  </p>
                  <span className="flex gap-1">
                    <Button type="button" variant="text" size="sm" onClick={() => open(e)}>
                      編集
                    </Button>
                    <Button type="button" variant="text" size="sm" onClick={() => setRemoving(e)}>
                      削除する
                    </Button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
      {full && <p className="text-sm text-muted">予定は {MAX_PROJECT_EVENTS} 件までです。過ぎた予定を削除してください。</p>}
      <ConfirmDialog
        open={!!removing}
        title="この予定を削除しますか"
        confirmLabel="削除する"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          start(async () => {
            setError(null);
            const r = await deleteEvent(projectId, target.id);
            if (!r.ok) setError(r.error);
            else setEvents((list) => list.filter((x) => x.id !== target.id));
          });
        }}
      >
        <p>{removing ? `${removing.onDate.replaceAll("-", "/")} ${removing.body}` : ""}</p>
      </ConfirmDialog>
    </div>
  );
}
