import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listDestinations } from "@/lib/projects/destinations";
import { isAppProject } from "@/lib/projects/product-types";
import type { Database } from "@/lib/supabase/database.types";
import type { ProfileLinkDestination, ProfileLinkInfo } from "./profile-link";

// 作成画面の「Instagram では本文の URL は押せません」に使う（docs/architecture.md の 4.37）

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
    for (const url of [project.app_store_url, project.play_store_url]) if (url) destinations.push({ kind: "store", url });
  }
  for (const d of registered) if (!destinations.some((x) => x.url === d.url)) destinations.push({ kind: d.kind, url: d.url });
  return { productType: project.product_type, destinations, hasInstagramLink: (count ?? 0) > 0 };
}
