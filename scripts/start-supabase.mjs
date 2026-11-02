// ローカルの Supabase を、JWT の署名鍵 ES256 で起動する（pnpm db:start）。docs/deploy.md の 21。
// config.toml の signing_keys_path は、鍵のファイルがないとすべての supabase のコマンド（migration up・gen types など）が止まるので、
// リポジトリでは閉じたまま（HS256 で動く）にしておき、起動するあいだだけ開く。鍵がなければ先に作る（pnpm db:keys と同じ）
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

execFileSync("node", ["scripts/ensure-signing-key.mjs"], { stdio: "inherit" });
const path = "supabase/config.toml";
const original = readFileSync(path, "utf8");
const line = '# signing_keys_path = "./signing_keys.json"';
if (!original.includes(line)) throw new Error(`${path} に「${line}」が見つかりません`);
writeFileSync(path, original.replace(line, 'signing_keys_path = "./signing_keys.json"'));
try {
  const r = spawnSync("pnpm", ["exec", "supabase", "start"], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
} finally {
  writeFileSync(path, original);
}
