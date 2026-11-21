// 自分のドメインの短縮リンクの画面を確かめるための、偽の Vercel・偽の DNS・偽の証明書の確かめ（本物は呼ばない）。
// 使い方: node tests/helpers/fake-link-domain-server.mjs 3198
//   開発サーバーを LINK_DOMAIN_TEST_SERVER=http://127.0.0.1:3198 で起動する（src/lib/links/test-server.ts。本番では無視される）
// 状態はメモリだけ。DNS の行は、画面の確かめのスクリプトから /__control/dns で入れる:
//   POST /__control/dns {"name":"go.example.com","type":"CNAME","value":"abc.vercel-dns-017.com"}  （value を null にすると消す）
//   POST /__control/cert {"domain":"go.example.com","ready":true}  （証明書がそろったことにする）
//   POST /__control/vercel-txt {"domain":"go.example.com","required":true} （Vercel の持ち主の確認の 3 行目を要るようにする）
import { createServer } from "node:http";

const CNAME_TARGET = "abc123.vercel-dns-017.com";
const records = new Map(); // `${name}|${type}` -> value
const certs = new Set(); // 証明書がそろったドメイン
const domains = new Map(); // ドメイン -> { txtRequired }

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};
const apex = (d) => d.split(".").slice(-2).join(".");
const dnsHas = (name, type, value) => records.get(`${name}|${type}`) === value;

createServer((req, res) => {
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
    // Vercel の API
    const verification = (d) => (domains.get(d)?.txtRequired ? [{ type: "TXT", domain: `_vercel.${apex(d)}`, value: `vc-domain-verify=${d},fake0123` }] : []);
    const verified = (d) => !domains.get(d)?.txtRequired || dnsHas(`_vercel.${apex(d)}`, "TXT", `vc-domain-verify=${d},fake0123`);
    if (req.method === "POST" && /^\/v10\/projects\/[^/]+\/domains$/.test(p)) {
      const d = body.name;
      if (!domains.has(d)) domains.set(d, { txtRequired: false });
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
}).listen(Number(process.argv[2] ?? 3198), "127.0.0.1", () => console.log(`fake link-domain server on ${process.argv[2] ?? 3198}`));
