import type { NextRequest } from "next/server";
import { revokeAccountsByParentId } from "@/lib/sns/accounts";
import { facebookAppSecret } from "@/lib/sns/facebook/config";
import { handleDeauthorize } from "@/lib/sns/meta/callbacks";
import { createAdminClient } from "@/lib/supabase/admin";

// Deauthorize callback URL: 利用者が Facebook の設定から矢書を外したとき。その人がつないだページを「解除済み」にする
export async function POST(request: NextRequest) {
  return handleDeauthorize(request, facebookAppSecret(), (p) => revokeAccountsByParentId(createAdminClient(), "facebook", p.user_id));
}
