import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// スマホの通知（Web Push）を送る部品。伴走の声かけ（src/lib/coach/notify.ts）から呼ぶ。
// いまは形だけで、何も送らない（中身は feat/web-push で作る）。送るかどうか（設定・回数・時刻）は呼ぶ側が決める

type Db = SupabaseClient<Database>;

export type PushMessage = {
  // 30 字まで（超えたら「…」で切る）
  title: string;
  // 80 字まで（超えたら「…」で切る）。投稿の本文などの中身は入れない（ロック画面に出る）
  body: string;
  // 押したときに開く矢書の中のパス（「/」で始まるもの。ほかは「/」にする）
  url: string;
  // 同じ tag の通知は新しいもので置き換わる（例 pace:<projectId>）
  tag?: string;
};

export type PushResult = { sent: number; removed: number; failed: number };

// その利用者が登録したすべての端末に送る。端末がなければ { sent: 0 }
export async function sendPush(admin: Db, userId: string, msg: PushMessage): Promise<PushResult> {
  void [admin, userId, msg];
  return { sent: 0, removed: 0, failed: 0 };
}

// 通知を受け取る端末を 1 つ以上登録しているか
export async function hasPushDevice(admin: Db, userId: string): Promise<boolean> {
  void [admin, userId];
  return false;
}
