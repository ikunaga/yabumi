import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSignedRequest } from "@/lib/sns/threads/signed-request";

const secret = "app-secret";

function sign(payload: object, key = secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${sig}.${body}`;
}

describe("signed_request の検証", () => {
  it("正しい署名なら user_id を返す", () => {
    const r = parseSignedRequest(sign({ algorithm: "HMAC-SHA256", issued_at: 1, user_id: 12345 }), secret);
    expect(r?.user_id).toBe("12345");
  });

  it("別のシークレットで署名されたものは通さない", () => {
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "other"), secret)).toBeNull();
  });

  it("中身を書き換えたものは通さない", () => {
    const [sig] = sign({ algorithm: "HMAC-SHA256", user_id: "1" }).split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "2" })).toString("base64url");
    expect(parseSignedRequest(`${sig}.${forged}`, secret)).toBeNull();
  });

  it("形式が違うものは通さない", () => {
    expect(parseSignedRequest("abc", secret)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "none", user_id: "1" }), secret)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }), secret)).toBeNull();
  });
});
