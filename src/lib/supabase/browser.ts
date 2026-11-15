"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

// 画面（ブラウザ）用。いまは画像・動画を Storage に上げるときだけ使う（利用者のログインのまま、Storage の insert のポリシーを通す。
// docs/design/video.md の 11.）。ログインの cookie は proxy.ts とサーバーが更新する
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;
export function browserClient() {
  client ??= createBrowserClient<Database>(supabaseUrl, supabasePublishableKey);
  return client;
}
