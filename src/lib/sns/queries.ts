import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSnsKey, type SnsKey } from "./index";

// どれも RLS により、ログイン中のユーザー自身のものしか返らない。トークンは読まない

export type ProjectSnsAccount = {
  id: string;
  sns: SnsKey;
  handle: string;
  displayName: string;
  status: "active" | "expired" | "revoked";
};

type Row = {
  project_id: string;
  social_accounts: { id: string; sns: string; handle: string; display_name: string; status: string } | null;
};

function toAccount(a: NonNullable<Row["social_accounts"]>): ProjectSnsAccount | null {
  if (!isSnsKey(a.sns)) return null;
  return { id: a.id, sns: a.sns, handle: a.handle, displayName: a.display_name, status: a.status as ProjectSnsAccount["status"] };
}

// プロジェクトにつないだアカウント
export async function listProjectSnsAccounts(projectId: string): Promise<ProjectSnsAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_social_accounts")
    .select("project_id, social_accounts(id, sns, handle, display_name, status)")
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw error;
  return (data as unknown as Row[]).flatMap((r) => (r.social_accounts ? (toAccount(r.social_accounts) ?? []) : []));
}

// プロジェクト一覧用: プロジェクトごとに、使える状態でつないだ SNS
export async function activeSnsByProject(): Promise<Record<string, SnsKey[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_social_accounts")
    .select("project_id, social_accounts(id, sns, handle, display_name, status)")
    .order("created_at");
  if (error) throw error;
  const result: Record<string, SnsKey[]> = {};
  for (const r of data as unknown as Row[]) {
    const a = r.social_accounts && toAccount(r.social_accounts);
    if (!a || a.status !== "active") continue;
    const list = (result[r.project_id] ??= []);
    if (!list.includes(a.sns)) list.push(a.sns);
  }
  return result;
}
