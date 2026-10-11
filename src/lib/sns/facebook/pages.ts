import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { Database } from "@/lib/supabase/database.types";
import { FACEBOOK_PERMISSIONS, type ManagedPage } from "./api";

// Facebook ページを選ぶまでの一時の置き場（pending_page_choices、15 分）。RLS を通らないクライアントで呼ぶ（docs/architecture.md の 4.21）
type Admin = SupabaseClient<Database>;

export type PageSummary = { id: string; name: string };

// 投稿を作れるページだけを置き、選ぶ画面の ID を返す。トークンは行の ID を追加認証データにして暗号化する
export async function savePageChoice(
  admin: Admin,
  args: { ownerId: string; projectId: string; parentExternalId: string; pages: ManagedPage[] },
  key?: Buffer,
): Promise<string> {
  const id = randomUUID();
  const postable = args.pages.filter((p) => p.canPost);
  const tokens = Object.fromEntries(postable.map((p) => [p.id, p.accessToken]));
  const { error } = await admin.from("pending_page_choices").insert({
    id,
    owner_id: args.ownerId,
    project_id: args.projectId,
    pages: postable.map((p) => ({ id: p.id, name: p.name })),
    tokens_encrypted: encryptToken(JSON.stringify(tokens), id, key),
    parent_external_id: args.parentExternalId,
  });
  if (error) throw error;
  return id;
}

export type ChooseResult = { projectId: string; accountIds: string[] };

// 選んだページをつなぐ。本人の・期限内の置き場だけを使い、使い終わったら消す（同じ置き場は 1 回しか使えない）
export async function choosePages(
  admin: Admin,
  args: { choiceId: string; ownerId: string; pageIds: string[] },
  key?: Buffer,
): Promise<ChooseResult | null> {
  // 先に消してから使う。同時に 2 回押されても、消せた 1 回だけが先へ進む
  const { data: rows, error } = await admin
    .from("pending_page_choices")
    .delete()
    .eq("id", args.choiceId)
    .eq("owner_id", args.ownerId)
    .gt("expires_at", new Date().toISOString())
    .select("project_id, pages, tokens_encrypted, parent_external_id");
  if (error) throw error;
  const row = rows?.[0];
  if (!row) return null;

  const pages = row.pages as PageSummary[];
  const tokens = JSON.parse(decryptToken(row.tokens_encrypted, args.choiceId, key)) as Record<string, string>;
  const accountIds: string[] = [];
  for (const pageId of args.pageIds) {
    const page = pages.find((p) => p.id === pageId);
    const token = tokens[pageId];
    if (!page || !token) continue;
    accountIds.push(
      await saveConnectedAccount(
        admin,
        {
          ownerId: args.ownerId,
          sns: "facebook",
          externalId: page.id,
          displayName: page.name,
          handle: "",
          accessToken: token,
          // 長期のユーザートークンから取ったページのトークンは期限がない
          expiresAt: null,
          scopes: FACEBOOK_PERMISSIONS,
          parentExternalId: row.parent_external_id,
        },
        key,
      ),
    );
  }
  return { projectId: row.project_id, accountIds };
}
