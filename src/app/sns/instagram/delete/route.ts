import type { NextRequest } from "next/server";
import { deleteAccountsByExternalId } from "@/lib/sns/accounts";
import { instagramConfig } from "@/lib/sns/instagram/config";
import { handleDataDeletion } from "@/lib/sns/meta/callbacks";
import { createAdminClient } from "@/lib/supabase/admin";

// Data deletion request URL: 利用者がデータの削除を求めたとき。アカウントとトークンを消す
export async function POST(request: NextRequest) {
  return handleDataDeletion(request, instagramConfig().appSecret, "instagram", (p) =>
    deleteAccountsByExternalId(createAdminClient(), "instagram", p.user_id),
  );
}
