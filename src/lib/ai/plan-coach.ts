import type Anthropic from "@anthropic-ai/sdk";
import { saveSectionValue } from "@/lib/plan/save";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSectionKey, normalizePlan, type PlanData, type SectionKey, type SectionValue } from "@/lib/plan/schema";
import { isProductType, type ProductType } from "@/lib/projects/product-types";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { budgeted, withAiBudget } from "./budget";
import { normalizeCoachTurn, toWireTurn, type CoachSectionKey, type CoachTurn, type ProductValue } from "./plan-coach-schema";
import { coachContextMessage, PLAN_COACH_SYSTEM, sectionLabel, type CoachContext } from "./plan-coach-prompt";
import type { TokenUsage } from "./pricing";
import { productTypeOf } from "./product-guide";
import { aiFailureMessage } from "./provider-failure";

// アカウント設計を AI と進める会話の 1 往復（docs/architecture.md の 4.9）。
// AI の呼び出しは callModel として外から渡す（テストではモックし、本物の API は呼ばない）。

type Db = SupabaseClient<Database>;
export type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type BetaTextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;

export const PLAN_COACH_MODEL = "claude-opus-5-5";
// 1 つの会話でやりとりできる回数の上限（履歴が長くなりすぎて費用が膨らむのを防ぐ）
export const MAX_TURNS_PER_THREAD = 80;
export const MAX_USER_TEXT = 2000;

// 利用者側の発言。画面に出すもの（text、adopt、focus）と出さないもの（start）がある
export type UserContent =
  | { kind: "start"; focus: SectionKey | null }
  | { kind: "text"; text: string }
  | { kind: "focus"; focus: SectionKey }
  | { kind: "adopt"; messageId: string; optionIndex: number; section: CoachSectionKey; title: string; tags?: string[] };

// AI の返事。採用された案の番号を、あとから書き足す。ハッシュタグの案は、選んだ候補の番号も（adoptedPicks）
export type AssistantContent = CoachTurn & { adopted?: number | null; adoptedPicks?: number[] | null };

export type StoredMessage =
  | { id: string; role: "user"; content: UserContent; created_at: string }
  | { id: string; role: "assistant"; content: AssistantContent; created_at: string };

export type ModelRequest = { system: BetaTextBlockParam[]; messages: BetaMessageParam[] };
export type ModelResult = {
  turn: unknown | null;
  stopReason: string | null;
  model: string;
  usage: TokenUsage;
};
export type CallModel = (req: ModelRequest) => Promise<ModelResult>;

// 利用者の発言を、AI に渡す文にする
export function userContentToText(c: UserContent): string {
  switch (c.kind) {
    case "start":
      return c.focus ? `アカウント設計を手伝ってください。「${sectionLabel(c.focus)}」から一緒に考えたいです。` : "アカウント設計を手伝ってください。";
    case "text":
      return c.text;
    case "focus":
      return `「${sectionLabel(c.focus)}」を一緒に考えたいです。`;
    case "adopt":
      return c.tags
        ? `「${sectionLabel(c.section)}」の案「${c.title}」から、${c.tags.map((t) => `#${t}`).join(" ")} を選んで保存しました（ほかの候補は使いません）。次に進んでください。`
        : `「${sectionLabel(c.section)}」の案「${c.title}」を採用して保存しました。次に進んでください。`;
  }
}

// 履歴と「いまの状況」から、API に渡すリクエストを組み立てる。
// キャッシュ: システムプロンプトと、最後の利用者の発言に印を付ける。前回の印の位置が今回の履歴の途中に残るので、履歴の大部分がキャッシュから読まれる
export function buildCoachRequest(history: StoredMessage[], ctx: CoachContext): ModelRequest {
  const messages: BetaMessageParam[] = history.map((m) =>
    m.role === "user"
      ? { role: "user", content: [{ type: "text", text: userContentToText(m.content) }] }
      : { role: "assistant", content: [{ type: "text", text: JSON.stringify(toWireTurn(m.content)) }] },
  );
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && Array.isArray(last.content)) {
    const block = last.content[last.content.length - 1] as BetaTextBlockParam;
    block.cache_control = { type: "ephemeral" };
  }
  // 「いまの状況」は毎回変わるので、キャッシュの印より後ろに、会話途中のシステムメッセージとして置く
  messages.push({ role: "system", content: coachContextMessage(ctx) } as unknown as BetaMessageParam);
  return {
    system: [{ type: "text", text: PLAN_COACH_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages,
  };
}

export type CoachInput =
  | { kind: "start"; focus: SectionKey | null }
  | { kind: "text"; text: string }
  | { kind: "focus"; focus: SectionKey }
  | { kind: "adopt"; messageId: string; optionIndex: number; picks?: number[] };

export type CoachDeps = { callModel: CallModel; now?: () => Date };
export type CoachResult = { ok: true; threadId: string } | { ok: false; threadId: string | null; message: string };

const GENERIC_ERROR = "AI とのやりとりがうまくいきませんでした。時間をおいてもう一度お試しください。";

// 会話を 1 往復進める。
// user: 利用者の権限のクライアント（設計の保存とプロジェクトの読み込み。RLS で本人のものだけ）
// admin: サーバーの権限のクライアント（会話と利用量の書き込み）。呼ぶ前に userId がログイン中の利用者であることを確かめておく
// 「何を宣伝するか」の案を採用したとき: プロジェクトの種類を保存する（利用者の権限。RLS で本人のプロジェクトだけ。updateProductType と同じ書き込み）
async function saveProductType(user: SupabaseClient<Database>, projectId: string, productType: ProductType): Promise<{ ok: boolean }> {
  if (!isProductType(productType)) return { ok: false };
  const { data, error } = await user.from("projects").update({ product_type: productType }).eq("id", projectId).select("id");
  return { ok: !error && Boolean(data?.length) };
}

export async function coachStep(
  user: Db,
  admin: Db,
  deps: CoachDeps,
  args: { userId: string; projectId: string; threadId: string | null; input: CoachInput },
): Promise<CoachResult> {
  const now = deps.now?.() ?? new Date();
  const { userId, projectId, input } = args;

  // 種類（product_type）も使うので、すべての列を読む
  const { data: project } = await user.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, threadId: args.threadId, message: "プロジェクトが見つかりません。" };

  if (input.kind === "text") {
    const text = input.text.trim();
    if (!text) return { ok: false, threadId: args.threadId, message: "メッセージを入れてください。" };
    if (text.length > MAX_USER_TEXT) return { ok: false, threadId: args.threadId, message: `${MAX_USER_TEXT.toLocaleString("ja-JP")} 文字以内にしてください。` };
  }

  // 会話: 指定があれば本人のものか確かめ、なければ作る
  let threadId = args.threadId;
  let createdThread = false;
  if (threadId) {
    const { data: t } = await admin.from("ai_threads").select("id").eq("id", threadId).eq("owner_id", userId).eq("project_id", projectId).maybeSingle();
    if (!t) return { ok: false, threadId: null, message: "会話が見つかりません。画面を読み込み直してください。" };
  } else {
    const { data: t, error } = await admin
      .from("ai_threads")
      .insert({ owner_id: userId, project_id: projectId, purpose: "account_plan" })
      .select("id")
      .single();
    if (error) throw error;
    threadId = t.id;
    createdThread = true;
  }

  const history = await loadHistory(admin, threadId);
  if (history.length >= MAX_TURNS_PER_THREAD * 2) {
    return { ok: false, threadId, message: "この会話は長くなったので、ここまでにしましょう。「最初から相談する」で新しい会話を始められます（決まった設計は残ります）。" };
  }

  // 宣伝するものの種類（「何を宣伝するか」の案を採用したら、AI にはすぐ新しい種類を渡す）
  let productType = productTypeOf(project.product_type);
  // 利用者の発言を決める。採用のときは、ここで設計に保存する
  let userContent: UserContent;
  switch (input.kind) {
    case "start":
      userContent = { kind: "start", focus: input.focus };
      break;
    case "focus":
      userContent = { kind: "focus", focus: input.focus };
      break;
    case "text":
      userContent = { kind: "text", text: input.text.trim() };
      break;
    case "adopt": {
      const target = history.find((m) => m.id === input.messageId);
      const proposal = target?.role === "assistant" ? target.content.proposal : null;
      const option = proposal?.options[input.optionIndex];
      if (!target || target.role !== "assistant" || !proposal || !option) {
        return { ok: false, threadId, message: "案が見つかりません。画面を読み込み直してください。" };
      }
      // ハッシュタグの案は、候補のうち利用者が選んだものだけを保存する
      const picked = proposal.section === "hashtags" && input.picks ? pickHashtags(option.value as PlanData["hashtags"], input.picks) : null;
      if (picked && picked.value.items.length === 0) return { ok: false, threadId, message: "使うハッシュタグを 1 つ以上選んでください。" };
      // あなたらしさの「投稿に使ってよい」の印は、保存の共通の入口（saveSectionValue）が決める（保存してある印のオフを残す。APP-L1）
      const value = picked?.value ?? (option.value as SectionValue<SectionKey>);
      // 「何を宣伝するか」はプロジェクトの種類（projects.product_type）に、ほかはアカウント設計に保存する
      const saved =
        proposal.section === "product"
          ? await saveProductType(user, projectId, (option.value as ProductValue).productType)
          : await saveSectionValue(user, projectId, proposal.section, value, "ai", { now });
      if (!saved.ok) return { ok: false, threadId, message: "案を保存できませんでした。時間をおいてもう一度お試しください。" };
      if (proposal.section === "product") productType = (option.value as ProductValue).productType;
      await admin
        .from("ai_messages")
        .update({ content: { ...target.content, adopted: input.optionIndex, adoptedPicks: picked?.picks ?? null } as never })
        .eq("id", target.id);
      userContent = {
        kind: "adopt",
        messageId: target.id,
        optionIndex: input.optionIndex,
        section: proposal.section,
        title: option.title,
        ...(picked ? { tags: picked.value.items.map((i) => i.tag) } : {}),
      };
      break;
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from("ai_messages")
    .insert({ thread_id: threadId, owner_id: userId, role: "user", content: userContent as never })
    .select("id, created_at")
    .single();
  if (insertError) throw insertError;
  history.push({ id: inserted.id, role: "user", content: userContent, created_at: inserted.created_at });

  // いまの設計を読み直す（採用で変わった直後のものを AI に渡す）
  const { data: planRow } = await user.from("account_plans").select("data, section_sources").eq("project_id", projectId).maybeSingle();
  const focus = input.kind === "start" || input.kind === "focus" ? input.focus : null;
  const ctx: CoachContext = {
    project: { name: project.name, description: project.description, appStoreUrl: project.app_store_url, playStoreUrl: project.play_store_url, productType },
    plan: normalizePlan(planRow?.data, project.target_audience),
    sources: sourcesOf(planRow?.section_sources),
    focus,
    accounts: await connectedAccounts(user, projectId),
  };

  // 失敗したときは、いま保存した利用者の発言（と、いま作った会話）を消す。送り直しで同じ発言が重ならないように。
  // 案の採用は保存が済んでいるので、採用の記録は残す
  const fail = async (message: string): Promise<CoachResult> => {
    if (createdThread) {
      await admin.from("ai_threads").delete().eq("id", threadId);
      return { ok: false, threadId: null, message };
    }
    if (userContent.kind !== "adopt") await admin.from("ai_messages").delete().eq("id", inserted.id);
    return { ok: false, threadId, message };
  };

  // 呼ぶ前に上限の分を予約し、返事のあとで実際の額に直す（返事が使えなくても数える。budget.ts）
  const budget = { userId, purpose: "account_plan", call: "plan_coach" as const, threadId, now };
  const request = buildCoachRequest(history, ctx);
  let result: ModelResult;
  try {
    const b = await withAiBudget(admin, budget, request, deps.callModel);
    if (!b.ok) return fail(b.message);
    result = b.result;
  } catch (e) {
    console.error("[plan-coach] AI の呼び出しに失敗しました", e instanceof Error ? e.message : e);
    return fail(aiFailureMessage(e, GENERIC_ERROR));
  }

  if (result.stopReason === "refusal") {
    return fail("AI がこの内容には答えられませんでした。言い方を変えてもう一度お試しください。");
  }
  let turn = result.stopReason === "max_tokens" ? null : normalizeCoachTurn(result.turn);
  if (!turn || !turn.message) return fail(GENERIC_ERROR);

  // 案の中身が形に合わなかったときは、理由を伝えて 1 回だけ言い直させる
  if (turn.proposalProblem) {
    try {
      const retry = await budgeted(admin, budget, deps.callModel)({
        system: request.system,
        messages: [
          ...request.messages,
          { role: "assistant", content: [{ type: "text", text: JSON.stringify(result.turn) }] },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `（yabumi からの自動の連絡）案の value_json が決められた形に合いませんでした: ${turn.proposalProblem}。「案の中身の形」に合わせて直し、同じ返事の形でもう一度返してください。`,
              },
            ],
          },
        ],
      });
      const fixed = retry.stopReason === "end_turn" ? normalizeCoachTurn(retry.turn) : null;
      if (fixed?.message && fixed.proposal) turn = fixed;
    } catch (e) {
      console.error("[plan-coach] 言い直しの呼び出しに失敗しました", e instanceof Error ? e.message : e);
    }
    if (!turn.proposal) {
      turn = { ...turn, message: `${turn.message}\n\n（案をうまく表示できませんでした。「もう一度案を出して」と送ってください）` };
    }
  }

  const { proposalProblem: _ignored, ...toSave } = turn;
  void _ignored;
  const { error } = await admin
    .from("ai_messages")
    .insert({ thread_id: threadId, owner_id: userId, role: "assistant", content: { ...toSave, adopted: null } as never });
  if (error) throw error;
  await admin.from("ai_threads").update({ updated_at: now.toISOString() }).eq("id", threadId);
  return { ok: true, threadId };
}

// ハッシュタグの案から、選んだ番号の候補だけを残す（範囲外と重なりは捨てる）
export function pickHashtags(value: PlanData["hashtags"], picks: number[]): { value: PlanData["hashtags"]; picks: number[] } {
  const valid = [...new Set(picks)].filter((i) => Number.isInteger(i) && i >= 0 && i < value.items.length).sort((a, b) => a - b);
  return { value: { items: valid.map((i) => value.items[i]) }, picks: valid };
}

function sourcesOf(raw: unknown): Partial<Record<SectionKey, "ai" | "manual">> {
  const out: Partial<Record<SectionKey, "ai" | "manual">> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) if (isSectionKey(k) && (v === "ai" || v === "manual")) out[k] = v;
  }
  return out;
}

export async function loadHistory(db: Db, threadId: string): Promise<StoredMessage[]> {
  const { data, error } = await db.from("ai_messages").select("id, role, content, created_at").eq("thread_id", threadId).order("created_at").order("id");
  if (error) throw error;
  return data as unknown as StoredMessage[];
}

// プロジェクトにつないだアカウントの SNS と実際のユーザー名（RLS で本人のものだけ）。名前とプロフィールの案に使う
async function connectedAccounts(user: SupabaseClient<Database>, projectId: string): Promise<{ sns: SnsKey; handle: string }[]> {
  const { data } = await user.from("project_social_accounts").select("social_accounts(sns, handle)").eq("project_id", projectId);
  return ((data ?? []) as unknown as { social_accounts: { sns: string; handle: string } | null }[]).flatMap((r) =>
    r.social_accounts && isSnsKey(r.social_accounts.sns) && r.social_accounts.handle ? [{ sns: r.social_accounts.sns, handle: r.social_accounts.handle }] : [],
  );
}
