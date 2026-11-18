"use client";

import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/feedback";
import { listPostFormats, type FormatsResult } from "@/lib/post-formats/actions";
import type { PostFormat, PostFormatInput } from "@/lib/post-formats/schema";
import type { SnsKey } from "@/lib/sns";
import { FormatManager } from "./format-manager";

// フォーマットの画面の「投稿の文」のタブ。開いたときに一覧を読み、操作のたびにサーバーが返した一覧に入れ替える
export function FormatsScreen(p: { projectId: string; pillars: string[]; planHashtags: string[]; connected: SnsKey[]; aiEnabled: boolean }) {
  const [formats, setFormats] = useState<PostFormat[] | null>(null);
  const [examples, setExamples] = useState<PostFormatInput[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const apply = (r: FormatsResult) => {
    setError(r.error ?? null);
    if (r.formats) setFormats(r.formats);
    if (r.examples) setExamples(r.examples);
    if (r.kinds) setKinds(r.kinds);
  };
  useEffect(() => {
    let alive = true;
    void listPostFormats(p.projectId).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [p.projectId]);
  if (formats === null) return error ? <ErrorBanner>{error}</ErrorBanner> : <p className="text-xs text-faint">読み込んでいます…</p>;
  return (
    <div className="flex flex-col gap-3">
      <FormatManager projectId={p.projectId} formats={formats} examples={examples} kinds={kinds} pillars={p.pillars} planHashtags={p.planHashtags} connected={p.connected} aiEnabled={p.aiEnabled} onChange={apply} />
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </div>
  );
}
