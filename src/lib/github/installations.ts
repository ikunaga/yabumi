import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Installation } from "./api";

type Admin = SupabaseClient<Database>;

// GitHub の利用者の認可で確かめた「本人が使えるインストール」を記録する。消えたインストールは外す
// （つないでいたリポジトリも外れる）。RLS を通らないクライアントで呼ぶ
export async function syncInstallations(admin: Admin, ownerId: string, appId: string, installations: Installation[]): Promise<number> {
  const mine = installations.filter((i) => String(i.app_id) === String(appId));
  if (mine.length) {
    const { error } = await admin.from("github_installations").upsert(
      mine.map((i) => ({ owner_id: ownerId, installation_id: i.id, account_login: i.account.login, account_type: i.account.type })),
      { onConflict: "owner_id,installation_id" },
    );
    if (error) throw error;
  }
  const keep = mine.map((i) => i.id);
  let del = admin.from("github_installations").delete().eq("owner_id", ownerId);
  if (keep.length) del = del.not("installation_id", "in", `(${keep.join(",")})`);
  const { error } = await del;
  if (error) throw error;
  return mine.length;
}
