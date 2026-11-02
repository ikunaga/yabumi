// 行き先の URL（決定 D34。project_destinations）。プロジェクトの作成・設定のフォームで入れ、短縮リンクの行き先の候補にする。
// アプリのストアの URL（projects.app_store_url・play_store_url）は、アプリのときの行き先として候補の先頭に足す
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { DESTINATION_KIND_DEFS, DESTINATION_KINDS, isAppProject, type DestinationKind } from "./product-types";

// フォームで入れられる数（DB は 20 まで）
export const MAX_DESTINATIONS = 10;

export type DestinationInput = { id: string | null; kind: DestinationKind; label: string; url: string };
export type DestinationRow = { id: string; kind: DestinationKind; label: string; url: string };

const httpsUrl = z
  .string()
  .trim()
  .max(2000, "URL は 2,000 文字以内にしてください")
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "https:// から始まる URL を入れてください");

const destinationSchema = z.object({
  id: z.uuid().nullable(),
  kind: z.enum(DESTINATION_KINDS, { message: "行き先の種類を選んでください" }),
  label: z.string().trim().max(60, "名前は 60 文字以内にしてください"),
  url: httpsUrl,
});

// フォームの dest-<i>-id・kind・label・url を読む。URL が空の行は捨てる。エラーは「行き先 n 行目: …」
export function parseDestinationsForm(formData: FormData): { ok: true; items: DestinationInput[] } | { ok: false; error: string } {
  const items: DestinationInput[] = [];
  for (let i = 0; i < MAX_DESTINATIONS + 5; i++) {
    const url = String(formData.get(`dest-${i}-url`) ?? "").trim();
    if (!url) continue;
    const parsed = destinationSchema.safeParse({
      id: String(formData.get(`dest-${i}-id`) ?? "") || null,
      kind: String(formData.get(`dest-${i}-kind`) ?? ""),
      label: String(formData.get(`dest-${i}-label`) ?? ""),
      url,
    });
    if (!parsed.success) return { ok: false, error: `行き先の URL の ${items.length + 1} 行目: ${parsed.error.issues[0].message}` };
    items.push(parsed.data);
  }
  if (items.length > MAX_DESTINATIONS) return { ok: false, error: `行き先の URL は ${MAX_DESTINATIONS} までにしてください` };
  return { ok: true, items };
}

export async function listDestinations(supabase: SupabaseClient<Database>, projectId: string): Promise<DestinationRow[]> {
  const { data, error } = await supabase.from("project_destinations").select("id, kind, label, url").eq("project_id", projectId).order("position").order("created_at");
  if (error) throw error;
  return (data ?? []).map((d) => ({ id: d.id, kind: d.kind as DestinationKind, label: d.label, url: d.url }));
}

// フォームの行に合わせる: ある行は直し、新しい行は足し、なくなった行は消す（先に足し・直してから消すので、途中で失敗しても全部は消えない）
export async function saveDestinations(supabase: SupabaseClient<Database>, projectId: string, items: DestinationInput[]): Promise<void> {
  const current = await listDestinations(supabase, projectId);
  const keep = new Set<string>();
  for (const [position, d] of items.entries()) {
    const known = d.id && current.some((c) => c.id === d.id);
    if (known) {
      keep.add(d.id!);
      const { error } = await supabase.from("project_destinations").update({ kind: d.kind, label: d.label, url: d.url, position }).eq("id", d.id!).eq("project_id", projectId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("project_destinations").insert({ project_id: projectId, kind: d.kind, label: d.label, url: d.url, position }).select("id").single();
      if (error) throw error;
      keep.add(data.id);
    }
  }
  const gone = current.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (gone.length) {
    const { error } = await supabase.from("project_destinations").delete().in("id", gone).eq("project_id", projectId);
    if (error) throw error;
  }
}

// 短縮リンクの行き先の候補（アプリならストアを先に）。label は画面に出す名前
export function destinationCandidates(
  project: { product_type?: string | null; app_store_url: string | null; play_store_url: string | null },
  destinations: DestinationRow[],
): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if (isAppProject(project)) {
    if (project.app_store_url) out.push({ label: `App Store（${project.app_store_url}）`, url: project.app_store_url });
    if (project.play_store_url) out.push({ label: `Google Play（${project.play_store_url}）`, url: project.play_store_url });
  }
  for (const d of destinations) {
    if (out.some((o) => o.url === d.url)) continue;
    out.push({ label: `${d.label || DESTINATION_KIND_DEFS[d.kind].label}（${d.url}）`, url: d.url });
  }
  return out;
}
