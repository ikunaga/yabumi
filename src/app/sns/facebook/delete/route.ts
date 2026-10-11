import type { NextRequest } from "next/server";
import { deleteAccountsByParentId } from "@/lib/sns/accounts";
import { facebookAppSecret } from "@/lib/sns/facebook/config";
import { handleDataDeletion } from "@/lib/sns/meta/callbacks";
import { createAdminClient } from "@/lib/supabase/admin";

// Data deletion callback URL: 利用者が Facebook の側でデータの削除を求めたとき。その人がつないだページのアカウントとトークンを消す
export async function POST(request: NextRequest) {
  return handleDataDeletion(request, facebookAppSecret(), "facebook", (p) => deleteAccountsByParentId(createAdminClient(), "facebook", p.user_id));
}
