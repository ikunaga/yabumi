// 自分のドメインの短縮リンクの、セキュリティの確認（docs/security/2026-11-21_セキュリティ確認.md）の L1・L2。
// 偽の Vercel（tests/helpers/fake-link-domain-server.mjs。LINK_DOMAIN_TEST_SERVER と同じもの）を HTTP で立て、本物の vercelDomains で呼ぶ。
// L1: Vercel がもう付いている・ほかで使われている（409・403）ドメインは、外す列に積まず、Vercel から外さない（運営者が付けたドメインを守る）
// L2: 「確認する」を同時に何回押しても、10 秒に 1 回しか外に聞かない
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Lookup } from "@/lib/links/doh";
import { addLinkDomain, checkLinkDomain, getLinkDomain, removeLinkDomain, type LinkDomainDeps } from "@/lib/links/domains";
import { vercelDomains } from "@/lib/links/vercel";
import { startFakeLinkDomainServer } from "./helpers/fake-link-domain-server.mjs";
import { holdLockDuringFile } from "./helpers/lock";
import { adminClient, deleteUser, signUpNewUser } from "./helpers/supabase";

const admin = adminClient();
const rand = () => randomBytes(5).toString("hex");
const IN_USE = "このドメインは、ほかのサービスですでに使われています。";

// 同じマシンの link-domains のテスト（yabumi 全体の数と、外す列を見る）は 1 つずつ流す
holdLockDuringFile("link-domains-global");

let server: { url: string; close: () => Promise<void> };
const users: string[] = [];
const domains: string[] = [];
const noDns: Lookup = async () => ({ records: [], answered: 2, missingEverywhere: true });
const deps = (): LinkDomainDeps => ({
  vercel: vercelDomains({ token: "test", projectId: "prj_test", base: server.url }),
  lookup: noDns,
  probe: async () => false,
  notify: { apiKey: null, to: null },
  limit: 100000,
});
const control = (path: string, body: unknown) => fetch(`${server.url}${path}`, { method: "POST", body: JSON.stringify(body) });
const calls = async () => (await (await fetch(`${server.url}/__control/calls`)).json()) as Record<string, number>;
const inVercel = async (domain: string) => (await fetch(`${server.url}/v9/projects/prj_test/domains/${domain}`)).status === 200;

// 1 人 1 日 5 回までなので、テストごとに利用者とプロジェクトを作る
async function owner() {
  const { client, userId } = await signUpNewUser();
  users.push(userId);
  const projectId = (await client.from("projects").insert({ name: "ドメイン" }).select("id").single()).data!.id as string;
  return { ownerId: userId, projectId };
}
const newDomain = () => {
  const d = `go.s${rand()}.com`;
  domains.push(d);
  return d;
};

beforeAll(async () => {
  server = await startFakeLinkDomainServer(0);
});

afterAll(async () => {
  for (const id of users) await deleteUser(id);
  await admin.from("link_domain_removals").delete().in("domain", domains);
  await admin.from("link_domain_removals").delete().like("domain", "discard-%.invalid");
  await server.close();
});

describe("L1: yabumi が付けたのではないドメインは外さない", () => {
  it("Vercel にもう付いている（運営者が手で付けた）ドメインは、枠を取る前に使えないと返す。行も外す列も残さず、Vercel からも外さない", async () => {
    const who = await owner();
    const domain = newDomain();
    await control("/__control/vercel-domain", { domain, attached: true });
    const r = await addLinkDomain(admin, { ...who, domain }, deps());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining(IN_USE) });
    expect(await getLinkDomain(admin, who.projectId)).toBeNull();
    expect((await admin.from("link_domain_removals").select("domain").eq("domain", domain)).data).toEqual([]);
    expect(await inVercel(domain)).toBe(true);
    // 枠を取る前に断るので、行は一度も作られない（同時に「使うのをやめる」を送られても、消す行がなく、外す列に積まれない）
    expect((await admin.from("link_domain_attempts").select("id", { count: "exact", head: true }).eq("owner_id", who.ownerId)).count).toBe(0);
    await Promise.all([addLinkDomain(admin, { ...who, domain }, deps()), removeLinkDomain(admin, who, deps())]);
    expect((await admin.from("link_domain_removals").select("domain").eq("domain", domain)).data).toEqual([]);
    expect(await inVercel(domain)).toBe(true);
    expect((await calls())["DELETE /v9/projects/:p/domains/:d"] ?? 0).toBe(0);
  });

  it.each([409, 403])("追加を Vercel が %i で断ったら、外す列に積まずに使えないと返す（運営者のドメインを外さない）", async (status) => {
    const who = await owner();
    const domain = newDomain();
    await control("/__control/vercel-domain", { domain, addStatus: status });
    await fetch(`${server.url}/__control/reset`, { method: "POST" });
    const r = await addLinkDomain(admin, { ...who, domain }, deps());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining(IN_USE) });
    expect(await getLinkDomain(admin, who.projectId)).toBeNull();
    expect((await admin.from("link_domain_removals").select("domain").eq("domain", domain)).data).toEqual([]);
    // 行を消すときに積まれる置きかえの名前も、すぐ列から消している
    expect((await admin.from("link_domain_removals").select("domain").like("domain", "discard-%.invalid")).data).toEqual([]);
    expect((await calls())["DELETE /v9/projects/:p/domains/:d"] ?? 0).toBe(0);
    // 枠は空いたので、同じ人が別のドメインを追加できる
    expect(await addLinkDomain(admin, { ...who, domain: newDomain() }, deps())).toEqual({ ok: true });
  });

  it("yabumi が付けたドメインは、いままでどおり外すと Vercel からも外す", async () => {
    const who = await owner();
    const domain = newDomain();
    expect(await addLinkDomain(admin, { ...who, domain }, deps())).toEqual({ ok: true });
    expect(await inVercel(domain)).toBe(true);
    await removeLinkDomain(admin, who, deps());
    expect(await inVercel(domain)).toBe(false);
  });
});

describe("L2: 「確認する」は 10 秒に 1 回しか外に聞かない", () => {
  it("同時に 5 回送っても、Vercel に聞くのは 1 回だけ。ほかの 4 回は、また押せる時刻を返す", async () => {
    const who = await owner();
    expect(await addLinkDomain(admin, { ...who, domain: newDomain() }, deps())).toEqual({ ok: true });
    await fetch(`${server.url}/__control/reset`, { method: "POST" });
    const results = await Promise.all(Array.from({ length: 5 }, () => checkLinkDomain(admin, who, deps())));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.cooldownUntil)).toHaveLength(4);
    expect((await calls())["GET /v9/projects/:p/domains/:d"]).toBe(1);
    // 10 秒たてば、また聞く
    const later = await checkLinkDomain(admin, who, { ...deps(), now: () => new Date(Date.now() + 11_000) });
    expect(later.ok).toBe(true);
    expect((await calls())["GET /v9/projects/:p/domains/:d"]).toBe(2);
  });
});
