// 自動投稿の編集の往復（2026-11-24 本番: 変数のあるシリーズの回し方を編集して保存すると「Unrecognized key: "format_var_modes"」で断られた）。
// 保存 → 編集画面と同じ読み込み（getAutoPlan）→ 画面と同じ形で送り返す（saveAutoPlan）を、利用者の権限で通す。
// 前のテストは DB の関数（save_auto_plan）を直に呼ぶか、作り方の控えのない materials で saveAutoPlan を呼んでいたので、
// サーバーが materials に足した format_var_modes を画面が送り返す道を通っていなかった
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestClient } from "./helpers/supabase";
vi.mock("server-only", () => ({}));
// サーバーの操作の「ログイン中の利用者」をテストの利用者にする
let current: TestClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
// サーバーの権限は、テストのローカルの鍵で（process.env には鍵を置かない）
vi.mock("@/lib/supabase/admin", async () => ({ createAdminClient: (await import("./helpers/supabase")).adminClient }));

const { adminClient, deleteUser, signUpNewUser } = await import("./helpers/supabase");
const { saveAutoPlan } = await import("@/lib/auto-post/actions");
const { getAutoPlan } = await import("@/lib/auto-post/queries");
const { addFormat } = await import("@/lib/post-formats/store");
const { materialsForInput } = await import("@/lib/auto-post/types");
type AutoPlan = NonNullable<Awaited<ReturnType<typeof getAutoPlan>>>;

const admin = adminClient();
let aliceId: string;
let projectId: string;
let formatId: string;

const BODY = "連想映画クイズ🎬\n{キーワード}\nこの 5 つから連想する映画は？答えは{答え方}で";
const SERIES = {
  vars: [
    { name: "映画", mode: "ai", instruction: "だれでも知っている映画を 1 つ", unique: true },
    { name: "キーワード", mode: "ai", instruction: "{映画}を連想できる言葉を 5 つ", unique: false },
    { name: "答え方", mode: "hand", instruction: "", unique: false },
  ],
} as const;

// 編集画面（plan-wizard の input()）と同じ形。materials は読み込んだものを、画面と同じく materialsForInput に通す
const fromPlan = (plan: AutoPlan, over: Partial<Parameters<typeof saveAutoPlan>[1]> = {}) => ({
  id: plan.id,
  name: plan.name,
  kind: plan.kind,
  materials: materialsForInput(plan.materials),
  targets: plan.targets,
  xLink: plan.xLink,
  schedule: plan.schedule,
  instructions: plan.instructions,
  image: plan.image,
  leadHours: plan.leadHours,
  consent: true as const,
  ...over,
});

beforeAll(async () => {
  const u = await signUpNewUser();
  current = u.client;
  aliceId = u.userId;
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  projectId = (await current.from("projects").insert({ name: "映画の店" }).select("id").single()).data!.id;
  formatId = await addFormat(current, projectId, { name: "連想映画クイズ", body: BODY, series: SERIES as never });
});

afterAll(async () => {
  await deleteUser(aliceId);
  for (const t of ["auto_plans", "auto_runs", "post_formats", "projects"] as const) {
    expect((await admin.from(t).select("*", { count: "exact", head: true }).eq("owner_id", aliceId)).count).toBe(0);
  }
});

describe("変数のあるシリーズの回し方を編集して保存する", () => {
  it("保存 → 読み込み → 何も変えずに保存・送り先だけ変えて保存が通る。作り方の控えはサーバーが決めたまま", async () => {
    const first = await saveAutoPlan(projectId, {
      name: "連想映画クイズ",
      kind: "series",
      materials: { format_id: formatId, format_vars: { 答え方: { value: "リプで" } } },
      targets: { threads: "auto" },
      xLink: "never",
      schedule: { weekdays: [2, 5], time: "19:00", every_weeks: 1, start: "2026-11-24" },
      instructions: [],
      image: null,
      leadHours: 24,
      consent: true,
    });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const planId = (first as { data: { id: string } }).data.id;

    // 読み込んだ回し方には、サーバーが足した作り方の控えが入っている（これを送り返して断られていた）
    const loaded = (await getAutoPlan(planId))!;
    expect(loaded.materials.format_var_modes).toEqual({ 映画: "ai", キーワード: "ai", 答え方: "hand" });

    // 何も変えずに保存
    const same = await saveAutoPlan(projectId, fromPlan(loaded));
    expect(same, JSON.stringify(same)).toMatchObject({ ok: true });

    // 送り先だけ変えて保存（X は確認して送る）
    const moved = await saveAutoPlan(projectId, fromPlan(loaded, { targets: { threads: "auto", x: "review" } }));
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true });
    const after = (await getAutoPlan(planId))!;
    expect(after.targets).toEqual({ threads: "auto", x: "review" });
    expect(after.materials).toEqual({ format_id: formatId, format_vars: { 答え方: { value: "リプで" } }, format_var_modes: { 映画: "ai", キーワード: "ai", 答え方: "hand" } });
  });

  it("古い画面が作り方の控えを送り返しても、断らずに捨てる（利用者の値では決めない）", async () => {
    const plan = (await current.from("auto_plans").select("id").eq("project_id", projectId).single()).data!;
    const loaded = (await getAutoPlan(plan.id))!;
    // 送り返す控えを書き換えても（ずる）、保存はサーバーが決めた値のまま
    const r = await saveAutoPlan(projectId, fromPlan(loaded, { materials: { ...loaded.materials, format_var_modes: { 映画: "hand", キーワード: "hand", 答え方: "hand" } } }));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect((await getAutoPlan(plan.id))!.materials.format_var_modes).toEqual({ 映画: "ai", キーワード: "ai", 答え方: "hand" });
  });

  it("知らないキーなど、zod の英語の文は画面に出さず、決まった日本語の文にする", async () => {
    const plan = (await current.from("auto_plans").select("id").eq("project_id", projectId).single()).data!;
    const loaded = (await getAutoPlan(plan.id))!;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await saveAutoPlan(projectId, fromPlan(loaded, { materials: { ...materialsForInput(loaded.materials), surprise: 1 } as never }));
    expect(r).toEqual({ ok: false, error: "入力の形式が正しくありません。" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    // schema に書いた日本語の文は、そのまま出す
    const named = await saveAutoPlan(projectId, fromPlan(loaded, { name: "  " }));
    expect(named).toEqual({ ok: false, error: "名前を入れてください。" });
  });
});
