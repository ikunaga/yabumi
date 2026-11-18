"use client";

import { useState, useTransition } from "react";
import { FormatTagsFields } from "@/components/formats/format-manager";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { FORMAT_HASHTAG_KEYS, type FormatHashtagKey } from "@/lib/post-formats/schema";
import type { DefaultHashtags } from "@/lib/projects/default-hashtags";
import { saveDefaultHashtags } from "@/lib/projects/default-hashtags-actions";
import type { SnsKey } from "@/lib/sns";
import { hashtagLine } from "@/lib/sns/hashtags";

const toInputs = (h: DefaultHashtags): Partial<Record<FormatHashtagKey, string>> =>
  Object.fromEntries(FORMAT_HASHTAG_KEYS.filter((k) => h[k]?.length).map((k) => [k, hashtagLine(h[k]!)]));

// プロジェクトの設定の「いつものタグ」（projects.default_hashtags。2026-11-17 オーナーの依頼、案 A）。
// 新しい投稿と、AI のネタ・ネタ帳・相談から作る下書きの「2 送り先」のタグの欄に、最初から入る。フォーマットにタグがあれば、そちらが先。
// 欄は投稿のフォーマットのタグと同じ（全部の SNS と、畳んだ SNS ごと。アカウント設計の候補は押すと全部の SNS の欄に足す）
export function DefaultHashtagsCard({ projectId, initial, planHashtags, connected }: { projectId: string; initial: DefaultHashtags; planHashtags: string[]; connected: SnsKey[] }) {
  const [tags, setTags] = useState(() => toInputs(initial));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setTag = (k: FormatHashtagKey, x: string) => {
    setTags((o) => ({ ...o, [k]: x }));
    setSaved(false);
    setError(null);
  };

  return (
    <div id="default-hashtags" className="scroll-mt-20">
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            いつものタグ
            <HelpTip label="いつものタグについて">
              新しい投稿をつくるとき（AI のネタ・ネタ帳・相談から下書きを作るときも）、「2 送り先」のタグの欄に最初から入ります。投稿ごとに直したり消したりできます。投稿のフォーマットにタグがあれば、その SNS はフォーマットのタグになります。
            </HelpTip>
          </span>
        }
      />
      <form
        className="flex flex-col gap-4 px-6 pb-5 max-sm:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveDefaultHashtags(projectId, Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, v ?? ""])));
            if (!r.ok) {
              setError(r.error);
              return;
            }
            setTags(toInputs(r.hashtags));
            setSaved(true);
          });
        }}
      >
        <FormatTagsFields tags={tags} setTag={setTag} planHashtags={planHashtags} connected={connected} legend="毎回付けるタグ" footnote="本文の下に 1 行あけて付きます。空にして保存すると、いつものタグはなくなります。" />
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "保存しています…" : "保存する"}
          </Button>
          {saved && !pending && (
            <span role="status" className="text-sm font-bold text-success">
              保存しました
            </span>
          )}
        </div>
      </form>
    </Card>
    </div>
  );
}
