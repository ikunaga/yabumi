// GitHub の連携（インストールとリポジトリのつなぎ）の RLS と、説明の下書きの流れ。
// GitHub と AI はモックし、本物は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { draftAppDescription, refineAppDescription, type CallDescriber, type RepoAccess } from "@/lib/ai/app-description";
import type { AiLimits } from "@/lib/ai/limits";
import { readableRepoLink, syncInstallations, userCanReadRepo, verifyInstallations, type VerifiedInstallation } from "@/lib/github/installations";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const roomy: AiLimits = { userMonthlyUsd: 1000, globalMonthlyUsd: 100000, userDailyTurns: 1000 };
const APP_ID = "999";
// テストごとにずらした、本物と重ならないインストール ID
const base = 9_000_000_000 + Math.floor(Math.random() * 1_000_000) * 10;
// GitHub の利用者 alice（id 1）。インストール先は alice 本人の個人アカウント、組織、他人の個人アカウント
const ALICE_GH = { id: 1, login: "alice" };
const inst = (id: number, login = "alice", type = "User", accountId = login === "alice" ? 1 : 2) => ({ id, app_id: Number(APP_ID), account: { id: accountId, login, type } });
const verified = (id: number, repoIds: number[] | null, login = "alice", type = "User"): VerifiedInstallation => ({ ...inst(id, login, type), repoIds });

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const draft = { appName: "かけいぼ日和", what: "レシートを撮るだけの家計簿です。", audience: "", platforms: ["ios"], stage: "developing", stageNote: "", questions: [{ question: "誰に使ってほしいですか？", choices: ["会社員", "学生"] }] };
const usage = { inputTokens: 20000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 800 };
const out = (output: unknown, stopReason = "end_turn") => ({ output, stopReason, model: "claude-opus-5-5", usage });
const describer = (d: unknown = draft): CallDescriber => vi.fn(async () => out(d));
const picker = (paths: string[] = ["front/README.md", ".env", "README.md"]): CallDescriber => vi.fn(async () => out({ paths }));
const tree = [
  { path: "README.md", type: "blob" as const, size: 100 },
  { path: "front/README.md", type: "blob" as const, size: 100 },
  { path: ".env", type: "blob" as const, size: 10 },
];
const repo: RepoAccess = {
  listFiles: vi.fn(async () => tree),
  readFiles: vi.fn(async (_link, paths: string[]) => ({ files: paths.map((p) => ({ path: p, content: `中身 ${p}`, truncated: false })), skipped: [] })),
};
const deps = (over: Partial<Parameters<typeof draftAppDescription>[2]> = {}) => ({ callPicker: picker(), callDescriber: describer(), repo, limits: roomy, ...over });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("GitHub のインストール", () => {
  it("本人の個人アカウントは全部、組織・他人のアカウントは本人が読めるリポジトリだけ。他の App のものは入れない", async () => {
    const listUserRepoIds = vi.fn(async (id: number) => (id === base + 2 ? [21, 22] : [99]));
    const v = await verifyInstallations(APP_ID, ALICE_GH, [inst(base + 1), inst(base + 2, "alice-org", "Organization"), { ...inst(base + 3), app_id: 1 }], listUserRepoIds);
    expect(v.map((i) => [i.id, i.repoIds])).toEqual([
      [base + 1, null],
      [base + 2, [21, 22]],
    ]);
    // 本人の個人アカウントのインストールでは、本人が読めるリポジトリを調べない
    expect(listUserRepoIds.mock.calls).toEqual([[base + 2]]);
    // 名前が同じでも、アカウントの ID が違えば本人のものではない（名前は変えられる）
    const renamed = await verifyInstallations(APP_ID, ALICE_GH, [inst(base + 4, "alice", "User", 3)], async () => [7]);
    expect(renamed[0].repoIds).toEqual([7]);

    const n = await syncInstallations(admin, aliceId, v);
    expect(n).toBe(2);
    const { data } = await alice.from("github_installations").select("installation_id, account_login").order("installation_id");
    expect(data).toEqual([
      { installation_id: base + 1, account_login: "alice" },
      { installation_id: base + 2, account_login: "alice-org" },
    ]);
  });

  it("GitHub 側で外したインストールは、読み込み直すと消える（つないだリポジトリも外れる）", async () => {
    await admin.from("project_github_repos").insert({ project_id: projectId, owner_id: aliceId, installation_id: base + 2, repo_id: 1, full_name: "alice-org/x" });
    await syncInstallations(admin, aliceId, [verified(base + 1, null)]);
    expect((await alice.from("github_installations").select("installation_id")).data).toEqual([{ installation_id: base + 1 }]);
    expect((await alice.from("project_github_repos").select("project_id")).data).toEqual([]);
  });

  it("他人のインストールは読めない。本人でも画面側からは追加できない", async () => {
    expect((await bob.from("github_installations").select("*")).data).toEqual([]);
    const { error } = await alice.from("github_installations").insert({ owner_id: aliceId, installation_id: base + 9, account_login: "x" });
    expect(error).not.toBeNull();
  });
});

describe("本人が読めるリポジトリだけを読む（Any account で他の人が入れたとき）", () => {
  // bob が持つ個人アカウントのインストールに alice が共同作業者として 1 つのリポジトリだけ入っている、と、
  // alice が組織のメンバーで、組織のインストールのうち 1 つだけ読める、の 2 つ
  const collab = base + 5;
  const org = base + 6;
  let p: string;

  beforeAll(async () => {
    p = (await alice.from("projects").insert({ name: "共同作業" }).select("id").single()).data!.id;
    await syncInstallations(admin, aliceId, [verified(base + 1, null), verified(collab, [51], "bob", "User"), verified(org, [61], "acme", "Organization")]);
  });

  afterAll(async () => {
    // 後の「リポジトリのつなぎ」のテストに残さない
    await admin.from("projects").delete().eq("id", p);
    await syncInstallations(admin, aliceId, [verified(base + 1, null)]);
  });

  it("本人の個人アカウントのインストールは、どのリポジトリも読める", async () => {
    expect(await userCanReadRepo(alice, aliceId, base + 1, 12345)).toBe(true);
  });

  it("共同作業者・組織のメンバーは、本人が読めるリポジトリだけ。読めないものは false", async () => {
    expect(await userCanReadRepo(alice, aliceId, collab, 51)).toBe(true);
    expect(await userCanReadRepo(alice, aliceId, collab, 52)).toBe(false);
    expect(await userCanReadRepo(alice, aliceId, org, 61)).toBe(true);
    expect(await userCanReadRepo(alice, aliceId, org, 62)).toBe(false);
  });

  it("他人のインストールの記録は使えない（bob から alice のインストールを指しても false）", async () => {
    expect(await userCanReadRepo(bob, bobId, org, 61)).toBe(false);
    expect(await userCanReadRepo(admin, bobId, org, 61)).toBe(false);
  });

  it("読む直前の確認: 読めるつなぎだけを返し、他人のプロジェクトは返さない", async () => {
    await admin.from("project_github_repos").upsert({ project_id: p, owner_id: aliceId, installation_id: org, repo_id: 61, full_name: "acme/app" });
    expect(await readableRepoLink(alice, aliceId, p)).toEqual({ installationId: org, repoId: 61, fullName: "acme/app", defaultBranch: "main" });
    expect(await readableRepoLink(bob, bobId, p)).toBeNull();
    expect(await readableRepoLink(admin, bobId, p)).toBeNull();
    // 何かの理由で、本人が読めないリポジトリのつなぎが DB に残っていても、読まない
    await admin.from("project_github_repos").update({ repo_id: 62, full_name: "acme/secret" }).eq("project_id", p);
    expect(await readableRepoLink(alice, aliceId, p)).toBeNull();
  });

  it("読み込み直しで本人が読めなくなったリポジトリは、つなぎが外れる", async () => {
    await admin.from("project_github_repos").update({ repo_id: 61, full_name: "acme/app" }).eq("project_id", p);
    await syncInstallations(admin, aliceId, [verified(base + 1, null), verified(collab, [51], "bob", "User"), verified(org, [63], "acme", "Organization")]);
    expect((await alice.from("project_github_repos").select("project_id").eq("project_id", p)).data).toEqual([]);
    expect(await userCanReadRepo(alice, aliceId, org, 63)).toBe(true);
    expect(await userCanReadRepo(alice, aliceId, org, 61)).toBe(false);
  });

  it("本人でも、読めるリポジトリの記録を画面側から書き換えられない", async () => {
    await alice.from("github_installations").update({ repo_ids: [61, 62] }).eq("installation_id", org);
    expect(await userCanReadRepo(admin, aliceId, org, 62)).toBe(false);
  });

  it("下書きは、本人が読めないリポジトリを読まない（GitHub に問い合わせる前に止める）", async () => {
    await admin.from("project_github_repos").upsert({ project_id: p, owner_id: aliceId, installation_id: org, repo_id: 64, full_name: "acme/secret" });
    vi.mocked(repo.listFiles).mockClear();
    const r = await draftAppDescription(alice, admin, deps(), { userId: aliceId, projectId: p });
    expect(r.ok).toBe(false);
    expect(repo.listFiles).not.toHaveBeenCalled();
  });
});

describe("リポジトリのつなぎ", () => {
  beforeAll(async () => {
    await admin.from("project_github_repos").upsert({ project_id: projectId, owner_id: aliceId, installation_id: base + 1, repo_id: 42, full_name: "alice/kakeibo", is_private: true });
  });

  it("他人は読めず、外すこともできない。画面側からはつなげない", async () => {
    expect((await bob.from("project_github_repos").select("*")).data).toEqual([]);
    await bob.from("project_github_repos").delete().eq("project_id", projectId);
    expect((await alice.from("project_github_repos").select("full_name")).data).toEqual([{ full_name: "alice/kakeibo" }]);
    const p2 = (await alice.from("projects").insert({ name: "B" }).select("id").single()).data!.id;
    const { error } = await alice.from("project_github_repos").insert({ project_id: p2, owner_id: aliceId, installation_id: base + 1, repo_id: 7, full_name: "alice/other" });
    expect(error).not.toBeNull();
  });

  it("下書き: ① AI が読むファイルを選び（秘密のファイルは選ばせない）、② 読んで紹介文を書く。利用量を 2 回分数え、中身も下書きも保存しない", async () => {
    const d = deps();
    const r = await draftAppDescription(alice, admin, d, { userId: aliceId, projectId });
    expect(r).toMatchObject({ ok: true, filesRead: ["front/README.md", "README.md"] });
    // ①にはファイル一覧を渡すが、秘密のファイルは一覧にも入れない
    const pickReq = JSON.stringify(vi.mocked(d.callPicker).mock.calls[0][0].messages);
    expect(pickReq).toContain("front/README.md");
    expect(pickReq).not.toContain(".env");
    // AI が .env を選んでも読まない
    expect(vi.mocked(repo.readFiles).mock.calls[0][1]).toEqual(["front/README.md", "README.md"]);
    expect(JSON.stringify(vi.mocked(d.callDescriber).mock.calls[0][0].messages)).toContain('<repository_file path=\\"README.md\\">');

    const { data: u } = await admin.from("ai_usage").select("purpose").eq("owner_id", aliceId);
    expect(u!.map((x) => x.purpose)).toEqual(["app_description", "app_description"]);
    const { data: link } = await alice.from("project_github_repos").select("last_read_at").single();
    expect(link!.last_read_at).not.toBeNull();
    const { data: p } = await alice.from("projects").select("description").eq("id", projectId).single();
    expect(p!.description).toBe("");
  });

  it("① で選べなかったときは、決まった名前のファイルを読む", async () => {
    vi.mocked(repo.readFiles).mockClear();
    const r = await draftAppDescription(alice, admin, deps({ callPicker: picker([]) }), { userId: aliceId, projectId });
    expect(r.ok).toBe(true);
    expect(vi.mocked(repo.readFiles).mock.calls[0][1]).toEqual(["README.md", "front/README.md"]);
  });

  it("質問への答えで書き直す（リポジトリは読み直さない）", async () => {
    vi.mocked(repo.listFiles).mockClear();
    const d = describer({ ...draft, audience: "会社員", questions: [] });
    const r = await refineAppDescription(alice, admin, { callDescriber: d, limits: roomy }, { userId: aliceId, projectId, draft: draft as never, answers: [{ question: "誰に使ってほしいですか？", answer: "会社員" }] });
    expect(r).toMatchObject({ ok: true, draft: { audience: "会社員", questions: [] } });
    expect(repo.listFiles).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(d).mock.calls[0][0].messages)).toContain("会社員");
  });

  it("上限に達していたら、リポジトリも読まない", async () => {
    vi.mocked(repo.listFiles).mockClear();
    const r = await draftAppDescription(alice, admin, deps({ limits: { ...roomy, userMonthlyUsd: 0.000001 } }), { userId: aliceId, projectId });
    expect(r.ok).toBe(false);
    expect(repo.listFiles).not.toHaveBeenCalled();
  });

  it("形の合わない下書きはエラーにする", async () => {
    const r = await draftAppDescription(alice, admin, deps({ callDescriber: describer({ what: "" }) }), { userId: aliceId, projectId });
    expect(r.ok).toBe(false);
  });

  it("他人のプロジェクトでは下書きできない", async () => {
    const r = await draftAppDescription(bob, admin, deps(), { userId: bobId, projectId });
    expect(r).toMatchObject({ ok: false });
  });

  it("本人は外せる", async () => {
    await alice.from("project_github_repos").delete().eq("project_id", projectId);
    expect((await alice.from("project_github_repos").select("project_id").eq("project_id", projectId)).data).toEqual([]);
  });
});
