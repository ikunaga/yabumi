// 結合テストが使う、ローカルの Supabase の URL とキーを読む。
// vitest（NODE_ENV=test）では Next.js が .env.local を読まないので、ここで読む。
// 鍵はリポジトリに書かない（GitHub の push protection で止められるため）。値は `supabase status` で確かめられる
import { existsSync, readFileSync } from "node:fs";

// 先にあるファイルの値を優先する。.env.test.local（テスト専用）→ .env.local（開発用。ローカルの Supabase の値が入っている）
const FILES = [".env.test.local", ".env.local"];

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const fromFiles: Record<string, string> = {};
for (const f of [...FILES].reverse()) {
  if (existsSync(f)) Object.assign(fromFiles, parse(readFileSync(f, "utf8")));
}

// 名前の候補を順に見る（テスト用の名前 → 開発用の名前）
export function testEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n] ?? fromFiles[n];
    if (v) return v;
  }
  throw new Error(
    `結合テストに必要な ${names[0]} がありません。ローカルの Supabase を起動し（supabase start）、` +
      "`supabase status` に出る値を .env.local（または .env.test.local）に入れてください。README の「テスト」を参照。",
  );
}
