// ローカルの Supabase の JWT の署名鍵（ES256）を、なければ作る（supabase/signing_keys.json。gitignore）。
// 使い方: pnpm db:keys（ふつうは pnpm db:start が先に呼ぶ）
// ES256 にすると、ログインの確かめ（getClaims）がネットワークの問い合わせなしで済む（docs/deploy.md の 21）
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const path = "supabase/signing_keys.json";
if (existsSync(path)) {
  console.log(`${path} はもうあります（作り直しません）`);
  process.exit(0);
}
const out = execFileSync("pnpm", ["exec", "supabase", "gen", "signing-key", "--algorithm", "ES256"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const key = JSON.parse(out);
// config.toml の signing_keys_path は鍵の配列を読む
writeFileSync(path, JSON.stringify(Array.isArray(key) ? key : [key], null, 2) + "\n", { mode: 0o600 });
console.log(`${path} を作りました。supabase stop → supabase start で読み込みます`);
