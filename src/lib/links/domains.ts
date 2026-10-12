import { resolve4, resolveCname } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyOperatorOnce, type OperatorNotifyDeps } from "@/lib/notify/operator";
import type { Database } from "@/lib/supabase/database.types";
import {
  LINK_CHECK_BODY,
  LINK_CHECK_PATH,
  LINK_DOMAIN_CHECK_INTERVAL_MS,
  LINK_DOMAIN_DAILY_ATTEMPTS,
  LINK_DOMAIN_WARN_RATIO,
  linkDomainLimit,
  normalizeLinkDomain,
} from "./domain-rules";
import { shortLinkBase } from "./rules";
import { VercelApiError, vercelConfig, vercelDomains, type VercelDomains } from "./vercel";

// 短縮リンクに使う利用者のドメイン（F07、決定 D28。docs/architecture.md の 4.22）。
// 足す: 枠を取る（claim_link_domain）→ Vercel のプロジェクトに足す → 入れてほしい DNS の行（CNAME と、要るなら TXT）を残す。
// 確かめる: Vercel に所有の確認と DNS の向きを問い合わせ、つながっていれば https でそのドメインの確認用のパスを開く（証明書まで出ているか）。
// 外す: 行を消す（DB のトリガーが link_domain_removals に積む）→ Vercel から外す。外せなかったものは、次に誰かが足す・外すときにやり直す。
// admin は RLS を通らないクライアント。ownerId は呼ぶ側でログイン中の利用者であることを確かめておく

type Admin = SupabaseClient<Database>;
type Db = SupabaseClient<Database>;

export type LinkDomainRow = Database["public"]["Tables"]["link_domains"]["Row"];
export type LinkCheck = Exclude<LinkDomainRow["last_check"], "">;

// Vercel が向け先を返さなかったときの CNAME（Vercel の既定）
export const DEFAULT_CNAME_TARGET = "cname.vercel-dns.com";

export type LinkDomainDeps = {
  // Vercel の API。トークンがない環境では null（画面は「準備中」）
  vercel: VercelDomains | null;
  resolveCname?: (domain: string) => Promise<string[]>;
  resolve4?: (domain: string) => Promise<string[]>;
  // https://<domain>/__yabumi/link-check が矢書の答えを返すか（DNS と証明書がそろったか）
  probe?: (domain: string) => Promise<boolean>;
  limit?: number;
  now?: () => Date;
  notify?: OperatorNotifyDeps;
};

export function defaultLinkDomainDeps(): LinkDomainDeps {
  const cfg = vercelConfig();
  return { vercel: cfg ? vercelDomains(cfg) : null };
}

async function defaultProbe(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}${LINK_CHECK_PATH}`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return res.ok && (await res.text()).trim() === LINK_CHECK_BODY;
  } catch {
    return false;
  }
}

// プロジェクトのドメイン（本人のもの。RLS か、admin のときは呼ぶ側で確かめる）
export async function getLinkDomain(db: Db, projectId: string): Promise<LinkDomainRow | null> {
  const { data, error } = await db.from("link_domains").select("*").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data;
}

// そのプロジェクトの短縮リンクの URL の土台。つながった利用者のドメインがあればそれ、なければ矢書の短縮リンクのドメイン
export async function projectLinkBase(db: Db, projectId: string): Promise<string> {
  const { data, error } = await db.from("link_domains").select("domain").eq("project_id", projectId).eq("status", "active").maybeSingle();
  if (error) throw error;
  return data ? `https://${data.domain}` : shortLinkBase();
}

// 利用者のドメインで開かれたリンクが、そのドメインのプロジェクトのものか（ほかの人のコードを開けないように）
export async function linkAllowedOnDomain(admin: Admin, projectId: string, host: string): Promise<boolean> {
  const domain = host.toLowerCase().replace(/:\d+$/, "").replace(/\.+$/, "");
  const { data, error } = await admin.from("link_domains").select("project_id").eq("domain", domain).eq("status", "active").maybeSingle();
  if (error) throw error;
  return data?.project_id === projectId;
}

export type AddResult = { ok: true } | { ok: false; error: string; suggestion?: string };

const CLAIM_ERRORS: Record<string, string> = {
  not_found: "プロジェクトが見つかりません。ログインし直してください。",
  already: "自分のドメインは 1 人 1 つまでです（ほかのプロジェクトで使っています）。使っているものを外してから足してください。",
  taken: "このドメインは、ほかの方が使っているか、外している途中です。別のドメイン（例: go2.<あなたのドメイン>）にするか、時間をおいてお試しください。",
  daily: `ドメインを足せるのは 1 日に ${LINK_DOMAIN_DAILY_ATTEMPTS} 回までです。明日もう一度お試しください。`,
  limit: "いま、自分のドメインを新しく受け付けられません（矢書全体の上限に達しています）。今のまま矢書のドメインの短縮リンクで数えられます。",
};

export async function addLinkDomain(admin: Admin, input: { ownerId: string; projectId: string; domain: string }, deps: LinkDomainDeps): Promise<AddResult> {
  if (!deps.vercel) return { ok: false, error: "この機能は準備中です。" };
  const checked = normalizeLinkDomain(input.domain);
  if (!checked.ok) return { ok: false, error: checked.error, suggestion: checked.suggestion };
  const domain = checked.domain;
  const limit = deps.limit ?? linkDomainLimit();

  // 外す途中のドメインがあれば、先に Vercel から外す（枠を空ける）
  await drainLinkDomainRemovals(admin, deps).catch((e) => console.error("[link-domain] 外す途中のドメインを片付けられませんでした", e instanceof Error ? e.message : e));

  const { data: claim, error } = await admin.rpc("claim_link_domain", {
    p_owner: input.ownerId,
    p_project: input.projectId,
    p_domain: domain,
    p_daily: LINK_DOMAIN_DAILY_ATTEMPTS,
    p_total: limit,
  });
  if (error) throw error;
  if (claim !== "ok") {
    if (claim === "limit") await notifyNearLimit(admin, limit, deps, true);
    return { ok: false, error: CLAIM_ERRORS[claim] ?? "ドメインを足せませんでした。" };
  }

  try {
    const added = await deps.vercel.add(domain);
    const txt = added.verified ? null : added.verification.find((v) => v.type.toUpperCase() === "TXT");
    const config = await deps.vercel.config(domain).catch(() => null);
    const { error: updateError } = await admin
      .from("link_domains")
      .update({
        cname_target: config?.recommendedCNAME ?? DEFAULT_CNAME_TARGET,
        txt_name: txt?.domain ?? "",
        txt_value: txt?.value ?? "",
      })
      .eq("project_id", input.projectId)
      .eq("owner_id", input.ownerId);
    if (updateError) throw updateError;
  } catch (e) {
    // 足せなかったら行を消す（トリガーが外す列に積むので、Vercel に半分だけ残ったものも片付く）
    await admin.from("link_domains").delete().eq("project_id", input.projectId).eq("owner_id", input.ownerId);
    await drainLinkDomainRemovals(admin, deps).catch(() => undefined);
    if (e instanceof VercelApiError && (e.status === 409 || e.status === 403)) {
      return { ok: false, error: "このドメインは、ほかのサービス（Vercel のほかのプロジェクト）で使われているため足せません。別のサブドメイン（例: go2.<あなたのドメイン>）にしてください。" };
    }
    if (e instanceof VercelApiError && e.status === 400) return { ok: false, error: "このドメインは足せませんでした。綴りを確かめてください。" };
    console.error("[link-domain] Vercel にドメインを足せませんでした", e instanceof Error ? e.message : e);
    return { ok: false, error: "いまドメインを足せませんでした。時間をおいてもう一度お試しください。" };
  }

  await notifyNearLimit(admin, limit, deps, false);
  return { ok: true };
}

// 矢書全体の数が上限に近づいたら（または達したら）、運営者に知らせる（7 日に 1 回）
async function notifyNearLimit(admin: Admin, limit: number, deps: LinkDomainDeps, reached: boolean) {
  try {
    const [{ count: used }, { count: removing }] = await Promise.all([
      admin.from("link_domains").select("id", { count: "exact", head: true }),
      admin.from("link_domain_removals").select("domain", { count: "exact", head: true }),
    ]);
    const total = (used ?? 0) + (removing ?? 0);
    if (!reached && total < Math.ceil(limit * LINK_DOMAIN_WARN_RATIO)) return;
    await notifyOperatorOnce(
      admin,
      reached ? `link_domains_limit:${limit}` : `link_domains_near_limit:${limit}`,
      7,
      {
        subject: reached ? "短縮リンクの利用者のドメインが上限に達しました" : "短縮リンクの利用者のドメインが上限に近づいています",
        text: [
          `利用者のドメイン（外す途中を含む）: ${total} / ${limit}`,
          "Vercel Hobby は 1 プロジェクトにドメイン 50 までです（矢書の分を除いて利用者は 40 まで。LINK_DOMAIN_LIMIT）。",
          "Pro にして LINK_DOMAIN_LIMIT を上げるか、受け付けを止めるかを決めてください（docs/architecture.md の 4.22）。",
        ].join("\n"),
      },
      deps.notify,
    );
  } catch (e) {
    console.error("[link-domain] 上限の知らせを送れませんでした", e instanceof Error ? e.message : e);
  }
}

function dnsCode(e: unknown): string {
  return (e as { code?: string })?.code ?? "";
}

// DNS の向きが Vercel に届いていないときに、「まだ届いていない」と「値が違う」を見分ける
async function classifyDns(domain: string, expected: string, deps: LinkDomainDeps): Promise<LinkCheck> {
  const cname = await (deps.resolveCname ?? resolveCname)(domain).catch((e) => {
    if (["ENODATA", "ENOTFOUND", "ESERVFAIL", "ETIMEOUT", "ECONNREFUSED"].includes(dnsCode(e))) return [] as string[];
    throw e;
  });
  if (cname.length) {
    const got = cname.map((c) => c.toLowerCase().replace(/\.$/, ""));
    // Vercel の向け先（xxx.vercel-dns-0xx.com も含む）なら、届きはじめているが Vercel の側がまだ見えていない
    return got.some((c) => c === expected.toLowerCase() || /(^|\.)vercel-dns(-\d+)?\.com$/.test(c)) ? "dns_missing" : "wrong_value";
  }
  const a = await (deps.resolve4 ?? resolve4)(domain).catch(() => [] as string[]);
  return a.length ? "wrong_value" : "dns_missing";
}

export type CheckResult = { ok: true; row: LinkDomainRow } | { ok: false; error: string };

export async function checkLinkDomain(admin: Admin, input: { ownerId: string; projectId: string }, deps: LinkDomainDeps): Promise<CheckResult> {
  if (!deps.vercel) return { ok: false, error: "この機能は準備中です。" };
  const { data: row, error } = await admin.from("link_domains").select("*").eq("project_id", input.projectId).eq("owner_id", input.ownerId).maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, error: "ドメインが見つかりません。もう一度入れてください。" };
  const now = (deps.now ?? (() => new Date()))();
  if (row.last_checked_at && now.getTime() - new Date(row.last_checked_at).getTime() < LINK_DOMAIN_CHECK_INTERVAL_MS) {
    return { ok: false, error: "いま確かめたところです。10 秒ほどおいてから押してください。" };
  }

  let check: LinkCheck;
  let cnameTarget = row.cname_target || DEFAULT_CNAME_TARGET;
  let txt = { name: row.txt_name, value: row.txt_value };
  try {
    // 1. 所有の確認（TXT が要るときだけ）
    const domain = await deps.vercel.get(row.domain);
    let verified = domain.verified;
    if (!verified) {
      const challenge = domain.verification.find((v) => v.type.toUpperCase() === "TXT");
      if (challenge) txt = { name: challenge.domain, value: challenge.value };
      verified = await deps.vercel.verify(row.domain).catch((e) => {
        if (e instanceof VercelApiError && e.status === 400) return false;
        throw e;
      });
    }
    // 2. DNS の向き
    const config = await deps.vercel.config(row.domain);
    if (config.recommendedCNAME) cnameTarget = config.recommendedCNAME;
    if (!verified) check = "txt_missing";
    else if (!config.misconfigured) check = (await (deps.probe ?? defaultProbe)(row.domain)) ? "ok" : "cert_pending";
    else if (config.configuredBy === "http") check = "proxied";
    else check = await classifyDns(row.domain, cnameTarget, deps);
    if (verified && txt.value && check !== "txt_missing") txt = { name: "", value: "" };
  } catch (e) {
    console.error("[link-domain] つながりを確かめられませんでした", e instanceof Error ? e.message : e);
    check = "error";
  }

  // つながったら使い始める。DNS が外れた・違うものになったら、yabumi.app に戻す（開けないリンクを作らないため）
  const status = check === "ok" ? "active" : ["dns_missing", "wrong_value", "proxied", "txt_missing"].includes(check) ? "pending" : row.status;
  const { data: updated, error: updateError } = await admin
    .from("link_domains")
    .update({
      status,
      last_check: check,
      last_checked_at: now.toISOString(),
      cname_target: cnameTarget,
      txt_name: txt.name,
      txt_value: txt.value,
      ...(status === "active" && row.status !== "active" ? { verified_at: now.toISOString() } : {}),
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return { ok: true, row: updated };
}

export async function removeLinkDomain(admin: Admin, input: { ownerId: string; projectId: string }, deps: LinkDomainDeps): Promise<void> {
  const { error } = await admin.from("link_domains").delete().eq("project_id", input.projectId).eq("owner_id", input.ownerId);
  if (error) throw error;
  await drainLinkDomainRemovals(admin, deps).catch((e) => console.error("[link-domain] Vercel から外せませんでした（次の機会にやり直します）", e instanceof Error ? e.message : e));
}

// 外す途中のドメインを Vercel から外す（外す・プロジェクトの削除・退会で DB のトリガーが積んだもの）。
// 外せなかったものは残し、次の機会にやり直す。5 回続けて外せなければ運営者に知らせる
export async function drainLinkDomainRemovals(admin: Admin, deps: LinkDomainDeps, max = 20): Promise<number> {
  if (!deps.vercel) return 0;
  const { data, error } = await admin.from("link_domain_removals").select("domain, attempts").order("created_at").limit(max);
  if (error) throw error;
  let removed = 0;
  for (const r of data ?? []) {
    try {
      await deps.vercel.remove(r.domain);
      await admin.from("link_domain_removals").delete().eq("domain", r.domain);
      removed++;
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 500) : "unknown";
      await admin.from("link_domain_removals").update({ attempts: r.attempts + 1, last_error: message }).eq("domain", r.domain);
      if (r.attempts + 1 >= 5) {
        await notifyOperatorOnce(
          admin,
          "link_domain_removal_failed",
          7,
          { subject: "利用者のドメインを Vercel から外せません", text: `Vercel から外せないドメインがあります（5 回以上）。link_domain_removals を見て、Vercel の Project → Settings → Domains から手で外してください。\n最後の理由: ${message}` },
          deps.notify,
        ).catch(() => undefined);
      }
    }
  }
  return removed;
}
