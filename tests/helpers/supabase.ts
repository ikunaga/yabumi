// 結合テスト用。ローカルの Supabase（supabase start）が必要。URL とキーは .env.local から読む（./env.ts）
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { testEnv } from "./env";
import { acquireSlot } from "./lock";

export const url = testEnv("SUPABASE_TEST_URL", "NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = testEnv("SUPABASE_TEST_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
// RLS を通らないキー。ローカルの Supabase のもの（`supabase status` の Secret key）
const secretKey = testEnv("SUPABASE_TEST_SECRET_KEY", "SUPABASE_SECRET_KEY");

export type TestClient = SupabaseClient<Database>;

// 共有のローカル Supabase に同時に問い合わせる結合テストのファイルを、同じマシン全体（ほかのセッションの `pnpm test` も含む）で
// DB_SLOTS 個までにする。3 人が同時に流すと 9 ファイルが並び、API の入り口（Kong）が 502 を返したり、時間切れになったりしていた
// （2026-10-12、README の「テスト」）。このファイルを読み込んだ結合テストのファイルは、最初に席を取り、終わったら外す
const DB_SLOTS = Number(process.env.YABUMI_TEST_DB_SLOTS) || 4;
let releaseSlot: () => void = () => {};
// 席が空くのを待つ時間の分、フックの時間の上限を延ばす
beforeAll(async () => {
  releaseSlot = await acquireSlot("db-slot", DB_SLOTS);
}, 10 * 60_000);
afterAll(() => releaseSlot());

// ローカルの Supabase の入り口（Kong）は、PostgREST が閉じたばかりの使い回しの接続に送ってしまうことがあり、
// そのときは「An invalid response was received from the upstream server」（502、Kong のログは upstream prematurely closed connection）になる。
// PostgREST（warp）は空いた接続を 30 秒ほどで閉じ、Kong は 60 秒まで使い回すため（負荷とは関係なく、まれに起きる）。
// 届く前に切れているので、テストでは 502 のときだけ少し待って 2 回まで送り直す（2026-10-12、README の「テスト」）。
// 送り直せない本文（ストリーム）のときは送り直さない
async function fetchRetrying502(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const body = init?.body;
  const replayable = body == null || typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof Blob || body instanceof FormData || body instanceof URLSearchParams;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 502 || !replayable || attempt >= 2) return res;
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
  }
}

export function anonClient(): TestClient {
  return createClient<Database>(url, publishableKey, { auth: { persistSession: false }, global: { fetch: fetchRetrying502 } });
}

// RLS を通らないサーバー用のクライアント。OAuth の受け口がやることの代わりに使う
export function adminClient(): TestClient {
  return createClient<Database>(url, secretKey, { auth: { persistSession: false }, global: { fetch: fetchRetrying502 } });
}

// テスト用の利用者を作ってログインする。確認メールを有効にしている（本番と同じ）ので、画面からの登録ではなく、確認済みの利用者を secret キーで作る。
// パスワードは付けず、マジックリンク（メールは送らない）でログインする。パスワードの登録とログインは、認証サーバーでハッシュ（bcrypt）を 2 回計算するので、
// テストを並列で流すと認証サーバーが詰まり、利用者を作るところで 5〜10 秒の時間切れが起きていた（2026-10-11、README の「テスト」）
export async function signUpNewUser(): Promise<{ client: TestClient; userId: string }> {
  const email = `rls-${randomUUID()}@example.com`;
  const admin = adminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createError) throw createError;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  const client = anonClient();
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error) throw error;
  return { client, userId: created.user.id };
}

// テストの利用者を消す。費用の記録（ai_usage、sns_api_usage）は利用者を消しても持ち主を空にして残る決まり（4.14）なので、先に消す。
// 残すと、共有のローカル DB で矢書全体の今月の合計が増え続け、全体の上限に達してオーナーが AI や X を使えなくなる。
// Google Play の読み取り用のアカウントを作った記録（play_account_creations）も、退会しても 30 日残る決まりなので消す。
// 残すと、全員の上限（直近 30 日に 80）に届いて、play のテストが「混み合っています」で落ちる（2026-10-12、README の「テスト」）
export async function deleteUser(userId: string) {
  const admin = adminClient();
  await admin.from("ai_usage").delete().eq("owner_id", userId);
  await admin.from("sns_api_usage").delete().eq("owner_id", userId);
  await admin.from("play_account_creations").delete().eq("owner_id", userId);
  await admin.auth.admin.deleteUser(userId);
}
