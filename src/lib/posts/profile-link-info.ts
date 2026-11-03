import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listDestinations } from "@/lib/projects/destinations";
import { DESTINATION_KIND_DEFS, isAppProject } from "@/lib/projects/product-types";
import type { Database } from "@/lib/supabase/database.types";
import type { ProfileLinkDestination, ProfileLinkInfo } from "./profile-link";

// 作成画面の「Instagram では本文の URL は押せません」（docs/architecture.md の 4.37）と「行き先の URL を入れる」（4.40）に使う

export async function loadProfileLinkInfo(
  supabase: SupabaseClient<Database>,
  project: { id: string; product_type: string | null; app_store_url: string | null; play_store_url: string | null },
): Promise<ProfileLinkInfo> {
  const [registered, { count, error }] = await Promise.all([
    listDestinations(supabase, project.id),
    supabase.from("short_links").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("kind", "profile").eq("sns", "instagram").is("disabled_at", null),
  ]);
  if (error) throw error;
  const destinations: ProfileLinkDestination[] = [];
  if (isAppProject(project)) {
    if (project.app_store_url) destinations.push({ kind: "store", url: project.app_store_url, label: "App Store" });
    if (project.play_store_url) destinations.push({ kind: "store", url: project.play_store_url, label: "Google Play" });
  }
  for (const d of registered) {
    if (!destinations.some((x) => x.url === d.url)) destinations.push({ kind: d.kind, url: d.url, label: d.label || DESTINATION_KIND_DEFS[d.kind].label });
  }
  return { productType: project.product_type, destinations, hasInstagramLink: (count ?? 0) > 0 };
}
