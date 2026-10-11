import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 並列の数と時間の上限（README の「テスト」）。結合テストは、同じマシンの他の作業と共有のローカルの Supabase に、
// テストのファイルごとに利用者を作って問い合わせる。並列が多いと認証サーバーと DB が詰まり、毎回ちがう場所で時間切れになる（2026-10-11、50 ファイル）
// 3 は、3 人が同時に全体を流しても通った数（2026-10-11 に測った。4 だと API の入り口が 502 を返すことがあった）
const maxWorkers = Number(process.env.YABUMI_TEST_WORKERS) || 3;

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    maxWorkers,
    // 共有の DB が混んでいても、1 つの問い合わせの遅れで落ちないように（既定は 5 秒と 10 秒）
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
