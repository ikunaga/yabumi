// 利用者のドメインの DNS を、DNS over HTTPS（DoH）で引く（docs/architecture.md の 4.22、D28）。
// サーバー（Vercel）の OS の DNS は、前の答えを覚えていることがあり、足したばかりの行や、消した行が反映されにくい。
// そこで、運営の違う 2 つの公開のリゾルバ（Cloudflare 1.1.1.1 と Google 8.8.8.8）に HTTPS で聞き、答えを合わせて使う:
// - 「ある」は、どちらかに見えればある（足したばかりの行は、片方に先に届くことがある。リゾルバは無い行を作らない）
// - 「ない」は、答えたリゾルバのすべてで見えないときだけ（消した直後に片方が覚えていても、もう片方が答える）
// - どちらも答えられなかったら「わからない」（毎日の確かめでは、つながりを外さない）

export const DOH_RESOLVERS = [
  { name: "cloudflare", url: "https://cloudflare-dns.com/dns-query" },
  { name: "google", url: "https://dns.google/resolve" },
] as const;

const TYPE_CODE = { A: 1, CNAME: 5, TXT: 16 } as const;
export type DnsType = keyof typeof TYPE_CODE;

// 引いた結果。answered はリゾルバが答えた数（0 なら、ある・ないがわからない）
export type DnsLookup = { records: string[]; answered: number; missingEverywhere: boolean };

export type Lookup = (name: string, type: DnsType) => Promise<DnsLookup>;

type DohJson = { Status?: number; Answer?: { type: number; data: string }[] };

// TXT の答えは "..." で囲まれ、長いものは "a" "b" に分かれて来る
function normalize(type: DnsType, data: string): string {
  if (type === "TXT") return [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("") || data;
  return data.toLowerCase().replace(/\.$/, "");
}

async function ask(url: string, name: string, type: DnsType, fetcher: typeof fetch): Promise<string[] | null> {
  try {
    const u = new URL(url);
    u.searchParams.set("name", name);
    u.searchParams.set("type", type);
    const res = await fetcher(u, { headers: { accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as DohJson;
    // 0: あり / 3: その名前がない（NXDOMAIN）。ほかは答えられなかったもの
    if (json.Status === 3) return [];
    if (json.Status !== 0) return null;
    return (json.Answer ?? []).filter((a) => a.type === TYPE_CODE[type]).map((a) => normalize(type, a.data));
  } catch {
    return null;
  }
}

export function dohLookup(fetcher: typeof fetch = fetch): Lookup {
  return async (name, type) => {
    const answers = await Promise.all(DOH_RESOLVERS.map((r) => ask(r.url, name, type, fetcher)));
    const ok = answers.filter((a): a is string[] => a !== null);
    const records = [...new Set(ok.flat())];
    return { records, answered: ok.length, missingEverywhere: ok.length > 0 && records.length === 0 };
  };
}

// 矢書の持ち主の確認の TXT の名前と値
export function ownershipRecordName(domain: string): string {
  return `_yabumi.${domain}`;
}

export function ownershipRecordValue(token: string): string {
  return `yabumi-verify=${token}`;
}
