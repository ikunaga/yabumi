import { createSign } from "node:crypto";

// GitHub App としての認証（https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app）。
// App の秘密鍵で JWT（RS256、10 分以内）を作り、それでインストールのトークン（1 時間）を発行する。
// トークンは保存せず、読むたびに発行する。

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

// .env では改行を \n と書けるようにする
export function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function createAppJwt(appId: string, privateKeyPem: string, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000) - 60; // 時計のずれに備えて 60 秒前にする（GitHub の推奨）
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(normalizePrivateKey(privateKeyPem)).toString("base64url")}`;
}
