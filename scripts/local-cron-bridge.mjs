// ローカル専用: pg_cron（Docker の中）から開発サーバーのジョブ API を呼ぶための中継。
// 開発サーバーは https（自己署名の証明書）なので、pg_net から直接は呼べない。
// http://127.0.0.1:3101/api/jobs/... を受けて https://localhost:3100/api/jobs/... に渡す。
// 使い方は README の「予約投稿のジョブ」。本番では使わない（pg_cron が本番の URL を直接呼ぶ）。
import http from "node:http";
import https from "node:https";

const LISTEN_PORT = Number(process.env.BRIDGE_PORT ?? 3101);
const TARGET = new URL(process.env.BRIDGE_TARGET ?? "https://localhost:3100");

const server = http.createServer((req, res) => {
  // ジョブ API 以外は通さない
  if (req.method !== "POST" || !req.url?.startsWith("/api/jobs/")) {
    res.writeHead(404).end();
    return;
  }
  const upstream = https.request(
    {
      hostname: TARGET.hostname,
      port: TARGET.port,
      path: req.url,
      method: "POST",
      headers: { ...req.headers, host: TARGET.host },
      // 自分のマシンの開発サーバーだけに向けるので、自己署名の証明書を受け入れる
      rejectUnauthorized: false,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
      console.log(`${new Date().toLocaleTimeString("ja-JP")} ${req.url} → ${up.statusCode}`);
    },
  );
  upstream.on("error", (e) => {
    console.error(`${new Date().toLocaleTimeString("ja-JP")} ${req.url} → 開発サーバーにつながりません（${e.message}）`);
    res.writeHead(502).end();
  });
  req.pipe(upstream);
});

// 127.0.0.1 だけで待つ（同じネットワークの他の機器からは呼べない）。Docker Desktop の host.docker.internal からは届く
server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`ジョブの中継: http://127.0.0.1:${LISTEN_PORT}/api/jobs/* → ${TARGET.origin}`);
});
