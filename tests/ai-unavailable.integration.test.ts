// AI が使えないときの運営者への知らせの間引き（同じ理由は 1 時間に 1 回まで）。Resend は偽物の fetch で、本物には送らない。
// 知らせの記録は、このテストだけの名前（scope）にして、終わったら消す
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AiUnavailableError } from "@/lib/ai/provider-failure";
import { reportAiUnavailable, unavailableKey } from "@/lib/ai/provider-failure-report";
import { adminClient } from "./helpers/supabase";

const admin = adminClient();
const SCOPE = `test-${randomUUID()}`;
const sent = () => vi.fn(async () => new Response(JSON.stringify({ id: "mail-1" }), { status: 200 }));
const notify = (f: ReturnType<typeof vi.fn>) => ({ fetch: f as unknown as typeof fetch, apiKey: "re_test", to: "operator@yabumi.test", from: "yabumi <noreply@yabumi.test>" });

afterAll(async () => {
  await admin.from("operator_notifications").delete().like("key", `%:${SCOPE}`);
});

describe("運営者への知らせの間引き", () => {
  it("同じ理由は 1 時間に 1 回だけ送る。理由（状態番号・AI の種類）が違えば別に送る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = sent();
    const report = (provider: "gemini" | "anthropic", status: number) => reportAiUnavailable(new AiUnavailableError(provider, status), { admin, notify: notify(f), scope: SCOPE });
    expect(await report("gemini", 402)).toBe("sent");
    expect(await report("gemini", 402)).toBe("skipped");
    expect(await report("gemini", 403)).toBe("sent");
    expect(await report("anthropic", 402)).toBe("sent");
    expect(f).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.subject).toContain("402");
    expect(body.text).toContain("課金");
  });

  it("1 時間たてば、また送る（記録の時刻を 1 時間より前にして確かめる）", async () => {
    const key = unavailableKey("gemini", 401, SCOPE);
    const f = sent();
    const report = () => reportAiUnavailable(new AiUnavailableError("gemini", 401), { admin, notify: notify(f), scope: SCOPE });
    expect(await report()).toBe("sent");
    expect(await report()).toBe("skipped");
    await admin.from("operator_notifications").update({ sent_at: new Date(Date.now() - 61 * 60 * 1000).toISOString() }).eq("key", key);
    expect(await report()).toBe("sent");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("送れなかったときは記録を残さず、次の失敗でまた知らせる。知らせが壊れても例外にしない", async () => {
    const bad = vi.fn(async () => new Response("bad", { status: 500 }));
    const report = (f: ReturnType<typeof vi.fn>) => reportAiUnavailable(new AiUnavailableError("anthropic", 401), { admin, notify: notify(f), scope: SCOPE });
    expect(await report(bad)).toBe("failed");
    expect(await report(sent())).toBe("sent");
    const broken = { rpc: async () => ({ data: null, error: new Error("db down") }) } as unknown as typeof admin;
    expect(await reportAiUnavailable(new AiUnavailableError("gemini", 402), { admin: broken, scope: SCOPE })).toBe("error");
  });
});
