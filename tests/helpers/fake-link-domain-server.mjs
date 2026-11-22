// 自分のドメインの短縮リンクの画面を確かめるための、偽の Vercel・偽の DNS・偽の証明書の確かめ（本物は呼ばない）。
// 使い方: node tests/helpers/fake-link-domain-server.mjs 3198
//   開発サーバーを LINK_DOMAIN_TEST_SERVER=http://127.0.0.1:3198 で起動する（src/lib/links/test-server.ts。本番では無視される）
// 状態はメモリだけ。DNS の行は、画面の確かめのスクリプトから /__control/dns で入れる:
//   POST /__control/dns {"name":"go.example.com","type":"CNAME","value":"abc.vercel-dns-017.com"}  （value を null にすると消す）
//   POST /__control/cert {"domain":"go.example.com","ready":true}  （証明書がそろったことにする）
//   POST /__control/vercel-txt {"domain":"go.example.com","required":true} （Vercel の持ち主の確認の 3 行目を要るようにする）
//   POST /__control/vercel-domain {"domain":"go.example.com","attached":true} （運営者が手で付けたことにする。追加は 409）
//   POST /__control/vercel-domain {"domain":"go.example.com","addStatus":403} （追加をその番号で断る。ほかのチームが持っているなど）
//   GET  /__control/calls （Vercel の API を呼んだ数。「GET /v9/...」ごと）・POST /__control/reset（数を 0 に）
// テストからは startFakeLinkDomainServer(0) で起動できる（空いている番号を使い、{ url, close } を返す）
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const CNAME_TARGET = "abc123.vercel-dns-017.com";

export function startFakeLinkDomainServer(port = 3198) {
const records = new Map(); // `${name}|${type}` -> value
const certs = new Set(); // 証明書がそろったドメイン
const domains = new Map(); // ドメイン -> { txtRequired }
const refused = new Map(); // ドメイン -> 追加を断る番号（409・403）
const calls = new Map(); // 「METHOD /v9/projects/:p/domains/:d」-> 呼ばれた数

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};
const apex = (d) => d.split(".").slice(-2).join(".");
const dnsHas = (name, type, value) => records.get(`${name}|${type}`) === value;

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://localhost");
    const body = raw ? JSON.parse(raw) : {};
    const p = url.pathname;
    // 操作（画面の確かめのスクリプトから）
    if (p === "/__control/dns") {
      const key = `${body.name}|${body.type}`;
      if (body.value == null) records.delete(key);
      else records.set(key, body.value);
      return send(res, 200, { ok: true });
    }
    if (p === "/__control/cert") {
      if (body.ready) certs.add(body.domain);
      else certs.delete(body.domain);
      return send(res, 200, { ok: true });
    }
    if (p === "/__control/vercel-domain") {
      if (body.attached) domains.set(body.domain, { ...(domains.get(body.domain) ?? {}), txtRequired: false });
      if (body.addStatus) refused.set(body.domain, body.addStatus);
      else refused.delete(body.domain);
      return send(res, 200, { ok: true });
    }
    if (p === "/__control/calls") return send(res, 200, Object.fromEntries(calls));
    if (p === "/__control/reset") {
      calls.clear();
      return send(res, 200, { ok: true });
    }
    if (p === "/__control/vercel-txt") {
      domains.set(body.domain, { ...(domains.get(body.domain) ?? {}), txtRequired: !!body.required });
      return send(res, 200, { ok: true });
    }
    // DNS over HTTPS（Cloudflare・Google の JSON と同じ形）
    if (p === "/dns-query") {
      const name = url.searchParams.get("name");
      const type = url.searchParams.get("type");
      const code = { A: 1, CNAME: 5, TXT: 16 }[type];
      const value = records.get(`${name}|${type}`);
      if (value === undefined) return send(res, 200, { Status: 3 });
      return send(res, 200, { Status: 0, Answer: [{ type: code, data: type === "TXT" ? `"${value}"` : `${value}.` }] });
    }
    // 証明書の確かめ（https://<ドメイン>/__yabumi/link-check の代わり）
    const probe = p.match(/^\/probe\/(.+)$/);
    if (probe) {
      const d = decodeURIComponent(probe[1]);
      res.statusCode = certs.has(d) && dnsHas(d, "CNAME", CNAME_TARGET) ? 200 : 404;
      return res.end(res.statusCode === 200 ? "yabumi-link-domain-ok" : "");
    }
    // Vercel の API（呼んだ数を数える）
    if (/^\/v\d+\//.test(p)) {
      const key = `${req.method} ${p.replace(/\/projects\/[^/]+/, "/projects/:p").replace(/\/domains\/[^/]+/, "/domains/:d")}`;
      calls.set(key, (calls.get(key) ?? 0) + 1);
    }
    const verification = (d) => (domains.get(d)?.txtRequired ? [{ type: "TXT", domain: `_vercel.${apex(d)}`, value: `vc-domain-verify=${d},fake0123` }] : []);
    const verified = (d) => !domains.get(d)?.txtRequired || dnsHas(`_vercel.${apex(d)}`, "TXT", `vc-domain-verify=${d},fake0123`);
    if (req.method === "POST" && /^\/v10\/projects\/[^/]+\/domains$/.test(p)) {
      const d = body.name;
      if (refused.has(d)) return send(res, refused.get(d), { error: { code: refused.get(d) === 403 ? "forbidden" : "domain_already_in_use", message: "in use" } });
      if (domains.has(d)) return send(res, 409, { error: { code: "domain_already_in_use", message: "already in this project" } });
      domains.set(d, { txtRequired: false });
      return send(res, 200, { name: d, apexName: apex(d), verified: verified(d), verification: verified(d) ? [] : verification(d) });
    }
    let m = p.match(/^\/v9\/projects\/[^/]+\/domains\/([^/]+)\/verify$/);
    if (m && req.method === "POST") return send(res, 200, { verified: verified(decodeURIComponent(m[1])) });
    m = p.match(/^\/v9\/projects\/[^/]+\/domains\/([^/]+)$/);
    if (m && req.method === "GET") {
      const d = decodeURIComponent(m[1]);
      if (!domains.has(d)) return send(res, 404, { error: { code: "not_found", message: "not found" } });
      return send(res, 200, { name: d, apexName: apex(d), verified: verified(d), verification: verified(d) ? [] : verification(d) });
    }
    if (m && req.method === "DELETE") {
      domains.delete(decodeURIComponent(m[1]));
      return send(res, 200, {});
    }
    m = p.match(/^\/v6\/domains\/([^/]+)\/config$/);
    if (m) {
      const d = decodeURIComponent(m[1]);
      return send(res, 200, { misconfigured: !dnsHas(d, "CNAME", CNAME_TARGET), configuredBy: dnsHas(d, "CNAME", CNAME_TARGET) ? "CNAME" : null, recommendedCNAME: [{ rank: 1, value: `${CNAME_TARGET}.` }] });
    }
    send(res, 404, { error: { code: "not_found", message: `${req.method} ${p}` } });
  });
});
return new Promise((resolve) =>
  server.listen(port, "127.0.0.1", () => {
    const { port: p } = server.address();
    resolve({ url: `http://127.0.0.1:${p}`, close: () => new Promise((r) => server.close(() => r())) });
  }),
);
}

// node で直接動かしたとき（画面の確かめ）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 3198);
  startFakeLinkDomainServer(port).then(() => console.log(`fake link-domain server on ${port}`));
}
