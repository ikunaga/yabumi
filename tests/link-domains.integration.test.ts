// 短縮リンクを利用者のドメインで作る（F07、D28。4.22）。ローカルの Supabase を使う。Vercel の API と DNS はまねたものを渡す（本物は呼ばない）。
// 矢書全体の上限は DB の全体の数で決まるので、上限のテストは「今の数」を上限として渡して確かめる（ほかのテストの行は触らない）
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addLinkDomain,
  checkLinkDomain,
  drainLinkDomainRemovals,
  getLinkDomain,
  linkAllowedOnDomain,
  projectLinkBase,
  removeLinkDomain,
  type LinkDomainDeps,
} from "@/lib/links/domains";
import { shortLinkBase } from "@/lib/links/rules";
import { createShortLink, ensurePostLinks, resolveLink } from "@/lib/links/store";
import type { ProjectDomain, VercelDomains } from "@/lib/links/vercel";
import { VercelApiError } from "@/lib/links/vercel";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const STORE = "https://apps.apple.com/jp/app/id123456789";
const rand = () => randomBytes(5).toString("hex");

// Vercel の API のまね。足したドメインを覚え、TXT が要るか・DNS の向き・外したものを、テストから決められる
function fakeVercel(opts: { needsTxt?: boolean; addError?: VercelApiError } = {}) {
  const state = {
    added: new Set<string>(),
    removed: [] as string[],
    verified: !opts.needsTxt,
    misconfigured: true,
    configuredBy: null as string | null,
    failRemove: false,
  };
  const pd = (name: string): ProjectDomain => ({
    name,
    apexName: name.split(".").slice(-2).join("."),
    verified: state.verified,
    verification: state.verified ? [] : [{ type: "TXT", domain: `_vercel.${name.split(".").slice(-2).join(".")}`, value: `vc-domain-verify=${name},abc` }],
  });
  const vercel: VercelDomains = {
    async add(name) {
      if (opts.addError) throw opts.addError;
      state.added.add(name);
      return pd(name);
    },
    async get(name) {
      return pd(name);
    },
    async verify() {
      if (!state.verified) throw new VercelApiError(400, "missing_txt_record", "no txt");
      return true;
    },
    async config() {
      return { misconfigured: state.misconfigured, configuredBy: state.configuredBy, recommendedCNAME: "abc.vercel-dns-017.com" };
    },
    async remove(name) {
      if (state.failRemove) throw new VercelApiError(500, "", "boom");
      state.removed.push(name);
      state.added.delete(name);
    },
  };
  return { state, vercel };
}

const quiet = { apiKey: null, to: null };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceProject: string;
let bobProject: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  aliceProject = (await alice.from("projects").insert({ name: "ドメイン A", app_store_url: STORE }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "ドメイン B", app_store_url: STORE }).select("id").single()).data!.id;
});

afterAll(async () => {
  const domains = (await admin.from("link_domains").select("domain").in("owner_id", [aliceId, bobId])).data ?? [];
  await deleteUser(aliceId);
  await deleteUser(bobId);
  // 退会のカスケードで外す列に積まれたテストのドメインを片付ける
  await admin.from("link_domain_removals").delete().in("domain", domains.map((d) => d.domain));
});

async function cleanup(projectId: string, deps: LinkDomainDeps, ownerId: string) {
  const row = await getLinkDomain(admin, projectId);
  await removeLinkDomain(admin, { ownerId, projectId }, deps);
  if (row) await admin.from("link_domain_removals").delete().eq("domain", row.domain);
}

describe("利用者のドメイン", () => {
  it("足すと Vercel に足し、入れてほしい CNAME と TXT を残す。本人だけが読め、利用者は書き換えられない", async () => {
    const { vercel, state } = fakeVercel({ needsTxt: true });
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000 };
    const domain = `go.a${rand()}.com`;
    expect(await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain: `https://${domain.toUpperCase()}/` }, deps)).toEqual({ ok: true });
    expect(state.added.has(domain)).toBe(true);
    const row = (await alice.from("link_domains").select("*").eq("project_id", aliceProject).single()).data!;
    expect(row).toMatchObject({ domain, status: "pending", cname_target: "abc.vercel-dns-017.com", txt_name: `_vercel.${domain.split(".").slice(-2).join(".")}` });
    expect(row.txt_value).toContain("vc-domain-verify");
    expect((await bob.from("link_domains").select("id").eq("project_id", aliceProject)).data).toEqual([]);
    expect((await alice.from("link_domains").update({ status: "active" }).eq("project_id", aliceProject)).error?.code).toBe("42501");
    expect((await alice.from("link_domains").insert({ owner_id: aliceId, project_id: aliceProject, domain: `go.b${rand()}.com` })).error?.code).toBe("42501");
    // 足した回数と外す列は、利用者からは読めない
    expect((await alice.from("link_domain_attempts").select("id")).error?.code).toBe("42501");
    expect((await alice.from("link_domain_removals").select("domain")).error?.code).toBe("42501");
    await cleanup(aliceProject, deps, aliceId);
  });

  it("1 人 1 つまで。ほかの人が使っているドメインは使えない。apex は案を出して断る", async () => {
    const { vercel } = fakeVercel();
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000 };
    const domain = `go.c${rand()}.com`;
    expect(await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain }, deps)).toEqual({ ok: true });
    const second = (await alice.from("projects").insert({ name: "二つ目" }).select("id").single()).data!.id;
    expect(await addLinkDomain(admin, { ownerId: aliceId, projectId: second, domain: `go.d${rand()}.com` }, deps)).toMatchObject({ ok: false, error: expect.stringContaining("1 人 1 つ") });
    expect(await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain }, deps)).toMatchObject({ ok: false, error: expect.stringContaining("ほかの方が使っている") });
    // 他人のプロジェクトには足せない
    expect(await addLinkDomain(admin, { ownerId: bobId, projectId: aliceProject, domain: `go.e${rand()}.com` }, deps)).toMatchObject({ ok: false });
    expect(await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: "example.com" }, deps)).toMatchObject({ ok: false, suggestion: "go.example.com" });
    await cleanup(aliceProject, deps, aliceId);
    await alice.from("projects").delete().eq("id", second);
  });

  it("1 日の回数と、矢書全体の上限を超えては足せない", async () => {
    const { vercel } = fakeVercel();
    const [{ count: used }, { count: removing }] = await Promise.all([
      admin.from("link_domains").select("id", { count: "exact", head: true }),
      admin.from("link_domain_removals").select("domain", { count: "exact", head: true }),
    ]);
    const full = await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: `go.f${rand()}.com` }, { vercel, notify: quiet, limit: (used ?? 0) + (removing ?? 0) });
    expect(full).toMatchObject({ ok: false, error: expect.stringContaining("上限") });

    await admin.from("link_domain_attempts").insert(Array.from({ length: 5 }, () => ({ owner_id: bobId, domain: "go.x.com" })));
    const daily = await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: `go.g${rand()}.com` }, { vercel, notify: quiet, limit: 100000 });
    expect(daily).toMatchObject({ ok: false, error: expect.stringContaining("1 日に") });
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
  });

  it("Vercel で断られたら行を残さない（ほかの Vercel のプロジェクトで使われている）", async () => {
    const { vercel } = fakeVercel({ addError: new VercelApiError(409, "domain_already_in_use", "in use") });
    const domain = `go.h${rand()}.com`;
    const r = await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain }, { vercel, notify: quiet, limit: 100000 });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("ほかのサービス") });
    expect(await getLinkDomain(admin, bobProject)).toBeNull();
    // 半分だけ残っていてもよいように外す列に積み、すぐ外す（Vercel の側で 404 なら外れたものとして扱う）
    expect((await admin.from("link_domain_removals").select("domain").eq("domain", domain)).data).toEqual([]);
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
  });

  it("確かめる: TXT がない → DNS が届いていない → 値が違う → Proxy → 証明書を待つ → つながる", async () => {
    const { vercel, state } = fakeVercel({ needsTxt: true });
    let now = Date.parse("2026-10-12T00:00:00Z");
    const dns = { cname: [] as string[], a: [] as string[] };
    const notFound = Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    let probe = false;
    const deps: LinkDomainDeps = {
      vercel,
      notify: quiet,
      limit: 100000,
      now: () => new Date((now += 60_000)),
      resolveCname: async () => {
        if (!dns.cname.length) throw notFound;
        return dns.cname;
      },
      resolve4: async () => dns.a,
      probe: async () => probe,
    };
    const domain = `go.i${rand()}.com`;
    await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain }, deps);
    const check = async () => {
      const r = await checkLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject }, deps);
      if (!r.ok) throw new Error(r.error);
      return r.row;
    };

    expect(await check()).toMatchObject({ last_check: "txt_missing", status: "pending" });
    state.verified = true;
    expect(await check()).toMatchObject({ last_check: "dns_missing", status: "pending", txt_value: "" });
    dns.cname = ["other.example.net"];
    expect((await check()).last_check).toBe("wrong_value");
    dns.cname = [];
    dns.a = ["203.0.113.1"];
    expect((await check()).last_check).toBe("wrong_value");
    state.configuredBy = "http";
    expect((await check()).last_check).toBe("proxied");
    state.configuredBy = "CNAME";
    state.misconfigured = false;
    expect(await check()).toMatchObject({ last_check: "cert_pending", status: "pending" });
    expect(await projectLinkBase(alice, aliceProject)).toBe(shortLinkBase());
    probe = true;
    const ok = await check();
    expect(ok).toMatchObject({ last_check: "ok", status: "active" });
    expect(ok.verified_at).not.toBeNull();
    expect(await projectLinkBase(alice, aliceProject)).toBe(`https://${domain}`);

    // 続けて押すと、間をおくよう知らせる
    now -= 60_000;
    expect(await checkLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject }, deps)).toMatchObject({ ok: false, error: expect.stringContaining("10 秒") });
    await cleanup(aliceProject, deps, aliceId);
  });

  it("つながったら新しいリンクはそのドメインで作り、そのドメインではそのプロジェクトのリンクだけを開く", async () => {
    const { vercel, state } = fakeVercel();
    state.misconfigured = false;
    let now = Date.parse("2026-10-12T00:00:00Z");
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, probe: async () => true, now: () => new Date((now += 60_000)) };
    const domain = `go.j${rand()}.com`;
    const old = await createShortLink(admin, { ownerId: aliceId, projectId: aliceProject, destinationUrl: STORE, sns: "x", kind: "custom" });
    await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain }, deps);
    await checkLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject }, deps);

    // 投稿の本文のリンクは、つながったドメインで作る
    const post = (await alice.from("posts").insert({ project_id: aliceProject, body: `新しい版 ${STORE}`, status: "draft" }).select("id").single()).data!;
    const target = (await admin.from("post_targets").insert({ post_id: post.id, owner_id: aliceId, sns: "threads", status: "pending" }).select("id").single()).data!;
    const links = await ensurePostLinks(admin, { ownerId: aliceId, projectId: aliceProject, postTargetId: target.id, sns: "threads", text: `新しい版 ${STORE}` });
    expect(links.get(STORE)).toMatch(new RegExp(`^https://${domain.replace(/\./g, "\\.")}/[A-Za-z0-9]{8}$`));

    // 前に作ったリンクも、このドメインで開ける。ほかの人のリンクは、このドメインでは開けない
    const bobLink = await createShortLink(admin, { ownerId: bobId, projectId: bobProject, destinationUrl: STORE, sns: null, kind: "custom" });
    expect(await linkAllowedOnDomain(admin, (await resolveLink(admin, old.code))!.projectId, domain)).toBe(true);
    expect(await linkAllowedOnDomain(admin, (await resolveLink(admin, old.code))!.projectId, `${domain.toUpperCase()}.`)).toBe(true);
    expect(await linkAllowedOnDomain(admin, (await resolveLink(admin, bobLink.code))!.projectId, domain)).toBe(false);
    // 登録していないドメイン・つながる前のドメインでは開けない
    expect(await linkAllowedOnDomain(admin, aliceProject, `go.k${rand()}.com`)).toBe(false);

    // 短縮リンクのドメインへのリンクは作れない（入れ子）
    await expect(createShortLink(admin, { ownerId: bobId, projectId: bobProject, destinationUrl: `https://${domain}/abc`, sns: null, kind: "custom" })).rejects.toThrow();

    await cleanup(aliceProject, deps, aliceId);
    expect(await projectLinkBase(alice, aliceProject)).toBe(shortLinkBase());
  });

  it("外す・プロジェクトを削除すると、Vercel から外す。外せなければ残して、次にやり直す", async () => {
    const { vercel, state } = fakeVercel();
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000 };
    // 前のテストで足した回数が 1 日の上限に届かないように
    await admin.from("link_domain_attempts").delete().in("owner_id", [aliceId, bobId]);
    const d1 = `go.l${rand()}.com`;
    await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain: d1 }, deps);
    await removeLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject }, deps);
    expect(state.removed).toContain(d1);
    expect((await admin.from("link_domain_removals").select("domain").eq("domain", d1)).data).toEqual([]);

    // プロジェクトを消すと、DB のトリガーが外す列に積む。Vercel が失敗したら残り、次にやり直す
    const temp = (await alice.from("projects").insert({ name: "消す" }).select("id").single()).data!.id;
    const d2 = `go.m${rand()}.com`;
    await addLinkDomain(admin, { ownerId: aliceId, projectId: temp, domain: d2 }, deps);
    await alice.from("projects").delete().eq("id", temp);
    expect((await admin.from("link_domain_removals").select("domain").eq("domain", d2)).data).toHaveLength(1);
    // 外す途中のドメインは、ほかの人も使えない
    expect(await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: d2 }, { ...deps, vercel: { ...vercel, remove: async () => Promise.reject(new Error("x")) } })).toMatchObject({ ok: false });
    state.failRemove = true;
    await drainLinkDomainRemovals(admin, deps);
    const left = (await admin.from("link_domain_removals").select("attempts").eq("domain", d2).single()).data!;
    expect(left.attempts).toBeGreaterThanOrEqual(1);
    state.failRemove = false;
    await drainLinkDomainRemovals(admin, deps);
    expect(state.removed).toContain(d2);
    expect((await admin.from("link_domain_removals").select("domain").eq("domain", d2)).data).toEqual([]);
    await admin.from("link_domain_attempts").delete().in("owner_id", [aliceId, bobId]);
  });

  it("Vercel の設定がなければ足さない（画面は準備中）", async () => {
    expect(await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: `go.n${rand()}.com` }, { vercel: null })).toMatchObject({ ok: false, error: "この機能は準備中です。" });
  });
});
