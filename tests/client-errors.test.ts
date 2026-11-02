// 画面から server action を呼んで失敗したときの扱い（src/lib/client-errors.ts。docs/architecture.md の 4.35）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { actionFailure, callAction, formValues, guardAction, isStaleError, STALE_EVENT } from "@/lib/client-errors";

function unrecognized() {
  const e = new Error('Server Action "7f00abc" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');
  e.name = "UnrecognizedActionError";
  return e;
}

let online = true;
let events: string[] = [];
beforeEach(() => {
  online = true;
  events = [];
  vi.stubGlobal("navigator", {
    get onLine() {
      return online;
    },
  });
  vi.stubGlobal("window", { dispatchEvent: (e: Event) => (events.push(e.type), true) });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("古い画面の失敗を見分ける", () => {
  it("server action が見つからない・JS の読み込みの失敗は、古い画面", () => {
    expect(isStaleError(unrecognized())).toBe(true);
    const chunk = new Error("Loading chunk 123 failed.");
    chunk.name = "ChunkLoadError";
    expect(isStaleError(chunk)).toBe(true);
    expect(isStaleError(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"))).toBe(true);
    expect(isStaleError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleError("x")).toBe(false);
  });

  it("理由ごとの文。古い画面は読み込み直しを勧め、残したものを後ろに足す", () => {
    expect(actionFailure(unrecognized(), true, "書いた内容は残しています。")).toEqual({
      message: expect.stringMatching(/新しくなった.*読み込み直して.*。書いた内容は残しています。$/),
      stale: true,
    });
    expect(actionFailure(null, false).message).toContain("通信がつながっていない");
    expect(actionFailure(new Error("x"), true).stale).toBe(false);
  });
});

describe("callAction", () => {
  it("通信が切れているときは呼ばずに知らせる（Next.js は、つながるまで待ち続けるため）", async () => {
    online = false;
    const run = vi.fn(async () => 1);
    const r = await callAction(run);
    expect(run).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, failure: { stale: false } });
  });

  it("古い画面で失敗したら、理由を返し、画面の上の帯にも知らせる", async () => {
    const r = await callAction(async () => {
      throw unrecognized();
    });
    expect(r).toMatchObject({ ok: false, failure: { stale: true } });
    expect(events).toEqual([STALE_EVENT]);
  });

  it("成功したら値を返す。redirect などの画面の移動は、そのまま投げ直す", async () => {
    expect(await callAction(async () => "ok")).toEqual({ ok: true, value: "ok" });
    await expect(callAction(async () => redirect("/projects"))).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("guardAction（useActionState のフォーム）", () => {
  it("失敗したら、その画面のエラーの状態にする（送った値も渡す）", async () => {
    const action = guardAction<{ error?: string; values?: Record<string, string> }>(
      async () => {
        throw unrecognized();
      },
      (m, d) => ({ error: m, values: formValues(d) }),
    );
    const data = new FormData();
    data.set("name", "こもれび珈琲");
    data.set("$ACTION_ID_abc", "");
    const state = await action({}, data);
    expect(state.error).toContain("読み込み直して");
    expect(state.values).toEqual({ name: "こもれび珈琲" });
  });

  it("成功したら、そのままの状態を返す", async () => {
    const action = guardAction<{ ok?: boolean }>(async () => ({ ok: true }), () => ({}));
    expect(await action({}, new FormData())).toEqual({ ok: true });
  });
});
