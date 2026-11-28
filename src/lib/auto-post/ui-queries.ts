import "server-only";
import { imageSpecText, readFormatImage } from "@/lib/post-formats/image";
import { cleanSeries, fixedBodySeries, isSeries, type FormatSeries } from "@/lib/post-formats/series";
import { formatSlots } from "@/lib/post-formats/schema";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { metricsState, type MetricsState } from "./metrics-state";
import { createClient } from "@/lib/supabase/server";
import { isExpiredTarget } from "./remind";

// 自動の投稿の画面（実装担当3）だけが使う読み取り。core の queries.ts とは分けた（ジョブの担当と同じファイルを触らないように）。
// どれも利用者の権限で読む（RLS で本人のものだけ）

export type RunTargetResult = {
  sns: SnsKey;
  status: string;
  url: string | null;
  views: number | null;
  expired: boolean;
  // 数字の状態（views が null のときに何を出すか。2026-11-28）: off = この SNS の数字は読んでいない、
  // waiting = まだ読む日が来ていない（firstRead は最初に読む朝の日付）、missing = 読む日は来たが、まだ入っていない
  metrics: MetricsState;
};

// 回の投稿ごとの、SNS ごとの送った結果と表示回数（回し方の画面の回の一覧と「平均の表示」）
export async function loadRunResults(postIds: string[]): Promise<Map<string, RunTargetResult[]>> {
  const out = new Map<string, RunTargetResult[]>();
  if (!postIds.length) return out;
  const db = await createClient();
  const { data: targets, error } = await db.from("post_targets").select("id, post_id, sns, status, external_url, error_message, published_at").in("post_id", postIds);
  if (error) throw new Error(`post_targets: ${error.message}`);
  const ids = targets.map((t) => t.id);
  const latest = new Map<string, { day: number; views: number | null }>();
  if (ids.length) {
    const { data: metrics, error: e2 } = await db.from("post_metrics").select("post_target_id, day_index, values").in("post_target_id", ids);
    if (e2) throw new Error(`post_metrics: ${e2.message}`);
    for (const m of metrics) {
      const cur = latest.get(m.post_target_id);
      if (cur && cur.day >= m.day_index) continue;
      const v = (m.values ?? {}) as Record<string, unknown>;
      latest.set(m.post_target_id, {
        day: m.day_index,
        views: typeof v.views === "number" && Number.isFinite(v.views) ? v.views : null,
      });
    }
  }
  const now = new Date();
  for (const t of targets) {
    if (!isSnsKey(t.sns)) continue;
    const views = latest.get(t.id)?.views ?? null;
    const list = out.get(t.post_id) ?? [];
    list.push({
      sns: t.sns,
      status: t.status,
      url: t.external_url,
      views,
      metrics: metricsState(t.sns, t.published_at, views, now),
      // 確かめないまま送る時刻を過ぎた配信先（engine の settleApprovals が failed にする）
      expired: isExpiredTarget(t),
    });
    out.set(t.post_id, list);
  }
  return out;
}

// 始める画面のシリーズのカード（名前・投稿の例・これまでの回の数）
// fixedBody: 本文が毎回同じ（型の文に AI の空欄がない）。自動の投稿で X を選べない
// hasImage: フォーマットに画像の設定がある（自動の回の画像は、いつもフォーマットのとおりにつくる。imageSpec はその要約）
// series: フォーマットの変数（「自分で入れる」変数の決め方を選ぶ欄に出す）。bodyVars: 本文に書いてある変数（決め方しだいで本文が毎回同じかを画面で見る）
export type SeriesFormatCard = { id: string; name: string; example: string; rounds: number; hasImage: boolean; hasHeadline: boolean; imageSpec: string | null; fixedBody: boolean; series: FormatSeries; bodyVars: string[] };

// 始める画面の材料の数（suggest.ts の SuggestMaterials と、使い道のカードの「残り n 件」）
export type AutoMaterialCounts = {
  unusedNotes: number;
  unusedPhotoNotes: number;
  seriesFormats: SeriesFormatCard[];
  destinations: { id: string; label: string }[];
  events: number;
};

export async function loadMaterialCounts(projectId: string): Promise<AutoMaterialCounts> {
  const db = await createClient();
  const [notes, formats, destinations, events] = await Promise.all([
    db.from("idea_notes").select("id, media_files(id)").eq("project_id", projectId).is("used_at", null),
    db.from("post_formats").select("id, name, body, series, example, image, post_format_rounds(count)").eq("project_id", projectId).order("created_at"),
    db.from("project_destinations").select("id, label").eq("project_id", projectId).order("position"),
    db.from("project_events").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  if (notes.error) throw new Error(`idea_notes: ${notes.error.message}`);
  if (formats.error) throw new Error(`post_formats: ${formats.error.message}`);
  if (destinations.error) throw new Error(`project_destinations: ${destinations.error.message}`);
  if (events.error) throw new Error(`project_events: ${events.error.message}`);
  return {
    unusedNotes: notes.data.length,
    unusedPhotoNotes: notes.data.filter((n) => (n.media_files as unknown[]).length > 0).length,
    // 変数のあるフォーマット（AI が考える変数があるか、「自分で入れる」変数を自動投稿では AI に考えてもらえば、シリーズとして回せる）
    seriesFormats: formats.data
      .map((f) => ({ f, series: cleanSeries(f.series, { body: f.body, image: readFormatImage(f.image) }) }))
      .filter(({ series }) => series.vars.length > 0)
      .map(({ f, series }) => ({
        id: f.id,
        name: f.name,
        example: f.example,
        rounds: (f.post_format_rounds as { count: number }[] | null)?.[0]?.count ?? 0,
        ...formatImageCard(f.image),
        fixedBody: isSeries(series) && fixedBodySeries(f.body, series),
        series,
        bodyVars: formatSlots(f.body),
      })),
    destinations: destinations.data.map((d) => ({ id: d.id, label: d.label })),
    events: events.count ?? 0,
  };
}

// フォーマットの画像の設定の有無と要約（自動の投稿の「画像」の欄と、回し方の画面で使う）
export function formatImageCard(raw: unknown): { hasImage: boolean; hasHeadline: boolean; imageSpec: string | null } {
  const img = readFormatImage(raw);
  return { hasImage: !!img, hasHeadline: !!img?.headline, imageSpec: img ? imageSpecText(img) : null };
}

// 回し方の画面の「画像」: シリーズのフォーマットの名前と画像の設定（本人のものだけ。RLS）。見つからなければ null
export async function loadSeriesFormatImage(projectId: string, formatId: string): Promise<{ name: string; hasImage: boolean; hasHeadline: boolean; imageSpec: string | null } | null> {
  const db = await createClient();
  const { data, error } = await db.from("post_formats").select("name, image").eq("id", formatId).eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(`post_formats: ${error.message}`);
  return data ? { name: data.name, ...formatImageCard(data.image) } : null;
}
