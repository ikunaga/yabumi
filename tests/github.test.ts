// GitHub App の認証と、リポジトリから読むファイルの選び方。本物の GitHub は呼ばない
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAppJwt, normalizePrivateKey } from "@/lib/github/app-auth";
import { MAX_FILE_CHARS, MAX_LISTED_PATHS, MAX_PICKED_FILES, MAX_TOTAL_CHARS, isSecretPath, listCandidates, readSelectedFiles, redactSecrets, selectFiles, validatePicks } from "@/lib/github/repo-reader";
import type { TreeEntry } from "@/lib/github/api";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

describe("GitHub App の JWT", () => {
  it("RS256 で署名し、iss は App ID、期限は 10 分以内", () => {
    const now = new Date("2026-10-04T00:00:00Z");
    const jwt = createAppJwt("12345", privateKey, now);
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload.iss).toBe("12345");
    expect(payload.iat).toBe(now.getTime() / 1000 - 60);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it(".env に 1 行で書いた鍵（改行が \\n）も使える", () => {
    const oneLine = privateKey.replace(/\n/g, "\\n");
    expect(normalizePrivateKey(oneLine)).toBe(privateKey);
    expect(() => createAppJwt("1", oneLine)).not.toThrow();
  });
});

const blob = (path: string, size = 1000): TreeEntry => ({ path, type: "blob", size });

describe("読むファイルの選び方", () => {
  it("README、設定ファイル、docs の順に選ぶ", () => {
    const picked = selectFiles([
      blob("docs/guide/deep/a.md"),
      blob("docs/overview.md"),
      blob("package.json"),
      blob("README.md"),
      blob("src/index.ts"),
      blob("ios/App/Info.plist"),
      blob("android/app/build.gradle"),
      { path: "docs", type: "tree" },
    ]);
    expect(picked).toEqual(["README.md", "package.json", "ios/App/Info.plist", "android/app/build.gradle", "docs/overview.md", "docs/guide/deep/a.md"]);
  });

  it("秘密が入りがちなファイルは読まない", () => {
    for (const p of [".env", ".env.local", "config/.env.production", "key.pem", "AuthKey_ABC.p8", "android/app/release.keystore", "ios/GoogleService-Info.plist", "android/app/google-services.json", "credentials.json", "secrets.yaml", ".npmrc", "android/key.properties", "id_rsa"]) {
      expect(isSecretPath(p), p).toBe(true);
    }
    expect(selectFiles([blob("README.md"), blob(".env"), blob("docs/secrets.md")])).toEqual(["README.md"]);
    expect(isSecretPath("README.md")).toBe(false);
  });

  it("依存物の中や、大きすぎるファイルは読まない。docs は 8 件まで", () => {
    expect(selectFiles([blob("node_modules/x/README.md"), blob("ios/Pods/Info.plist"), blob("README.md", 10_000_000)])).toEqual([]);
    const docs = Array.from({ length: 12 }, (_, i) => blob(`docs/d${i}.md`));
    expect(selectFiles(docs)).toHaveLength(8);
  });

  it("鍵やトークンらしき文字列を伏せる", () => {
    // 鍵の形の文字列は、リポジトリに書くと GitHub の push protection で止められるので、組み立てて作る
    const fakeGitHubToken = ["gh", "p_", "a".repeat(36)].join("");
    const fakeKeyBlock = ["-----BEGIN RSA ", "PRIVATE KEY-----\nabc\n-----END RSA ", "PRIVATE KEY-----"].join("");
    const text = [
      `"apiKey": "${["AI", "za", "SyD-1234567890abcdefghijklmnopqrstu"].join("")}"`,
      `token=${fakeGitHubToken}`,
      fakeKeyBlock,
      'password: "hunter2hunter2"',
      "name: my-app",
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toContain(fakeGitHubToken);
    expect(out).not.toContain("BEGIN RSA");
    expect(out).not.toMatch(/AIza|hunter2/);
    expect(out).toContain("name: my-app");
  });

  it("1 ファイルと全体の上限で切り、読めないものや中身がバイナリのものは飛ばす", async () => {
    const big = "あ".repeat(MAX_FILE_CHARS + 10);
    const contents: Record<string, string> = { "README.md": big, "a.json": "\u0000\u0001", "b.md": "x".repeat(MAX_TOTAL_CHARS) };
    const { files, skipped } = await readSelectedFiles(["README.md", "a.json", "missing", "b.md", "c.md"], async (p) => {
      if (!(p in contents)) throw new Error("404");
      return contents[p];
    });
    expect(files[0]).toMatchObject({ path: "README.md", truncated: true });
    expect(files[0].content.length).toBe(MAX_FILE_CHARS);
    expect(files.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
    expect(skipped).toEqual(["a.json", "missing", "c.md"]);
  });

  it("AI に見せる一覧からも、秘密・依存物・画像・ロックファイルを除き、浅い順に上限で切る", () => {
    const { files, truncated } = listCandidates([
      blob("front/src/app/page.tsx"),
      blob(".env.local"),
      blob("front/.env"),
      blob("node_modules/a/index.js"),
      blob("front/public/logo.png"),
      blob("pnpm-lock.yaml"),
      blob("README.md"),
      blob("front/README.md"),
    ]);
    expect(files.map((f) => f.path)).toEqual(["README.md", "front/README.md", "front/src/app/page.tsx"]);
    expect(truncated).toBe(false);
    expect(listCandidates(Array.from({ length: MAX_LISTED_PATHS + 5 }, (_, i) => blob(`docs/${i}.md`))).truncated).toBe(true);
  });

  it("AI が選んだファイルも確かめる（一覧にないもの・秘密のものは読まない。件数の上限）", () => {
    const entries = [blob("README.md"), blob(".env"), blob("front/README.md"), ...Array.from({ length: 20 }, (_, i) => blob(`docs/${i}.md`))];
    expect(validatePicks(["./README.md", ".env", "missing.md", "front/README.md", "README.md"], entries)).toEqual(["README.md", "front/README.md"]);
    expect(validatePicks(entries.map((e) => e.path), entries)).toHaveLength(MAX_PICKED_FILES);
  });

  it("予備の選び方でも、モノレポの各アプリの README と設定を読む", () => {
    expect(selectFiles([blob("README.md"), blob("front/README.md"), blob("front/package.json"), blob("CLAUDE.md")])).toEqual(["README.md", "CLAUDE.md", "front/README.md", "front/package.json"]);
  });
});
