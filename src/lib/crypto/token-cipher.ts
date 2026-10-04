import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// SNS のトークンを DB に入れる前に暗号化する（AES-256-GCM）。
// 鍵は環境変数 TOKEN_ENCRYPTION_KEY（32 バイトを base64 にしたもの）。置き場所と入れ替え方は docs/architecture.md の 4.6。
// 形式: v1.<iv>.<tag>.<暗号文>（それぞれ base64url）。v1 は鍵の世代で、入れ替えるときに v2 を足す。
// aad には行の ID などを渡し、別の行の暗号文を差し替えても復号できないようにする。

const VERSION = "v1";

export function parseKey(base64: string | undefined): Buffer {
  if (!base64) {
    throw new Error("環境変数 TOKEN_ENCRYPTION_KEY が設定されていません。.env.example を参考に設定してください。");
  }
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY は 32 バイトを base64 にした値にしてください（openssl rand -base64 32）。");
  }
  return key;
}

export function encryptToken(plain: string, aad: string, key: Buffer = parseKey(process.env.TOKEN_ENCRYPTION_KEY)): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptToken(sealed: string, aad: string, key: Buffer = parseKey(process.env.TOKEN_ENCRYPTION_KEY)): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) {
    throw new Error("暗号化されたトークンの形式が正しくありません");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
