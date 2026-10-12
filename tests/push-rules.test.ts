// スマホの通知（Web Push。docs/architecture.md の 4.28）の決まり。push サービスには送らない
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { clip, deviceLabel, isAllowedEndpoint, safePath } from "@/lib/push/rules";
import { buildPayload, topicOf } from "@/lib/push/send";

describe("宛先のホスト", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://web.push.apple.com/QGh1",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("%s は受け付ける", (url) => {
    expect(isAllowedEndpoint(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/push.apple.com",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://notify.windows.com/x",
    "not a url",
  ])("%s は受け付けない（サーバーから任意の URL を呼ばせない）", (url) => {
    expect(isAllowedEndpoint(url)).toBe(false);
  });
});

describe("文の長さと開く URL", () => {
  it("決まった字数で切り、「…」を付ける。絵文字を途中で割らない", () => {
    expect(clip("今週の投稿、あと 2 本です", 30)).toBe("今週の投稿、あと 2 本です");
    expect(clip("あ".repeat(31), 30)).toBe(`${"あ".repeat(29)}…`);
    expect(Array.from(clip("😀".repeat(40), 30))).toHaveLength(30);
    expect(clip("  改行\nと  空白  ", 30)).toBe("改行 と 空白");
  });

  it("矢書の中のパスだけを開く", () => {
    expect(safePath("/projects/abc/compose")).toBe("/projects/abc/compose");
    expect(safePath("/projects/abc?x=1#y")).toBe("/projects/abc?x=1#y");
    expect(safePath("//evil.example/x")).toBe("/");
    expect(safePath("/\\evil.example")).toBe("/");
    expect(safePath("https://evil.example/")).toBe("/");
    expect(safePath("javascript:alert(1)")).toBe("/");
    expect(safePath("projects")).toBe("/");
  });

  it("送る中身: 題 30 字・本文 80 字で切り、URL を確かめる", () => {
    const p = buildPayload({ title: "題".repeat(40), body: "本".repeat(100), url: "https://evil.example", tag: "pace:p1" });
    expect(Array.from(p.title)).toHaveLength(30);
    expect(Array.from(p.body)).toHaveLength(80);
    expect(p.url).toBe("/");
    expect(p.tag).toBe("pace:p1");
    expect(buildPayload({ title: " ", body: "", url: "/projects" })).toEqual({ title: "矢書", body: "", url: "/projects" });
  });

  it("Topic は URL で使える 32 字まで（同じ tag なら同じ）", () => {
    const t = topicOf("pace:0b9c3a3e-1111-2222-3333-444455556666");
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(topicOf("pace:0b9c3a3e-1111-2222-3333-444455556666")).toBe(t);
    expect(topicOf("weekly:x")).not.toBe(t);
  });
});

describe("端末の名前", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "iPhone"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36", "Android の Chrome"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", "Mac の Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0", "Windows の Edge"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0", "Mac の Firefox"],
    ["", "この端末"],
  ])("%s → %s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});

describe("web-push のライブラリに渡す設定", () => {
  it("VAPID の署名・aes128gcm の暗号化・TTL・Urgency・Topic の見出しが付く（送らずに、送る内容だけを作る）", () => {
    const vapid = webpush.generateVAPIDKeys();
    // ブラウザの側の鍵（P-256 の公開鍵 65 バイトと、合言葉 16 バイト）
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    };
    const d = webpush.generateRequestDetails(sub, JSON.stringify(buildPayload({ title: "t", body: "b", url: "/" })), {
      vapidDetails: { subject: "mailto:ops@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 86400,
      urgency: "normal",
      topic: topicOf("pace:x"),
    });
    expect(d.endpoint).toBe(sub.endpoint);
    expect(d.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(d.headers.TTL).toBe(86400);
    expect(d.headers.Urgency).toBe("normal");
    expect(d.headers.Topic).toBe(topicOf("pace:x"));
    expect(d.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
    // 本文は暗号化されていて、そのままの文は入っていない
    expect(d.body!.toString("utf8")).not.toContain('"title"');
  });
});
