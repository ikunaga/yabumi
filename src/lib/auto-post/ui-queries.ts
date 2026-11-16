import "server-only";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";
import { EXPIRED_MESSAGE } from "./engine";

// 自動の投稿の画面（実装担当3）だけが使う読み取り。core の queries.ts とは分けた（ジョブの担当と同じファイルを触らないように）。
// どれも利用者の権限で読む（RLS で本人のものだけ）

export type RunTargetResult = {
  sns: SnsKey;
  status: string;
  url: string | null;
  views: number | null;
  expired: boolean;
};

// 回の投稿ごとの、SNS ごとの送った結果と表示回数（回し方の画面の回の一覧と「平均の表示」）
export async function loadRunResults(postIds: string[]): Promise<Map<string, RunTargetResult[]>> {
  const out = new Map<string, RunTargetResult[]>();
  if (!postIds.length) return out;
  const db = await createClient();
  const { data: targets, error } = await db.from("post_targets").select("id, post_id, sns, status, external_url, error_message").in("post_id", postIds);
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
  for (const t of targets) {
    if (!isSnsKey(t.sns)) continue;
    const list = out.get(t.post_id) ?? [];
    list.push({
      sns: t.sns,
      status: t.status,
      url: t.external_url,
      views: latest.get(t.id)?.views ?? null,
      // 確かめないまま送る時刻を過ぎた配信先（engine の settleApprovals が failed にする）
      expired: t.status === "failed" && t.error_message === EXPIRED_MESSAGE,
    });
    out.set(t.post_id, list);
  }
  return out;
}

// 始める画面の材料の数（suggest.ts の SuggestMaterials と、使い道のカードの「残り n 件」）
export type AutoMaterialCounts = {
  unusedNotes: number;
  unusedPhotoNotes: number;
  seriesFormats: { id: string; name: string }[];
  destinations: { id: string; label: string }[];
  events: number;
};

export async function loadMaterialCounts(projectId: string): Promise<AutoMaterialCounts> {
  const db = await createClient();
  const [notes, formats, destinations, events] = await Promise.all([
    db.from("idea_notes").select("id, media_files(id)").eq("project_id", projectId).is("used_at", null),
    db.from("post_formats").select("id, name, series").eq("project_id", projectId).order("created_at"),
    db.from("project_destinations").select("id, label").eq("project_id", projectId).order("position"),
    db.from("project_events").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  if (notes.error) throw new Error(`idea_notes: ${notes.error.message}`);
  if (formats.error) throw new Error(`post_formats: ${formats.error.message}`);
  if (destinations.error) throw new Error(`project_destinations: ${destinations.error.message}`);
  if (events.error) throw new Error(`project_events: ${events.error.message}`);
  const isSeries = (s: unknown) => {
    const slots = (s as { slots?: Record<string, unknown> } | null)?.slots;
    return !!slots && typeof slots === "object" && Object.keys(slots).length > 0;
  };
  return {
    unusedNotes: notes.data.length,
    unusedPhotoNotes: notes.data.filter((n) => (n.media_files as unknown[]).length > 0).length,
    seriesFormats: formats.data.filter((f) => isSeries(f.series)).map((f) => ({ id: f.id, name: f.name })),
    destinations: destinations.data.map((d) => ({ id: d.id, label: d.label })),
    events: events.count ?? 0,
  };
}
