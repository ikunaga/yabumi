// 短縮リンクを利用者のドメインで作る（F07、D28。4.22）: ドメインの形、ホストの見分け、Vercel の API の呼び方（本物は呼ばない）
import { describe, expect, it } from "vitest";
import { apexOf, dnsRecordName, isApexDomain, linkDomainLimit, LINK_CHECK_BODY, LINK_CHECK_PATH, normalizeLinkDomain } from "@/lib/links/domain-rules";
import { isYabumiHost, shortLinkRoute } from "@/lib/links/host";
import { dohLookup, ownershipRecordName, ownershipRecordValue } from "@/lib/links/doh";
import { VercelApiError, vercelConfig, vercelDomains } from "@/lib/links/vercel";

describe("ドメインの形", () => {
  it("https:// や末尾の / を外し、小文字にする。日本語のドメインは xn-- の形にする", () => {
    expect(normalizeLinkDomain(" https://Go.Example.com/abc ")).toEqual({ ok: true, domain: "go.example.com" });
    expect(normalizeLinkDomain("go.example.com.")).toEqual({ ok: true, domain: "go.example.com" });
    expect(normalizeLinkDomain("go.日本語.jp")).toEqual({ ok: true, domain: "go.xn--wgv71a119e.jp" });
  });

  it("ドメインそのもの（apex）は使わず、go. を付けた案を出す", () => {
    expect(normalizeLinkDomain("example.com")).toMatchObject({ ok: false, suggestion: "go.example.com" });
    expect(normalizeLinkDomain("example.co.jp")).toMatchObject({ ok: false, suggestion: "go.example.co.jp" });
    expect(isApexDomain("go.example.co.jp")).toBe(false);
  });

  it("矢書・Vercel のドメイン、IP アドレス、内部の名前、形の崩れたものは使えない", () => {
    for (const bad of ["go.yabumi.app", "x.vercel.app", "1.2.3.4", "go.localhost", "a.b.local", "go.example.test", "go..example.com", "go.-a.com", "user@go.example.com", "go.example.com:8080", ""]) {
      expect(normalizeLinkDomain(bad).ok, bad).toBe(false);
    }
  });

  it("DNS の「名前」の欄と、買ったドメインの部分", () => {
    expect(apexOf("go.example.com")).toBe("example.com");
    expect(apexOf("go.example.co.jp")).toBe("example.co.jp");
    expect(dnsRecordName("go.example.com", "example.com")).toBe("go");
    expect(dnsRecordName("link.app.example.com", "example.com")).toBe("link.app");
    expect(dnsRecordName("_vercel.example.com", "example.com")).toBe("_vercel");
  });

  it("矢書全体の上限は既定 40、LINK_DOMAIN_LIMIT で変えられる", () => {
    expect(linkDomainLimit(undefined)).toBe(40);
    expect(linkDomainLimit("100")).toBe(100);
    expect(linkDomainLimit("abc")).toBe(40);
  });
});

describe("利用者のドメインで開かれたとき（proxy）", () => {
  const env = ["https://go.yabumi.app", "https://yabumi.app"] as const;

  it("矢書のホスト（APP_URL とそのサブドメイン、vercel.app、ローカル）は見分ける", () => {
    const e = { appUrl: env[1], shortLinkBaseUrl: env[0] };
    for (const h of ["yabumi.app", "www.yabumi.app", "go.yabumi.app", "yabumi-x.vercel.app", "localhost:3100", "127.0.0.1"]) expect(isYabumiHost(h, e), h).toBe(true);
    expect(isYabumiHost("go.example.com", e)).toBe(false);
    // APP_URL がなければ、利用者のドメインの扱いをしない
    expect(isYabumiHost("go.example.com", {})).toBe(true);
  });

  it("/<code> は、開いたドメインを付けて転送の処理に回し、つながりの確認のパスには矢書の印を返す", () => {
    expect(shortLinkRoute(new URL("https://go.example.com/Ab3dE5fG?x=1"), ...env)).toEqual({ type: "rewrite", pathname: "/go/Ab3dE5fG/go.example.com" });
    expect(shortLinkRoute(new URL("https://Go.Example.com./Ab3dE5fG"), ...env)).toEqual({ type: "rewrite", pathname: "/go/Ab3dE5fG/go.example.com" });
    expect(shortLinkRoute(new URL(`https://go.example.com${LINK_CHECK_PATH}`), ...env)).toEqual({ type: "respond", status: 200, body: LINK_CHECK_BODY });
  });

  it("ほかのパス（ログインなど矢書の画面、トップ、API）は 404 にする", () => {
    for (const path of ["/", "/login", "/api/jobs/publish", "/privacy/x", "/projects/x", "/Ab3dE5fG/x"]) {
      expect(shortLinkRoute(new URL(`https://go.example.com${path}`), ...env), path).toMatchObject({ type: "respond", status: 404 });
    }
    // コードの形の言葉（/projects・/privacy など）は /go に回る。そのコードのリンクはないので、/go が 404 を返す（矢書の画面は出ない）
    expect(shortLinkRoute(new URL("https://go.example.com/projects"), ...env)).toEqual({ type: "rewrite", pathname: "/go/projects/go.example.com" });
    // /go/<code> もどのホストでも転送の処理に回し、開いたドメインを付け直す（/_ や別のドメインを入れても、矢書のホストとしては開けない）
    expect(shortLinkRoute(new URL("https://go.example.com/go/Ab3dE5fG"), ...env)).toEqual({ type: "rewrite", pathname: "/go/Ab3dE5fG/go.example.com" });
    expect(shortLinkRoute(new URL("https://go.example.com/go/Ab3dE5fG/_"), ...env)).toEqual({ type: "rewrite", pathname: "/go/Ab3dE5fG/go.example.com" });
    expect(shortLinkRoute(new URL("https://go.example.com/go"), ...env)).toMatchObject({ type: "respond", status: 404 });
    // 矢書のホストは今までどおり
    expect(shortLinkRoute(new URL("https://yabumi.app/login"), ...env)).toBeNull();
    // 開いたホストはヘッダーで見る（next dev では URL のホストが待ち受けのアドレスになる）
    expect(shortLinkRoute(new URL("http://127.0.0.1:3103/login"), ...env, "go.example.com")).toMatchObject({ type: "respond", status: 404 });
    expect(shortLinkRoute(new URL("http://127.0.0.1:3103/login"), ...env, "127.0.0.1:3103")).toBeNull();
  });
});

describe("Vercel の API の呼び方", () => {
  function mockFetch(responses: { status: number; body: unknown }[]) {
    const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
    const fetcher = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined, auth: (init?.headers as Record<string, string>).Authorization });
      const r = responses.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
    return { calls, fetcher };
  }

  it("トークンかプロジェクトがなければ使わない（画面は準備中）", () => {
    expect(vercelConfig({})).toBeNull();
    expect(vercelConfig({ VERCEL_API_TOKEN: "t" })).toBeNull();
    expect(vercelConfig({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "prj_1", VERCEL_TEAM_ID: "team_1" })).toEqual({ token: "t", projectId: "prj_1", teamId: "team_1" });
  });

  it("足す・確かめる・向きを見る・外すを、決まったパスとチームで呼ぶ", async () => {
    const { calls, fetcher } = mockFetch([
      { status: 200, body: { name: "go.example.com", apexName: "example.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=go.example.com,abc", reason: "x" }] } },
      { status: 200, body: { verified: true } },
      { status: 200, body: { misconfigured: true, configuredBy: null, recommendedCNAME: [{ rank: 2, value: "cname.vercel-dns.com." }, { rank: 1, value: "abc.vercel-dns-017.com." }] } },
      { status: 404, body: { error: { code: "not_found", message: "x" } } },
    ]);
    const v = vercelDomains({ token: "tok", projectId: "prj_1", teamId: "team_1" }, fetcher);
    expect(await v.add("go.example.com")).toMatchObject({ verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com" }] });
    expect(await v.verify("go.example.com")).toBe(true);
    expect(await v.config("go.example.com")).toEqual({ misconfigured: true, configuredBy: null, recommendedCNAME: "abc.vercel-dns-017.com" });
    await expect(v.remove("go.example.com")).resolves.toBeUndefined();
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /v10/projects/prj_1/domains",
      "POST /v9/projects/prj_1/domains/go.example.com/verify",
      "GET /v6/domains/go.example.com/config",
      "DELETE /v9/projects/prj_1/domains/go.example.com",
    ]);
    expect(calls.every((c) => new URL(c.url).searchParams.get("teamId") === "team_1" && c.auth === "Bearer tok")).toBe(true);
    expect(new URL(calls[2].url).searchParams.get("projectIdOrName")).toBe("prj_1");
    expect(JSON.parse(calls[0].body!)).toEqual({ name: "go.example.com" });
  });

  it("失敗は状態と理由を持った例外にする", async () => {
    const { fetcher } = mockFetch([{ status: 409, body: { error: { code: "domain_already_in_use", message: "in use" } } }]);
    const err = await vercelDomains({ token: "t", projectId: "p" }, fetcher).add("go.example.com").catch((e) => e);
    expect(err).toBeInstanceOf(VercelApiError);
    expect(err).toMatchObject({ status: 409, code: "domain_already_in_use" });
  });
});

describe("DNS over HTTPS で引く", () => {
  // リゾルバごとの答えを決められる fetch のまね
  function doh(answers: Record<string, { status: number; body?: unknown } | "fail">) {
    return (async (url: URL | string) => {
      const host = new URL(String(url)).host;
      const a = answers[host];
      if (!a || a === "fail") throw new Error("network");
      return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
    }) as typeof fetch;
  }
  const txt = (data: string) => ({ status: 200, body: { Status: 0, Answer: [{ type: 16, data }] } });

  it("2 つのリゾルバに聞き、どちらかに見えればある。長い TXT の分かれた文字列はつなぐ", async () => {
    const lookup = dohLookup(doh({ "cloudflare-dns.com": txt('"yabumi-verify=" "abc"'), "dns.google": { status: 200, body: { Status: 0 } } }));
    expect(await lookup("_yabumi.go.example.com", "TXT")).toEqual({ records: ["yabumi-verify=abc"], answered: 2, missingEverywhere: false });
  });

  it("「ない」は、答えたリゾルバのすべてで見えないとき。どちらも答えなければ、わからない", async () => {
    expect(await dohLookup(doh({ "cloudflare-dns.com": { status: 200, body: { Status: 3 } }, "dns.google": "fail" }))("x.example.com", "TXT")).toEqual({ records: [], answered: 1, missingEverywhere: true });
    expect(await dohLookup(doh({ "cloudflare-dns.com": "fail", "dns.google": { status: 200, body: { Status: 2 } } }))("x.example.com", "TXT")).toEqual({ records: [], answered: 0, missingEverywhere: false });
  });

  it("CNAME は小文字にして末尾の点を外す。ほかの種類の答えは混ぜない", async () => {
    const body = { Status: 0, Answer: [{ type: 5, data: "ABC.Vercel-DNS-017.com." }, { type: 1, data: "76.76.21.21" }] };
    const lookup = dohLookup(doh({ "cloudflare-dns.com": { status: 200, body }, "dns.google": { status: 200, body } }));
    expect((await lookup("go.example.com", "CNAME")).records).toEqual(["abc.vercel-dns-017.com"]);
  });

  it("持ち主の確認の TXT の名前と値", () => {
    expect(ownershipRecordName("go.example.com")).toBe("_yabumi.go.example.com");
    expect(ownershipRecordValue("tok")).toBe("yabumi-verify=tok");
  });
});
