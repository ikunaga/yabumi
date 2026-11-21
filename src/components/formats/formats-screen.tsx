"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/feedback";
import { listPostFormats, type FormatsResult } from "@/lib/post-formats/actions";
import type { PostFormat, PostFormatInput } from "@/lib/post-formats/schema";
import type { SnsKey } from "@/lib/sns";
import { FormatManager, type FormatsView } from "./format-manager";

const NEW_WAYS = ["choose", "blank", "example", "ai"] as const;

// URL の ?edit=id・?new=… から、出す画面を決める（戻るボタンで一覧に戻れるように、画面ごとに URL を変える）
function viewOf(params: URLSearchParams): FormatsView {
  const edit = params.get("edit");
  if (edit) return { kind: "edit", id: edit };
  const how = params.get("new");
  if (how) return { kind: "new", how: (NEW_WAYS as readonly string[]).includes(how) ? (how as (typeof NEW_WAYS)[number]) : "choose" };
  return { kind: "list" };
}

// フォーマットの画面。開いたときに一覧を読み、操作のたびにサーバーが返した一覧に入れ替える
export function FormatsScreen(p: { projectId: string; pillars: string[]; planHashtags: string[]; connected: SnsKey[]; aiEnabled: boolean; back: { href: string; label: string } | null }) {
  const [formats, setFormats] = useState<PostFormat[] | null>(null);
  const [examples, setExamples] = useState<PostFormatInput[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [roundCounts, setRoundCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = viewOf(params);
  const go = (v: FormatsView) => {
    // 自動投稿から来たときの ?back= は持ち回る
    const q = new URLSearchParams();
    const back = params.get("back");
    if (back) q.set("back", back);
    if (v.kind === "edit") q.set("edit", v.id);
    if (v.kind === "new") q.set("new", v.how);
    setError(null);
    router.push(q.size ? `${pathname}?${q}` : pathname);
  };
  const apply = (r: FormatsResult) => {
    setError(r.error ?? null);
    if (r.formats) setFormats(r.formats);
    if (r.examples) setExamples(r.examples);
    if (r.kinds) setKinds(r.kinds);
    if (r.roundCounts) setRoundCounts(r.roundCounts);
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
    <div className="flex flex-col gap-3 text-sm">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <FormatManager
        projectId={p.projectId}
        formats={formats}
        examples={examples}
        kinds={kinds}
        roundCounts={roundCounts}
        pillars={p.pillars}
        planHashtags={p.planHashtags}
        connected={p.connected}
        aiEnabled={p.aiEnabled}
        view={view}
        go={go}
        back={p.back}
        onChange={apply}
      />
    </div>
  );
}
