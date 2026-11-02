// 本番に出すたびに、いまの版の名前を public/version.json に書く（docs/architecture.md の 4.35）。
// 開いたままの画面が、画面に戻ってきたときなどにこのファイルを読み、自分の版（<html data-app-version>）と違えば「新しい版があります」を出す。
// 静的なファイルなので、読んでも Vercel の関数は動かない（費用が増えない）。版の名前は Vercel のデプロイの ID（ローカルでは null で、知らせは出ない）
import { writeFileSync } from "node:fs";

const id = process.env.VERCEL_DEPLOYMENT_ID || null;
writeFileSync(new URL("../public/version.json", import.meta.url), `${JSON.stringify({ id })}\n`);
console.log(`[write-version] ${id ?? "(なし)"}`);
