import "server-only";
import type { SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";
import { toYmd } from "@/lib/time";
import { projectLinkBase } from "./domains";
import { shortLinkUrl } from "./rules";

export type LinkRow = {
  id: string;
  code: string;
  url: string;
  destination: string;
  sns: SnsKey | null;
  kind: "post" | "profile" | "custom";
  label: string;
  postId: string | null;
  disabled: boolean;
  createdAt: string;
  clicks7d: number;
  clicks30d: number;
  clicksTotal: number;
  excludedTotal: number;
};

// プロジェクトの短縮リンクと、クリックの合計（合計は DB の link_click_totals で出す。行を読んで足さない）
export async function listLinks(projectId: string, limit = 200): Promise<LinkRow[]> {
  const supabase = await createClient();
  const [{ data: links, error }, { data: totals, error: totalsError }] = await Promise.all([
    supabase
      .from("short_links")
      .select("id, code, destination_url, sns, kind, label, disabled_at, created_at, post_targets(post_id)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.rpc("link_click_totals", { p_project_id: projectId, p_today: toYmd(new Date()) }),
  ]);
  if (error) throw error;
  if (totalsError) throw totalsError;
  // つながった利用者のドメインがあれば、作ってあるリンクもそのドメインで出す（コードは同じなので、古いドメインでも開ける。D28）
  const base = await projectLinkBase(supabase, projectId);
  const byId = new Map((totals ?? []).map((t) => [t.link_id, t]));
  return (links ?? []).map((l) => {
    const t = byId.get(l.id);
    const target = l.post_targets as unknown as { post_id: string } | null;
    return {
      id: l.id,
      code: l.code,
      url: shortLinkUrl(l.code, base),
      destination: l.destination_url,
      sns: (l.sns as SnsKey | null) ?? null,
      kind: l.kind as LinkRow["kind"],
      label: l.label,
      postId: target?.post_id ?? null,
      disabled: Boolean(l.disabled_at),
      createdAt: l.created_at,
      clicks7d: Number(t?.clicks_7d ?? 0),
      clicks30d: Number(t?.clicks_30d ?? 0),
      clicksTotal: Number(t?.clicks_total ?? 0),
      excludedTotal: Number(t?.excluded_total ?? 0),
    };
  });
}
