// 短縮リンクを利用者のドメインで作る（F07、D28。4.22）。ローカルの Supabase を使う。Vercel の API と DNS はまねたものを渡す（本物は呼ばない）。
// 矢書全体の上限は DB の全体の数で決まるので、上限のテストは「今の数」を上限として渡して確かめる（ほかのテストの行は触らない）
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownershipRecordName, ownershipRecordValue, type Lookup } from "@/lib/links/doh";
import {
  addLinkDomain,
  checkLinkDomain,
  recheckLinkDomains,
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

// DNS のまね（DNS over HTTPS の代わり）。down にすると、どのリゾルバも答えない
function fakeDns() {
  const zone = { cname: new Map<string, string[]>(), a: new Map<string, string[]>(), txt: new Map<string, string[]>(), down: false };
  const lookup: Lookup = async (name, type) => {
    if (zone.down) return { records: [], answered: 0, missingEverywhere: false };
    const records = (type === "CNAME" ? zone.cname : type === "A" ? zone.a : zone.txt).get(name) ?? [];
    return { records, answered: 2, missingEverywhere: records.length === 0 };
  };
  return { zone, lookup };
}

// そのドメインの持ち主の確認の TXT を、DNS のまねに入れる（本当の持ち主が足したことにする）
async function putOwnerTxt(zone: ReturnType<typeof fakeDns>["zone"], projectId: string) {
  const row = (await getLinkDomain(admin, projectId))!;
  zone.txt.set(ownershipRecordName(row.domain), [ownershipRecordValue(row.ownership_token)]);
  return row;
}

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
    const { zone, lookup } = fakeDns();
    let probe = false;
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, now: () => new Date((now += 60_000)), lookup, probe: async () => probe };
    const domain = `go.i${rand()}.com`;
    await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain }, deps);
    const check = async () => {
      const r = await checkLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject }, deps);
      if (!r.ok) throw new Error(r.error);
      return r.row;
    };

    expect(await check()).toMatchObject({ last_check: "txt_missing", status: "pending" });
    state.verified = true;
    expect(await check()).toMatchObject({ last_check: "owner_txt_missing", status: "pending", txt_value: "" });
    // 合言葉が違う TXT（ほかの人の・前の合言葉）では通らない
    zone.txt.set(ownershipRecordName(domain), ["yabumi-verify=wrong-token-0000000000000000000000"]);
    expect((await check()).last_check).toBe("owner_txt_missing");
    await putOwnerTxt(zone, aliceProject);
    expect(await check()).toMatchObject({ last_check: "dns_missing", status: "pending" });
    zone.cname.set(domain, ["other.example.net"]);
    expect((await check()).last_check).toBe("wrong_value");
    zone.cname.delete(domain);
    zone.a.set(domain, ["203.0.113.1"]);
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
    expect(ok.owner_verified_at).not.toBeNull();
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
    const { zone, lookup } = fakeDns();
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, probe: async () => true, now: () => new Date((now += 60_000)), lookup };
    const domain = `go.j${rand()}.com`;
    const old = await createShortLink(admin, { ownerId: aliceId, projectId: aliceProject, destinationUrl: STORE, sns: "x", kind: "custom" });
    await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain }, deps);
    await putOwnerTxt(zone, aliceProject);
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

  it("他人のドメインは、Vercel が通しても、矢書の持ち主の確認の TXT がなければつながらない", async () => {
    // Vercel は TXT を求めず、DNS も Vercel を向いていて、確認用のパスも答える（使われなくなった CNAME が残っている他人のドメイン）
    const { vercel, state } = fakeVercel();
    state.misconfigured = false;
    const { zone, lookup } = fakeDns();
    const domain = `go.v${rand()}.com`;
    zone.cname.set(domain, ["cname.vercel-dns.com"]);
    let now = Date.parse("2026-10-12T00:00:00Z");
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, probe: async () => true, lookup, now: () => new Date((now += 60_000)) };
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
    expect(await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain }, deps)).toEqual({ ok: true });
    const r = await checkLinkDomain(admin, { ownerId: bobId, projectId: bobProject }, deps);
    expect(r).toMatchObject({ ok: true, row: { status: "pending", last_check: "owner_txt_missing", owner_verified_at: null } });
    expect(await linkAllowedOnDomain(admin, bobProject, domain)).toBe(false);
    // 合言葉は推測できない長さで、足すたびに作り直す
    const first = (await getLinkDomain(admin, bobProject))!.ownership_token;
    expect(first.length).toBeGreaterThanOrEqual(32);
    await cleanup(bobProject, deps, bobId);
    await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: `go.w${rand()}.com` }, deps);
    expect((await getLinkDomain(admin, bobProject))!.ownership_token).not.toBe(first);
    await cleanup(bobProject, deps, bobId);
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
  });

  it("つながらないまま 7 日たったら取り消し、Vercel からも外す", async () => {
    const { vercel, state } = fakeVercel();
    const { lookup } = fakeDns();
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, lookup };
    const domain = `go.x${rand()}.com`;
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
    await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain }, deps);
    await admin.from("link_domains").update({ pending_since: new Date(Date.now() - 6 * 86_400_000).toISOString() }).eq("project_id", bobProject);
    await recheckLinkDomains(admin, deps);
    expect(await getLinkDomain(admin, bobProject)).not.toBeNull();
    await admin.from("link_domains").update({ pending_since: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("project_id", bobProject);
    // 「確かめる」を押したときにも取り消す
    expect(await checkLinkDomain(admin, { ownerId: bobId, projectId: bobProject }, deps)).toMatchObject({ ok: false, error: expect.stringContaining("7 日") });
    expect(await getLinkDomain(admin, bobProject)).toBeNull();
    expect(state.removed).toContain(domain);
    // 取り消したドメインは、ほかの人（本当の持ち主）が使える
    await admin.from("link_domain_attempts").delete().eq("owner_id", aliceId);
    expect(await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain }, deps)).toEqual({ ok: true });
    await cleanup(aliceProject, deps, aliceId);
    await admin.from("link_domain_attempts").delete().in("owner_id", [aliceId, bobId]);
  });

  it("毎日の見回り: TXT か CNAME が外れたら矢書のドメインに戻す。リゾルバが答えなければ外さない", async () => {
    const { vercel, state } = fakeVercel();
    state.misconfigured = false;
    const { zone, lookup } = fakeDns();
    let now = Date.parse("2026-10-12T00:00:00Z");
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, probe: async () => true, lookup, now: () => new Date((now += 60_000)) };
    const domain = `go.y${rand()}.com`;
    await admin.from("link_domain_attempts").delete().eq("owner_id", aliceId);
    await addLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject, domain }, deps);
    await putOwnerTxt(zone, aliceProject);
    zone.cname.set(domain, ["abc.vercel-dns-017.com"]);
    expect((await checkLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject }, deps)) as { row: { status: string } }).toMatchObject({ row: { status: "active" } });

    const recheck = async () => {
      await recheckLinkDomains(admin, deps);
      return (await getLinkDomain(admin, aliceProject))!;
    };
    // 残っていれば、そのまま
    expect((await recheck()).status).toBe("active");
    // リゾルバがどれも答えなければ、外さない
    zone.down = true;
    zone.txt.clear();
    expect((await recheck()).status).toBe("active");
    zone.down = false;
    // 持ち主の確認の TXT が消えたら（ドメインを手放した・別の人に渡った）、戻す
    const lost = await recheck();
    expect(lost).toMatchObject({ status: "pending", last_check: "owner_txt_missing" });
    expect(await projectLinkBase(alice, aliceProject)).toBe(shortLinkBase());
    expect(await linkAllowedOnDomain(admin, aliceProject, domain)).toBe(false);
    // 戻したところから 7 日の猶予（足した日からではない）
    expect(Date.now() - Date.parse(lost.pending_since)).toBeLessThan(86_400_000 * 365);
    expect(await getLinkDomain(admin, aliceProject)).not.toBeNull();
    // 足し直して確かめれば、また使える
    await putOwnerTxt(zone, aliceProject);
    expect((await checkLinkDomain(admin, { ownerId: aliceId, projectId: aliceProject }, deps)) as { row: { status: string } }).toMatchObject({ row: { status: "active" } });
    // CNAME が別のところを向いたら、戻す
    zone.cname.set(domain, ["parking.example.net"]);
    expect(await recheck()).toMatchObject({ status: "pending", last_check: "wrong_value" });
    await cleanup(aliceProject, deps, aliceId);
    await admin.from("link_domain_attempts").delete().eq("owner_id", aliceId);
  });

  it("前の形（合言葉なし）の claim_link_domain も、pending を作るだけで持ち主の確認は飛ばさない。呼べるのはサーバーだけ", async () => {
    const domain = `go.z${rand()}.com`;
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
    const args = { p_owner: bobId, p_project: bobProject, p_domain: domain, p_daily: 5, p_total: 100000 };
    // 利用者からは、どちらの形も呼べない
    expect((await bob.rpc("claim_link_domain", args)).error?.code).toBe("42501");
    expect((await bob.rpc("claim_link_domain", { ...args, p_token: "x".repeat(40) })).error?.code).toBe("42501");
    expect((await admin.rpc("claim_link_domain", args)).data).toBe("ok");
    const row = (await getLinkDomain(admin, bobProject))!;
    expect(row).toMatchObject({ status: "pending", owner_verified_at: null });
    expect(row.ownership_token).toMatch(/^[0-9a-f]{48}$/);
    // TXT がなければ、Vercel が通してもつながらない
    const { vercel, state } = fakeVercel();
    state.misconfigured = false;
    const { lookup } = fakeDns();
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, probe: async () => true, lookup };
    expect(await checkLinkDomain(admin, { ownerId: bobId, projectId: bobProject }, deps)).toMatchObject({ ok: true, row: { status: "pending", last_check: "owner_txt_missing" } });
    // 新しい形でも、短い合言葉は受け付けない
    await cleanup(bobProject, deps, bobId);
    expect((await admin.rpc("claim_link_domain", { ...args, p_domain: `go.za${rand()}.com`, p_token: "short" })).error).not.toBeNull();
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
  });

  it("持ち主の確認が済んでいないドメインは、DB でも active にできない", async () => {
    const { vercel } = fakeVercel();
    const deps: LinkDomainDeps = { vercel, notify: quiet, limit: 100000, lookup: fakeDns().lookup };
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
    await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: `go.fc${rand()}.com` }, deps);
    const r = await admin.from("link_domains").update({ status: "active" }).eq("project_id", bobProject);
    expect(r.error?.code).toBe("23514");
    expect(await getLinkDomain(admin, bobProject)).toMatchObject({ status: "pending" });
    await cleanup(bobProject, deps, bobId);
    await admin.from("link_domain_attempts").delete().eq("owner_id", bobId);
  });

  it("DNS を確かめられない日が 3 日を超えたら戻し、まとめて戻ったら運営者に知らせる", async () => {
    const { vercel, state } = fakeVercel();
    state.misconfigured = false;
    const { zone, lookup } = fakeDns();
    const sent: string[] = [];
    const notify = { apiKey: "test", to: "ops@example.com", fetch: (async (_u: unknown, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch };
    let now = Date.parse("2026-10-12T00:00:00Z");
    const deps: LinkDomainDeps = { vercel, notify, limit: 100000, probe: async () => true, lookup, now: () => new Date((now += 60_000)) };
    const carol = await signUpNewUser();
    const carolProject = (await carol.client.from("projects").insert({ name: "ドメイン C" }).select("id").single()).data!.id;
    const users = [
      { id: aliceId, project: aliceProject },
      { id: bobId, project: bobProject },
      { id: carol.userId, project: carolProject },
    ];
    await admin.from("link_domain_attempts").delete().in("owner_id", users.map((u) => u.id));
    for (const u of users) {
      const domain = `go.uc${rand()}.com`;
      await addLinkDomain(admin, { ownerId: u.id, projectId: u.project, domain }, deps);
      await putOwnerTxt(zone, u.project);
      zone.cname.set(domain, ["abc.vercel-dns-017.com"]);
      expect((await checkLinkDomain(admin, { ownerId: u.id, projectId: u.project }, deps)) as { row: { status: string; dns_confirmed_at: string } }).toMatchObject({ row: { status: "active" } });
    }
    // 2 日答えがなくても、まだ戻さない
    zone.down = true;
    now += 2 * 86_400_000;
    await recheckLinkDomains(admin, deps);
    for (const u of users) expect((await getLinkDomain(admin, u.project))!.status).toBe("active");
    expect(sent).toEqual([]);
    // 3 日を超えたら戻す（閉じる側に倒す）。3 件まとめて戻ったので、運営者に 1 回知らせる
    now += 2 * 86_400_000;
    const report = await recheckLinkDomains(admin, deps);
    expect(report.unconfirmed).toBeGreaterThanOrEqual(3);
    for (const u of users) {
      expect(await getLinkDomain(admin, u.project)).toMatchObject({ status: "pending", last_check: "error" });
      expect(await projectLinkBase(admin, u.project)).toBe(shortLinkBase());
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("DNS を確かめられません");
    // 同じ日にもう一度戻っても、知らせは 1 回
    await recheckLinkDomains(admin, deps);
    expect(sent).toHaveLength(1);
    for (const u of users) await cleanup(u.project, deps, u.id);
    await admin.from("operator_notifications").delete().like("key", "link_domains_unconfirmed:%");
    await admin.from("link_domain_attempts").delete().in("owner_id", users.map((u) => u.id));
    await deleteUser(carol.userId);
  });

  it("Vercel の設定がなければ足さない（画面は準備中）", async () => {
    expect(await addLinkDomain(admin, { ownerId: bobId, projectId: bobProject, domain: `go.n${rand()}.com` }, { vercel: null })).toMatchObject({ ok: false, error: "この機能は準備中です。" });
  });
});
