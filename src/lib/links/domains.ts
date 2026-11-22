import { linkDomainTestServer } from "./test-server";
import { randomBytes } from "node:crypto";
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
import { dohLookup, ownershipRecordName, ownershipRecordValue, type Lookup } from "./doh";
import { shortLinkBase } from "./rules";
import { VercelApiError, vercelConfig, vercelDomains, type VercelDomains } from "./vercel";

// 短縮リンクに使う利用者のドメイン（F07、決定 D28。docs/architecture.md の 4.22）。
// 足す: 枠を取る（claim_link_domain）→ Vercel のプロジェクトに足す → 入れてほしい DNS の行（CNAME と、要るなら TXT）を残す。
// 確かめる: Vercel に所有の確認と DNS の向きを問い合わせ、yabumi の持ち主の確認（_yabumi.<ドメイン> の TXT に利用者ごとの合言葉）を DNS over HTTPS で確かめ、
// つながっていれば https でそのドメインの確認用のパスを開く（証明書まで出ているか）。yabumi の持ち主の確認が通るまでは active にしない
// （Vercel は TXT を求めずに verified を返すことがあり、他人の使われなくなった CNAME を乗っ取れてしまうため。2026-10-12）。
// つながらないまま 7 日たったものは取り消す（expire_link_domains）。毎日のジョブで、つながったものの TXT と CNAME が残っているか確かめる。
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
  // DNS を引く（既定は DNS over HTTPS で 2 つのリゾルバに聞く。doh.ts）
  lookup?: Lookup;
  // https://<domain>/__yabumi/link-check が yabumi の答えを返すか（DNS と証明書がそろったか）
  probe?: (domain: string) => Promise<boolean>;
  limit?: number;
  now?: () => Date;
  notify?: OperatorNotifyDeps;
};

// 持ち主の確認の合言葉（24 バイトの乱数 = 32 文字。ドメインを足すたびに作り直す）
export function newOwnershipToken(): string {
  return randomBytes(24).toString("base64url");
}

// つながらないまま置いておける日数（画面にも出す）
export const PENDING_DAYS = 7;

export function defaultLinkDomainDeps(): LinkDomainDeps {
  const cfg = vercelConfig();
  return { vercel: cfg ? vercelDomains(cfg) : null };
}

async function defaultProbe(domain: string): Promise<boolean> {
  try {
    // 偽の宛先を使うとき（画面の確かめ。本番では使わない）は、その宛先に、このドメインの証明書がそろったかを聞く
    const test = linkDomainTestServer();
    const res = await fetch(test ? `${test}/probe/${encodeURIComponent(domain)}` : `https://${domain}${LINK_CHECK_PATH}`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8_000) });
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

// そのプロジェクトの短縮リンクの URL の土台。つながった利用者のドメインがあればそれ、なければ yabumi の短縮リンクのドメイン
export async function projectLinkBase(db: Db, projectId: string): Promise<string> {
  // active で、yabumi の持ち主の確認が済んだものだけ（確かめていないものは使わない。DB の check でも守る）
  const { data, error } = await db.from("link_domains").select("domain").eq("project_id", projectId).eq("status", "active").not("owner_verified_at", "is", null).maybeSingle();
  if (error) throw error;
  return data ? `https://${data.domain}` : shortLinkBase();
}

// 利用者のドメインで開かれたリンクが、そのドメインのプロジェクトのものか（ほかの人のコードを開けないように）
export async function linkAllowedOnDomain(admin: Admin, projectId: string, host: string): Promise<boolean> {
  const domain = host.toLowerCase().replace(/:\d+$/, "").replace(/\.+$/, "");
  const { data, error } = await admin.from("link_domains").select("project_id").eq("domain", domain).eq("status", "active").not("owner_verified_at", "is", null).maybeSingle();
  if (error) throw error;
  return data?.project_id === projectId;
}

export type AddResult = { ok: true } | { ok: false; error: string; suggestion?: string };

const CLAIM_ERRORS: Record<string, string> = {
  not_found: "プロジェクトが見つかりません。ログインし直してください。",
  already: "自分のドメインは 1 人 1 つまでです。別の宣伝するもので、もう使っています。そちらの「短縮リンク」の画面で使うのをやめてから、追加してください。",
  taken: "このドメインは、いま使えません。ほかの人が使っているか、使うのをやめたばかりです。時間をおいてお試しいただくか、別の名前にしてください。たとえば go2.<あなたのドメイン> です。",
  daily: `ドメインを追加できるのは 1 日に ${LINK_DOMAIN_DAILY_ATTEMPTS} 回までです。明日もう一度お試しください。`,
  limit: "いまは、自分のドメインを新しく追加できません。yabumi を使う人みんなで、上限に達しています。追加しなくても、リンクが押された数は今までどおり数えます。",
};

const IN_USE_ELSEWHERE = "このドメインは、ほかのサービスですでに使われています。別の名前にしてください。たとえば go2.<あなたのドメイン> です。";

// claim_link_domain で取った行を、Vercel から外さずに消す。行を消すと DB のトリガーがドメインを外す列に積むので、
// 消す前にドメインを、どこにもない名前（<行の id>.invalid）に置きかえる。積まれるのはその名前だけになり、すぐ列から消す
// （マイグレーションを足さずに直すため。2026-11-22 セキュリティの確認 L1）
// どの段で失敗しても投げる（消せたことにしない。2026-11-22 自動のセキュリティレビューの指摘）
async function discardClaim(admin: Admin, input: { ownerId: string; projectId: string }) {
  const { data: row, error: readError } = await admin.from("link_domains").select("id").eq("project_id", input.projectId).eq("owner_id", input.ownerId).maybeSingle();
  if (readError) throw readError;
  if (!row) return;
  const placeholder = `discard-${row.id.replace(/-/g, "")}.invalid`;
  const { error: renameError } = await admin.from("link_domains").update({ domain: placeholder }).eq("id", row.id);
  if (renameError) throw renameError;
  const { error: deleteError } = await admin.from("link_domains").delete().eq("id", row.id);
  if (deleteError) throw deleteError;
  const { error: dequeueError } = await admin.from("link_domain_removals").delete().eq("domain", placeholder);
  if (dequeueError) throw dequeueError;
}

// claim_link_domain と同じ決まりのうち、DB だけで見られるもの（Vercel を呼ぶ前に断る）。断るときはその理由、通れば null。
// 本当の判定は claim_link_domain がロックの中で行う（ここは先に断るためだけ）
async function precheckClaim(admin: Admin, ownerId: string, projectId: string, domain: string): Promise<string | null> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [project, mine, used, removing, attempts] = await Promise.all([
    admin.from("projects").select("id", { count: "exact", head: true }).eq("id", projectId).eq("owner_id", ownerId),
    admin.from("link_domains").select("id", { count: "exact", head: true }).or(`owner_id.eq.${ownerId},project_id.eq.${projectId}`),
    admin.from("link_domains").select("id", { count: "exact", head: true }).eq("domain", domain),
    admin.from("link_domain_removals").select("domain", { count: "exact", head: true }).eq("domain", domain),
    admin.from("link_domain_attempts").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).gt("created_at", dayAgo),
  ]);
  for (const r of [project, mine, used, removing, attempts]) if (r.error) throw r.error;
  if (!project.count) return "not_found";
  if (mine.count) return "already";
  if (used.count || removing.count) return "taken";
  if ((attempts.count ?? 0) >= LINK_DOMAIN_DAILY_ATTEMPTS) return "daily";
  return null;
}

// Vercel のプロジェクトにもう付いているか（404 なら付いていない）。ほかの失敗は投げる
async function attachedInVercel(vercel: VercelDomains, domain: string): Promise<boolean> {
  try {
    await vercel.get(domain);
    return true;
  } catch (e) {
    if (e instanceof VercelApiError && e.status === 404) return false;
    throw e;
  }
}

export async function addLinkDomain(admin: Admin, input: { ownerId: string; projectId: string; domain: string }, deps: LinkDomainDeps): Promise<AddResult> {
  if (!deps.vercel) return { ok: false, error: "まだ使えません。yabumi の運営の準備ができたら、使えるようになります。" };
  const checked = normalizeLinkDomain(input.domain);
  if (!checked.ok) return { ok: false, error: checked.error, suggestion: checked.suggestion };
  const domain = checked.domain;
  const limit = deps.limit ?? linkDomainLimit();

  // 外す途中のドメインがあれば、先に Vercel から外す（枠を空ける）
  await drainLinkDomainRemovals(admin, deps).catch((e) => console.error("[link-domain] 外す途中のドメインを片付けられませんでした", e instanceof Error ? e.message : e));

  // Vercel を呼ぶ前に、DB だけで断れるものを断る（すでに持っている・ほかの人が使っている・1 日の回数）。
  // そのうえで、Vercel に付いているかを確かめる 1 回を、1 日の回数として先に記録する。記録しないと、付いているドメインを何度も送って
  // 運営者の Vercel のトークンを回数の上限なしに使わせてしまう（2026-11-22 自動のセキュリティレビューの指摘。マイグレーションは足さない）
  const pre = await precheckClaim(admin, input.ownerId, input.projectId, domain);
  if (pre) return { ok: false, error: CLAIM_ERRORS[pre] ?? "ドメインを追加できませんでした。" };
  const { data: reserved, error: reserveError } = await admin.from("link_domain_attempts").insert({ owner_id: input.ownerId, domain }).select("id").single();
  if (reserveError) throw reserveError;

  // Vercel のプロジェクトにもう付いているドメイン（運営者が手で付けたものなど）は、枠を取る前に断る。
  // 枠を取ってから確かめると、その間に利用者が「使うのをやめる」を同時に送ったとき、行を消すトリガーが運営者のドメインを外す列に積めてしまう（L1）
  let attached: boolean;
  try {
    attached = await attachedInVercel(deps.vercel, domain);
  } catch (e) {
    console.error("[link-domain] Vercel にドメインがあるかを確かめられませんでした", e instanceof Error ? e.message : e);
    return { ok: false, error: "いまドメインを追加できませんでした。時間をおいてもう一度お試しください。" };
  }
  if (attached) return { ok: false, error: IN_USE_ELSEWHERE };

  const { data: claim, error } = await admin.rpc("claim_link_domain", {
    p_owner: input.ownerId,
    p_project: input.projectId,
    p_domain: domain,
    p_token: newOwnershipToken(),
    // 先に記録した確かめの 1 回は、この追加と同じ 1 回なので、ここでは 1 つ多く数えてよい（記録は枠を取れたら消す。claim が記録を入れる）
    p_daily: LINK_DOMAIN_DAILY_ATTEMPTS + 1,
    p_total: limit,
  });
  if (error) throw error;
  if (claim === "ok") {
    const { error: unreserveError } = await admin.from("link_domain_attempts").delete().eq("id", reserved.id);
    if (unreserveError) throw unreserveError;
  }
  if (claim !== "ok") {
    if (claim === "limit") await notifyNearLimit(admin, limit, deps, true);
    return { ok: false, error: CLAIM_ERRORS[claim] ?? "ドメインを追加できませんでした。" };
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
    // 409・403: Vercel が「ほかで使われている」と断った。yabumi が付けたものではないので、外す列に積まずに行だけ消す（L1）。
    // 枠を取る前に、このプロジェクトに付いていないことは確かめてあるので、万一ここで積まれても、外すのは付いていないもの（404）だけになる
    if (e instanceof VercelApiError && (e.status === 409 || e.status === 403)) {
      await discardClaim(admin, input);
      return { ok: false, error: IN_USE_ELSEWHERE };
    }
    // ほかの失敗は行を消す（トリガーが外す列に積むので、Vercel に半分だけ残ったものも片付く）
    await admin.from("link_domains").delete().eq("project_id", input.projectId).eq("owner_id", input.ownerId);
    await drainLinkDomainRemovals(admin, deps).catch(() => undefined);
    if (e instanceof VercelApiError && e.status === 400) return { ok: false, error: "このドメインは追加できませんでした。綴りを確認してください。" };
    console.error("[link-domain] Vercel にドメインを足せませんでした", e instanceof Error ? e.message : e);
    return { ok: false, error: "いまドメインを追加できませんでした。時間をおいてもう一度お試しください。" };
  }

  await notifyNearLimit(admin, limit, deps, false);
  return { ok: true };
}

// yabumi 全体の数が上限に近づいたら（または達したら）、運営者に知らせる（7 日に 1 回）
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
          "Vercel Hobby は 1 プロジェクトにドメイン 50 までです（yabumi の分を除いて利用者は 40 まで。LINK_DOMAIN_LIMIT）。",
          "Pro にして LINK_DOMAIN_LIMIT を上げるか、受け付けを止めるかを決めてください（docs/architecture.md の 4.22）。",
        ].join("\n"),
      },
      deps.notify,
    );
  } catch (e) {
    console.error("[link-domain] 上限の知らせを送れませんでした", e instanceof Error ? e.message : e);
  }
}

const VERCEL_TARGET = /(^|\.)vercel-dns(-\d+)?\.com$/;

// DNS の向きが Vercel に届いていないときに、「まだ届いていない」と「値が違う」を見分ける
async function classifyDns(domain: string, expected: string, lookup: Lookup): Promise<LinkCheck> {
  const cname = await lookup(domain, "CNAME");
  if (cname.records.length) {
    // Vercel の向け先（xxx.vercel-dns-0xx.com も含む）なら、届きはじめているが Vercel の側がまだ見えていない
    return cname.records.some((c) => c === expected.toLowerCase() || VERCEL_TARGET.test(c)) ? "dns_missing" : "wrong_value";
  }
  const a = await lookup(domain, "A");
  return a.records.length ? "wrong_value" : "dns_missing";
}

// yabumi の持ち主の確認の TXT が見えるか（どちらかのリゾルバに見えればよい）
async function ownerTxtFound(domain: string, token: string, lookup: Lookup): Promise<boolean> {
  if (!token) return false;
  const txt = await lookup(ownershipRecordName(domain), "TXT");
  return txt.records.includes(ownershipRecordValue(token));
}

// cooldownUntil: 続けて押されたとき、また押せる時刻（画面はボタンに残りの秒を出す。エラーとしては出さない）
export type CheckResult = { ok: true; row: LinkDomainRow } | { ok: false; error: string; cooldownUntil?: string };

export async function checkLinkDomain(admin: Admin, input: { ownerId: string; projectId: string }, deps: LinkDomainDeps): Promise<CheckResult> {
  if (!deps.vercel) return { ok: false, error: "まだ使えません。yabumi の運営の準備ができたら、使えるようになります。" };
  const lookup = deps.lookup ?? dohLookup();
  await expireLinkDomains(admin, deps);
  const { data: row, error } = await admin.from("link_domains").select("*").eq("project_id", input.projectId).eq("owner_id", input.ownerId).maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, error: `ドメインが見つかりません。${PENDING_DAYS} 日たってもつながらなかったドメインは、削除しています。もう一度入れてください。` };
  const now = (deps.now ?? (() => new Date()))();
  const cooldown = (last: string) => ({
    ok: false as const,
    error: "いま確認したところです。10 秒ほどおいてから押してください。",
    cooldownUntil: new Date(new Date(last).getTime() + LINK_DOMAIN_CHECK_INTERVAL_MS).toISOString(),
  });
  if (row.last_checked_at && now.getTime() - new Date(row.last_checked_at).getTime() < LINK_DOMAIN_CHECK_INTERVAL_MS) return cooldown(row.last_checked_at);
  // 外に聞く前に、確認の枠を取る（last_checked_at が 10 秒より前か空のときだけ更新する条件つきの update）。
  // 同時に押されても、枠を取れた 1 つだけが Vercel と DNS に聞く（運営者の Vercel のトークンの上限を食わせない。セキュリティの確認 L2）
  const cutoff = new Date(now.getTime() - LINK_DOMAIN_CHECK_INTERVAL_MS).toISOString();
  // 枠を取れたかは、更新した行の数で見る（返す行で見ると、PostgREST が更新したあとの値で or() を当て直して 0 行になる）
  const { count: slot, error: slotError } = await admin
    .from("link_domains")
    .update({ last_checked_at: now.toISOString() }, { count: "exact" })
    .eq("id", row.id)
    .or(`last_checked_at.is.null,last_checked_at.lt."${cutoff}"`);
  if (slotError) throw slotError;
  if (!slot) return cooldown(now.toISOString());

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
    // 2. yabumi の持ち主の確認（利用者ごとの合言葉）
    const owner = await ownerTxtFound(row.domain, row.ownership_token, lookup);
    // 3. DNS の向き
    const config = await deps.vercel.config(row.domain);
    if (config.recommendedCNAME) cnameTarget = config.recommendedCNAME;
    if (!verified) check = "txt_missing";
    else if (!owner) check = "owner_txt_missing";
    else if (!config.misconfigured) check = (await (deps.probe ?? defaultProbe)(row.domain)) ? "ok" : "cert_pending";
    else if (config.configuredBy === "http") check = "proxied";
    else check = await classifyDns(row.domain, cnameTarget, lookup);
    if (verified && txt.value && check !== "txt_missing") txt = { name: "", value: "" };
  } catch (e) {
    console.error("[link-domain] つながりを確認できませんでした", e instanceof Error ? e.message : e);
    check = "error";
  }

  // つながったら使い始める。DNS が外れた・違うものになったら、yabumi.app に戻す（開けないリンクを作らないため）
  const status = check === "ok" ? "active" : ["dns_missing", "wrong_value", "proxied", "txt_missing", "owner_txt_missing"].includes(check) ? "pending" : row.status;
  const { data: updated, error: updateError } = await admin
    .from("link_domains")
    .update({
      status,
      last_check: check,
      last_checked_at: now.toISOString(),
      cname_target: cnameTarget,
      txt_name: txt.name,
      txt_value: txt.value,
      ...(status === "active" && row.status !== "active" ? { verified_at: now.toISOString(), owner_verified_at: now.toISOString() } : {}),
      ...(status === "active" ? { dns_confirmed_at: now.toISOString() } : {}),
      // つながっていたものが外れたら、そこから 7 日で取り消す
      ...(status === "pending" && row.status === "active" ? { pending_since: now.toISOString() } : {}),
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
// onlyDomains: テスト用。外すドメインを絞る（共有のローカル DB で、ほかのテストが積んだものに触らない）
export async function drainLinkDomainRemovals(admin: Admin, deps: LinkDomainDeps, max = 20, onlyDomains?: string[]): Promise<number> {
  if (!deps.vercel) return 0;
  let query = admin.from("link_domain_removals").select("domain, attempts").order("created_at").limit(max);
  if (onlyDomains) query = query.in("domain", onlyDomains);
  const { data, error } = await query;
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

// つながらないまま 7 日たったドメインを取り消し（DB の expire_link_domains）、Vercel からも外す。取り消した数を返す
export async function expireLinkDomains(admin: Admin, deps: LinkDomainDeps): Promise<number> {
  const { data, error } = await admin.rpc("expire_link_domains");
  if (error) throw error;
  if (data) await drainLinkDomainRemovals(admin, deps).catch((e) => console.error("[link-domain] 取り消したドメインを Vercel から外せませんでした", e instanceof Error ? e.message : e));
  return data ?? 0;
}

export type RecheckReport = { checked: number; lost: number; unknown: number; unconfirmed: number; expired: number };

// DNS で確かめられない（リゾルバが答えない）まま、つながりを残しておける日数。超えたら閉じる側に倒す
export const UNCONFIRMED_DAYS = 3;
// 1 回の見回りで、確かめられずに戻したものがこの数以上なら、yabumi の側の異常（DNS over HTTPS に届かない）として運営者に知らせる
export const UNCONFIRMED_NOTIFY_AT = 3;

// 毎日のジョブ: つながったドメインの、yabumi の持ち主の確認の TXT と CNAME がまだ残っているかを確かめ、外れていたら yabumi のドメインに戻す
// （持ち主がドメインを手放したり DNS の行を消したりしたあとに、別の人のリンクがそのドメインで開かないように）。
// リゾルバがどれも答えなかったものは、その日は外さないが、最後に確かめられてから 3 日を超えたら戻す（確かめられないときは閉じる側に倒す）。
// 戻したものが多ければ、yabumi の側の異常として運営者に知らせる。最後に、つながらないまま 7 日たったものを取り消す
export async function recheckLinkDomains(admin: Admin, deps: LinkDomainDeps, max = 500): Promise<RecheckReport> {
  const lookup = deps.lookup ?? dohLookup();
  const now = (deps.now ?? (() => new Date()))();
  const report: RecheckReport = { checked: 0, lost: 0, unknown: 0, unconfirmed: 0, expired: 0 };
  const { data, error } = await admin.from("link_domains").select("id, domain, ownership_token, cname_target, dns_confirmed_at, verified_at").eq("status", "active").order("last_checked_at", { ascending: true, nullsFirst: true }).limit(max);
  if (error) throw error;
  for (const row of data ?? []) {
    report.checked++;
    const [txt, cname] = await Promise.all([lookup(ownershipRecordName(row.domain), "TXT"), lookup(row.domain, "CNAME")]);
    if (txt.answered === 0 || cname.answered === 0) {
      report.unknown++;
      const confirmed = Date.parse(row.dns_confirmed_at ?? row.verified_at ?? "") || 0;
      if (now.getTime() - confirmed > UNCONFIRMED_DAYS * 86_400_000) {
        const { error: updateError } = await admin
          .from("link_domains")
          .update({ status: "pending", last_check: "error", last_checked_at: now.toISOString(), pending_since: now.toISOString() })
          .eq("id", row.id);
        if (updateError) throw updateError;
        report.unconfirmed++;
      }
      continue;
    }
    let lost: LinkCheck | null = null;
    if (!row.ownership_token || !txt.records.includes(ownershipRecordValue(row.ownership_token))) lost = "owner_txt_missing";
    else if (!cname.records.length) lost = "dns_missing";
    else if (!cname.records.some((c) => c === row.cname_target.toLowerCase() || VERCEL_TARGET.test(c))) lost = "wrong_value";
    const { error: updateError } = await admin
      .from("link_domains")
      .update(
        lost
          ? { status: "pending", last_check: lost, last_checked_at: now.toISOString(), pending_since: now.toISOString() }
          : { last_checked_at: now.toISOString(), dns_confirmed_at: now.toISOString() },
      )
      .eq("id", row.id);
    if (updateError) throw updateError;
    if (lost) report.lost++;
  }
  if (report.unconfirmed >= UNCONFIRMED_NOTIFY_AT) {
    await notifyOperatorOnce(
      admin,
      `link_domains_unconfirmed:${now.toISOString().slice(0, 10)}`,
      1,
      {
        subject: "利用者のドメインの DNS を確認できません",
        text: [
          `毎日の見回りで、DNS over HTTPS（Cloudflare・Google）が答えないまま ${UNCONFIRMED_DAYS} 日を超えたドメインを ${report.unconfirmed} 件、yabumi のドメインに戻しました（確認した ${report.checked} 件、答えがなかった ${report.unknown} 件）。`,
          "yabumi の側（Vercel から cloudflare-dns.com・dns.google に届かない）の異常の可能性があります。Vercel のログの [jobs/check-link-domains] を見てください（docs/architecture.md の 4.22）。",
          "直ったら、利用者が「確認する」を押せば、またつながります。",
        ].join("\n"),
      },
      deps.notify,
    ).catch((e) => console.error("[link-domain] 運営者に知らせられませんでした", e instanceof Error ? e.message : e));
  }
  report.expired = await expireLinkDomains(admin, deps);
  return report;
}
