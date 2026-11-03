// 外の AI が支払い・鍵の問題（402・403・401）で使えないとき（docs/architecture.md の 4.25 の ②）: 見分け方、運営者への知らせの中身、
// 利用者に出す文、Gemini と Claude の呼び出しでの扱い。本物の API は呼ばない（fetch と知らせを差し替える）
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const reported = vi.hoisted(() => [] as { provider: string; status: number }[]);
vi.mock("@/lib/ai/provider-failure-report", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/ai/provider-failure-report")>();
  return {
    ...mod,
    reportAiUnavailable: vi.fn(async (e: { provider: string; status: number }) => {
      reported.push({ provider: e.provider, status: e.status });
      return "sent" as const;
    }),
  };
});

import { generateWithGemini, ImageBlockedError } from "@/lib/ai/gemini-image";
import { callConsult, guardUnavailable } from "@/lib/ai/anthropic";
import { tokenCounterOf } from "@/lib/ai/budget";
import { AI_UNAVAILABLE_MESSAGE, AiRequestRejected, AiUnavailableError, aiFailureMessage, isUnavailableResponse, notBilled } from "@/lib/ai/provider-failure";
import { unavailableKey, unavailableMail } from "@/lib/ai/provider-failure-report";

const SECRET = "test-secret-key-do-not-mail";

beforeEach(() => {
  reported.length = 0;
  vi.stubEnv("GEMINI_API_KEY", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("見分け方", () => {
  it("401・402・403 は支払い・鍵の問題。Claude は残高が足りないときの 400 も。ほかの失敗（429・500・ふつうの 400）は違う", () => {
    for (const s of [401, 402, 403]) {
      expect(isUnavailableResponse("gemini", s)).toBe(true);
      expect(isUnavailableResponse("anthropic", s)).toBe(true);
    }
    expect(isUnavailableResponse("anthropic", 400, "Your credit balance is too low to access the Anthropic API.")).toBe(true);
    expect(isUnavailableResponse("gemini", 400, "credit balance")).toBe(false);
    for (const s of [400, 429, 500, 503]) expect(isUnavailableResponse("gemini", s)).toBe(false);
  });
});

describe("運営者への知らせの中身", () => {
  it("状態番号と、直す場所の手がかり（402 は課金、403 は API の有効化・鍵の制限、401 は鍵の値）。鍵は書かない", () => {
    const m402 = unavailableMail("gemini", 402);
    expect(m402.subject).toContain("402");
    expect(m402.text).toContain("課金");
    expect(unavailableMail("gemini", 403).text).toMatch(/有効.*鍵の制限/);
    expect(unavailableMail("gemini", 401).text).toContain("GEMINI_API_KEY の値");
    expect(unavailableMail("anthropic", 402).text).toContain("Billing");
    expect(unavailableMail("anthropic", 401).text).toContain("ANTHROPIC_API_KEY の値");
    for (const p of ["gemini", "anthropic"] as const) for (const s of [401, 402, 403]) expect(JSON.stringify(unavailableMail(p, s))).not.toContain(SECRET);
  });

  it("知らせの名前は、AI の種類と状態番号ごと（同じ理由だけを間引く）", () => {
    expect(unavailableKey("gemini", 402)).toBe("ai_unavailable:gemini:402");
    expect(unavailableKey("gemini", 402)).not.toBe(unavailableKey("gemini", 403));
    expect(unavailableKey("anthropic", 402)).not.toBe(unavailableKey("gemini", 402));
  });

  it("利用者に出す文は「いま使えない（運営者に知らせた）」。ほかの失敗は呼ぶ側の文のまま", () => {
    expect(aiFailureMessage(new AiUnavailableError("gemini", 402), "時間をおいて")).toBe(AI_UNAVAILABLE_MESSAGE.gemini);
    expect(aiFailureMessage(new AiUnavailableError("anthropic", 401), "時間をおいて")).toBe("AI はいま使えません（運営者に知らせました）。");
    expect(aiFailureMessage(new Error("timeout"), "時間をおいて")).toBe("時間をおいて");
    for (const m of Object.values(AI_UNAVAILABLE_MESSAGE)) expect(m).not.toContain("時間をおいて");
  });
});

describe("Gemini の画像", () => {
  const reply = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("402・403・401 は AiUnavailableError にして、運営者に知らせる", async () => {
    for (const status of [402, 403, 401]) {
      reply(status, { error: { message: "billing / permission / key" } });
      const e = await generateWithGemini({ prompt: "p", aspectRatio: "4:5" }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AiUnavailableError);
      expect(e).toMatchObject({ provider: "gemini", status });
    }
    expect(reported).toEqual([
      { provider: "gemini", status: 402 },
      { provider: "gemini", status: 403 },
      { provider: "gemini", status: 401 },
    ]);
  });

  it("500 は今までどおりのふつうの失敗、安全の決まりは ImageBlockedError。どちらも知らせない", async () => {
    reply(500, { error: { message: "internal" } });
    const e500 = await generateWithGemini({ prompt: "p", aspectRatio: "4:5" }).catch((x: unknown) => x);
    expect(e500).not.toBeInstanceOf(AiUnavailableError);
    expect(String(e500)).toContain("Gemini API 500");
    reply(400, { error: { message: "blocked by safety policy" } });
    await expect(generateWithGemini({ prompt: "p", aspectRatio: "4:5" })).rejects.toBeInstanceOf(ImageBlockedError);
    expect(reported).toEqual([]);
  });
});

describe("Claude（Anthropic）", () => {
  const apiError = (status: number, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers());

  it("401・402・403 と、残高が足りないときの 400 は AiUnavailableError にして、運営者に知らせる", async () => {
    for (const [status, msg] of [
      [401, "invalid x-api-key"],
      [402, "billing"],
      [403, "permission"],
      [400, "Your credit balance is too low to access the Anthropic API."],
    ] as const) {
      const report = vi.fn(async () => "sent" as const);
      const e = await guardUnavailable(() => Promise.reject(apiError(status, msg)), report).catch((x: unknown) => x);
      expect(e).toMatchObject({ name: "AiUnavailableError", provider: "anthropic", status });
      expect(report).toHaveBeenCalledTimes(1);
    }
  });

  it("500・529・408・つながらない・返事を読めないときは、そのまま投げて知らせない（請求されたかわからないので、予約は見込みの額のまま数える。M3）", async () => {
    for (const err of [apiError(500, "server"), apiError(529, "overloaded"), apiError(408, "timeout"), new Error("fetch failed")]) {
      const report = vi.fn(async () => "sent" as const);
      const e = await guardUnavailable(() => Promise.reject(err), report).catch((x: unknown) => x);
      expect(e).toBe(err);
      expect(notBilled(e)).toBe(false);
      expect(report).not.toHaveBeenCalled();
    }
    expect(await guardUnavailable(async () => 42)).toBe(42);
  });

  it("ふつうの 4xx（400・404・413）は AiRequestRejected にする（処理されずに断られたので、予約を消してよい）。知らせない", async () => {
    for (const status of [400, 404, 413]) {
      const report = vi.fn(async () => "sent" as const);
      const e = await guardUnavailable(() => Promise.reject(apiError(status, "bad")), report).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AiRequestRejected);
      expect(e).toMatchObject({ status });
      expect(notBilled(e)).toBe(true);
      expect(report).not.toHaveBeenCalled();
    }
    expect(notBilled(new AiUnavailableError("anthropic", 402))).toBe(true);
  });

  it("429 だけは 2 回までやり直す（retry-after を待つ）。3 回とも 429 なら AiRequestRejected", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    let n = 0;
    const ok = await guardUnavailable(
      async () => {
        n++;
        if (n < 3) throw Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "rate" } }, "rate", new Headers(n === 1 ? { "retry-after": "3" } : {}));
        return "done";
      },
      undefined,
      wait,
    );
    expect(ok).toBe("done");
    expect(waits).toEqual([3000, 2000]);
    let calls = 0;
    const e = await guardUnavailable(
      () => {
        calls++;
        return Promise.reject(apiError(429, "rate"));
      },
      undefined,
      wait,
    ).catch((x: unknown) => x);
    expect(calls).toBe(3);
    expect(e).toBeInstanceOf(AiRequestRejected);
    // 500 はやり直さない（1 回目が請求されていると、予約の見込みを超える）
    let calls500 = 0;
    await guardUnavailable(() => {
      calls500++;
      return Promise.reject(apiError(500, "server"));
    }, undefined, wait).catch(() => undefined);
    expect(calls500).toBe(1);
  });

  it("送る前に数える（count_tokens）ときも、429 は同じくやり直す。数えるのは count_tokens の URL だけ（生成は呼ばない）", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    const urls: string[] = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        urls.push(String(url instanceof Request ? url.url : url));
        n++;
        if (n === 1) return new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "rate" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "0.01" } });
        return new Response(JSON.stringify({ input_tokens: 1234 }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const count = tokenCounterOf(callConsult)!;
    expect(await count({ system: [{ type: "text", text: "相談" }], messages: [{ role: "user", content: [{ type: "text", text: "こんにちは" }] }] })).toBe(1234);
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(u).toMatch(/\/v1\/messages\/count_tokens/);
  });
});
