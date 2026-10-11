import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// 利用者から預かるストア・課金の鍵（App Store Connect の API キー、RevenueCat の鍵）の暗号化（docs/architecture.md の 4.22）。
// SNS のトークン（token-cipher.ts、TOKEN_ENCRYPTION_KEY）とは別の鍵 CREDENTIAL_ENCRYPTION_KEY を使う（片方が漏れても、もう片方は読めない）。
// 形式: c1.<鍵の印>.<iv>.<tag>.<暗号文>（鍵の印は鍵の sha256 の先頭 8 桁）。
// 鍵の入れ替え: 新しい鍵を CREDENTIAL_ENCRYPTION_KEY に、古い鍵を CREDENTIAL_ENCRYPTION_KEYS_OLD（カンマ区切り）に入れる。
// 古い鍵で暗号化したものも読め、読んだときに needsReseal が true になるので、新しい鍵で暗号化し直して保存する（store.ts）。
// すべて新しい鍵になったら（毎日の取り込みで 1〜2 日）、古い鍵を外す。手順は docs/deploy.md の 13

const PREFIX = "c1";

export type CredentialKeys = { current: Buffer; old: Buffer[] };

function parseOne(base64: string, name: string): Buffer {
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== 32) throw new Error(`${name} は 32 バイトを base64 にした値にしてください（openssl rand -base64 32）。`);
  return key;
}

export function credentialKeysFromEnv(env: { current?: string; old?: string } = { current: process.env.CREDENTIAL_ENCRYPTION_KEY, old: process.env.CREDENTIAL_ENCRYPTION_KEYS_OLD }): CredentialKeys {
  if (!env.current) throw new Error("環境変数 CREDENTIAL_ENCRYPTION_KEY が設定されていません。.env.example を参考に設定してください。");
  return {
    current: parseOne(env.current, "CREDENTIAL_ENCRYPTION_KEY"),
    old: (env.old ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseOne(s, "CREDENTIAL_ENCRYPTION_KEYS_OLD")),
  };
}

export function credentialsConfigured(): boolean {
  return Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY);
}

export function keyMark(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function sealCredential(plain: string, aad: string, keys: CredentialKeys = credentialKeysFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.current, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, keyMark(keys.current), iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

// 開ける。古い鍵で暗号化したものなら needsReseal が true（新しい鍵で暗号化し直す）
export function openCredential(sealed: string, aad: string, keys: CredentialKeys = credentialKeysFromEnv()): { plain: string; needsReseal: boolean } {
  const [prefix, mark, iv, tag, body] = sealed.split(".");
  if (prefix !== PREFIX || !mark || !iv || !tag || body === undefined) throw new Error("預かった鍵の形式が正しくありません");
  const key = [keys.current, ...keys.old].find((k) => keyMark(k) === mark);
  if (!key) throw new Error("預かった鍵を開く鍵が見つかりません（CREDENTIAL_ENCRYPTION_KEY を入れ替えたあと、古い鍵を CREDENTIAL_ENCRYPTION_KEYS_OLD に残していない）");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  return { plain, needsReseal: key !== keys.current };
}
