import type { NextRequest } from "next/server";
import { revokeAccountsByExternalId } from "@/lib/sns/accounts";
import { instagramConfig } from "@/lib/sns/instagram/config";
import { handleDeauthorize } from "@/lib/sns/meta/callbacks";
import { createAdminClient } from "@/lib/supabase/admin";

// Deauthorize callback URL: 利用者が Instagram の設定から矢書を外したとき。トークンを消し「解除済み」にする（行は残す）
export async function POST(request: NextRequest) {
  return handleDeauthorize(request, instagramConfig().appSecret, (p) => revokeAccountsByExternalId(createAdminClient(), "instagram", p.user_id));
}
