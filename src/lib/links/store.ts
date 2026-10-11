import type { SupabaseClient } from "@supabase/supabase-js";
import { isManualSns, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { CODE_PATTERN, findLinkableUrls, generateCode, shortLinkUrl, substituteLinks, substitutesBodyLinks, withTrackingParams, type Device, type Excluded } from "./rules";

// 短縮リンクの作成・転送・記録（docs/architecture.md の 4.22、決定 D20）。admin は RLS を通らないクライアント。
// 呼ぶ側で、ownerId がログイン中の利用者で、projectId がその人のものであることを確かめておく

type Admin = SupabaseClient<Database>;

export class LinkError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "LinkError";
  }
}

export type LinkKind = "post" | "profile" | "custom";

// 行き先に使えない場所。短縮リンクは利用者が決めた行き先へ転送するので、矢書のドメインを借りた悪用を減らすため、
// IP アドレスそのもの・内部のホスト・矢書自身（リンクの入れ子）は使えなくする（4.22 の「悪用への備え」）
const BLOCKED_HOSTS = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.test)$/i;
const OWN_HOSTS = /(^|\.)yabumi\.app$|(^|\.)vercel\.app$/i;

export function isValidDestination(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || url.length > 2000 || u.username || u.password || u.port) return false;
    // 末尾の点（yabumi.app. や localhost.）は同じホストを指すので、外してから判定する。URL の解釈で、10 進・16 進の IPv4 はふつうの形に直っている
    const host = u.hostname.replace(/\.+$/, "");
    // IPv4・IPv6 のアドレスそのもの
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return false;
    if (!host.includes(".") || BLOCKED_HOSTS.test(host) || OWN_HOSTS.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// 短縮リンクを作る。コードがほかのものと重なったら作り直す
export async function createShortLink(
  admin: Admin,
  input: { ownerId: string; projectId: string; destinationUrl: string; sns: SnsKey | null; kind: LinkKind; postTargetId?: string | null; label?: string },
): Promise<{ id: string; code: string }> {
  if (!isValidDestination(input.destinationUrl)) throw new LinkError("リンクの行き先は https:// で始まる URL にしてください（IP アドレスそのものや、矢書の URL は使えません）。");
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { data, error } = await admin
      .from("short_links")
      .insert({
        owner_id: input.ownerId,
        project_id: input.projectId,
        code,
        destination_url: input.destinationUrl,
        sns: input.sns,
        kind: input.kind,
        post_target_id: input.postTargetId ?? null,
        label: (input.label ?? "").slice(0, 100),
      })
      .select("id, code")
      .single();
    if (!error) return data;
    // 23505 = 重なり。コードが重なったときだけやり直す（同じ配信先・同じ行き先のものは呼ぶ側で探してから作る）
    if (error.code !== "23505" || !/code/.test(error.message)) throw error;
  }
  throw new Error("短縮リンクのコードを作れませんでした");
}

export type ResolvedLink = { id: string; target: string; disabled: boolean };

// コードから転送先を引く（行き先に、SNS・リンクの印と App Store の pt を付ける）
export async function resolveLink(admin: Admin, code: string): Promise<ResolvedLink | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const { data, error } = await admin
    .from("short_links")
    .select("id, code, destination_url, sns, disabled_at, projects(app_store_provider_token)")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const project = data.projects as unknown as { app_store_provider_token: string | null } | null;
  return {
    id: data.id,
    disabled: Boolean(data.disabled_at),
    target: withTrackingParams(data.destination_url, {
      sns: (data.sns as SnsKey | null) ?? null,
      code: data.code,
      appStoreProviderToken: project?.app_store_provider_token ?? null,
    }),
  };
}

// クリックを記録する。IP と User-Agent はハッシュを作るためだけに DB へ渡し、保存しない（DB の record_link_click）
export async function recordClick(
  admin: Admin,
  input: { linkId: string; ip: string | null; userAgent: string | null; device: Device; country: string | null; excluded: Excluded },
): Promise<string> {
  const { data, error } = await admin.rpc("record_link_click", {
    p_link_id: input.linkId,
    p_ip: input.ip ?? "",
    p_user_agent: (input.userAgent ?? "").slice(0, 500),
    p_device: input.device,
    p_country: input.country && /^[A-Za-z]{2}$/.test(input.country) ? input.country.toUpperCase() : "",
    p_excluded: input.excluded as string,
  });
  if (error) throw error;
  return data;
}

// 投稿の配信先の本文にある URL ごとに、短縮リンクを用意する（すでにあれば使い回す）。返り値は 行き先 → 短縮リンクの URL
export async function ensurePostLinks(
  admin: Admin,
  input: { ownerId: string; projectId: string; postTargetId: string; sns: SnsKey; text: string },
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!substitutesBodyLinks(input.sns)) return result;
  const urls = findLinkableUrls(input.text).filter(isValidDestination);
  if (!urls.length) return result;
  const { data: existing, error } = await admin
    .from("short_links")
    .select("code, destination_url")
    .eq("owner_id", input.ownerId)
    .eq("post_target_id", input.postTargetId)
    .in("destination_url", urls);
  if (error) throw error;
  for (const row of existing ?? []) result.set(row.destination_url, shortLinkUrl(row.code));
  for (const url of urls) {
    if (result.has(url)) continue;
    const link = await createShortLink(admin, { ownerId: input.ownerId, projectId: input.projectId, destinationUrl: url, sns: input.sns, kind: "post", postTargetId: input.postTargetId });
    result.set(url, shortLinkUrl(link.code));
  }
  return result;
}

// 送る直前に、配信先の本文の URL を、その配信先の短縮リンクに置き換える（保存のときに作ったものだけ。新しくは作らない）
export async function substituteForTarget(admin: Admin, postTargetId: string, sns: string, text: string): Promise<string> {
  if (!substitutesBodyLinks(sns as SnsKey)) return text;
  const urls = findLinkableUrls(text);
  if (!urls.length) return text;
  const { data, error } = await admin
    .from("short_links")
    .select("code, destination_url")
    .eq("post_target_id", postTargetId)
    .is("disabled_at", null)
    .in("destination_url", urls);
  if (error) throw error;
  return substituteLinks(text, new Map((data ?? []).map((r) => [r.destination_url, shortLinkUrl(r.code)])));
}

// 投稿を保存したときに、送る前の配信先（送信待ち）の本文の URL に短縮リンクを用意する。
// enabled が false なら、送る前の配信先の短縮リンクを消す（送った投稿の中のリンクは残す）。
// 置き換えるのは自動で送る SNS だけ（手で投稿する SNS は、利用者が貼る文にそのまま入る）。Instagram は本文の URL を押せないので置き換えない
export async function preparePostLinks(admin: Admin, input: { ownerId: string; projectId: string; postId: string; enabled: boolean }): Promise<void> {
  const [{ data: post, error: postError }, { data: targets, error }] = await Promise.all([
    admin.from("posts").select("body").eq("id", input.postId).eq("owner_id", input.ownerId).single(),
    admin.from("post_targets").select("id, sns, status, body_override").eq("post_id", input.postId).eq("owner_id", input.ownerId),
  ]);
  if (postError) throw postError;
  if (error) throw error;
  for (const t of targets ?? []) {
    if (t.status !== "pending" || isManualSns(t.sns as SnsKey)) continue;
    if (!input.enabled || !substitutesBodyLinks(t.sns as SnsKey)) {
      const { error: delError } = await admin.from("short_links").delete().eq("post_target_id", t.id).eq("owner_id", input.ownerId);
      if (delError) throw delError;
      continue;
    }
    await ensurePostLinks(admin, { ownerId: input.ownerId, projectId: input.projectId, postTargetId: t.id, sns: t.sns as SnsKey, text: t.body_override ?? post.body });
  }
}

export type PostLinkPreview = Partial<Record<SnsKey, { destination: string; url: string }[]>>;

// 作成画面に出す、配信先ごとの短縮リンク（送るときにこの URL に置き換わる）
export async function postLinkPreview(db: SupabaseClient<Database>, postId: string): Promise<PostLinkPreview> {
  const { data, error } = await db
    .from("short_links")
    .select("code, destination_url, disabled_at, post_targets!inner(post_id, sns)")
    .eq("post_targets.post_id", postId)
    .limit(100);
  if (error) throw error;
  const result: PostLinkPreview = {};
  for (const row of data ?? []) {
    if (row.disabled_at) continue;
    const sns = (row.post_targets as unknown as { sns: SnsKey }).sns;
    (result[sns] ??= []).push({ destination: row.destination_url, url: shortLinkUrl(row.code) });
  }
  return result;
}
