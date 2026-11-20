import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFormatRoundRequest, normalizeRoundProposals } from "@/lib/ai/format-round-ai";
import { budgeted } from "@/lib/ai/budget";
import { callFormatRound } from "@/lib/ai/anthropic";
import type { PlanData } from "@/lib/plan/schema";
import { listRounds, usedAnswerKeys } from "@/lib/post-formats/rounds";
import { X_FIXED_BODY, answerKey, fixedBodySeries, isSeries, ROUNDS_FOR_AI } from "@/lib/post-formats/series";
import { fillFormat, formatSlots, formatTagsFor } from "@/lib/post-formats/schema";
import { getFormat } from "@/lib/post-formats/store";
import type { SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import type { AutoPlan, AutoRunReason } from "./types";
import { defaultTagsFor, readDefaultHashtags } from "@/lib/projects/default-hashtags";

// 自動の回の材料を選ぶ（docs/design/auto-post.md の 2.1）。サーバーの権限で読むので、必ずプロジェクトと持ち主で絞る

type Db = SupabaseClient<Database>;

export type Material = {
  // AI に渡す材料（<material> の中身）
  text: string;
  // 画面に出す短い名前（通知には出さない）
  label: string;
  // 使った材料（auto_runs.material_ref）
  ref: Record<string, string | number | null>;
  // 本文に入れてよい URL（行き先）
  allowedUrls: string[];
  // 投稿に写すメモの画像（ネタ帳）
  noteIds?: string[];
  // シリーズは AI で文を作らず、型に入れた文をそのまま使う（SNS ごとに同じ文。タグはフォーマットの毎回付けるタグ）
  fixedTexts?: Partial<Record<SnsKey, string>>;
  fixedTags?: Partial<Record<SnsKey, string[]>>;
  // fixedBody: 本文が毎回同じシリーズ（前の投稿と似ているかを本文で見ない。重なりは答えと空欄の言葉で、案を選ぶときに見ている）
  series?: { formatId: string; answer: string; values: Record<string, string>; fixedBody?: boolean };
};

export type NoMaterial = { none: true; reason: AutoRunReason; detail: string };

// 前の回で使った材料（新しい順。作り終えた回と、作っている途中・予約中の回）
export type PastRef = Record<string, unknown>;

const DAY = 86_400_000;
const jstDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n).join("")}…` : s);

// ネタ帳のメモ: 使っていないメモの古い順（写真つきを先にする選び方も）。ほかの回が使う予定のメモは除く
async function pickNote(admin: Db, plan: AutoPlan & { ownerId: string }, past: PastRef[]): Promise<Material | NoMaterial> {
  const taken = new Set(past.map((r) => r.note_id).filter((v): v is string => typeof v === "string"));
  const { data: notes, error } = await admin
    .from("idea_notes")
    .select("id, body, created_at")
    .eq("project_id", plan.projectId)
    .eq("owner_id", plan.ownerId)
    .is("used_at", null)
    .order("created_at")
    .limit(100);
  if (error) throw error;
  const free = notes.filter((n) => !taken.has(n.id) && n.body.trim());
  if (!free.length) return { none: true, reason: "no_material", detail: "使っていないメモがありません" };
  const { data: photos } = await admin.from("media_files").select("note_id").in("note_id", free.map((n) => n.id)).eq("kind", "image");
  const withPhoto = new Set((photos ?? []).map((p) => p.note_id));
  const note = plan.materials.note_order === "photo_first" ? (free.find((n) => withPhoto.has(n.id)) ?? free[0]) : free[0];
  const photo = withPhoto.has(note.id);
  return {
    text: `種類: ネタ帳のメモ（利用者が生活の中で書き留めたこと。書かれていないできごと・感想・数字は足さない）\n写真: ${photo ? "あり（投稿に添える。写っているものは見えていないので書かない）" : "なし"}\nメモ:\n${note.body.trim()}`,
    label: `メモ: ${clip(note.body.trim().replace(/\s+/g, " "), 20)}`,
    ref: { note_id: note.id },
    allowedUrls: [],
    noteIds: [note.id],
  };
}

// 商品・サービスの紹介: 行き先を順に回す（前の回の次）。切り口（悩み）は前の回と変えさせる
async function pickDestination(admin: Db, plan: AutoPlan & { ownerId: string }, past: PastRef[]): Promise<Material | NoMaterial> {
  let q = admin.from("project_destinations").select("id, kind, label, url").eq("project_id", plan.projectId).eq("owner_id", plan.ownerId).order("position");
  if (plan.materials.destination_ids?.length) q = q.in("id", plan.materials.destination_ids);
  const { data, error } = await q;
  if (error) throw error;
  if (!data.length) return { none: true, reason: "no_material", detail: "行き先の URL がありません" };
  const lastId = past.find((r) => typeof r.destination_id === "string")?.destination_id;
  const i = data.findIndex((d) => d.id === lastId);
  const d = data[(i + 1) % data.length];
  const lastConcern = past.find((r) => typeof r.concern === "string")?.concern;
  return {
    text: [
      "種類: 商品・サービスの紹介（プロジェクトの説明・届けたい相手・アカウント設計に書かれたことだけで、この行き先を紹介する）",
      `行き先: ${d.label}`,
      `使ってよい URL: ${d.url}`,
      lastConcern && lastConcern !== "none" ? `前の回の切り口（悩み・望み）: ${lastConcern}（今回は別の切り口にする）` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    label: `行き先: ${clip(d.label, 20)}`,
    ref: { destination_id: d.id },
    allowedUrls: [d.url],
  };
}

// 柱ごとの定番: 送る SNS に付いた柱を順に回す
function pickPillar(plan: AutoPlan, planData: PlanData, past: PastRef[]): Material | NoMaterial {
  const sns = Object.keys(plan.targets) as SnsKey[];
  const pillars = planData.pillars.items.filter((p) => p.name.trim() && (p.sns.length === 0 || p.sns.some((s) => sns.includes(s))));
  if (!pillars.length) return { none: true, reason: "no_material", detail: "アカウント設計の投稿の柱が決まっていません" };
  const last = past.find((r) => typeof r.pillar === "string")?.pillar;
  const i = pillars.findIndex((p) => p.name === last);
  const p = pillars[(i + 1) % pillars.length];
  return {
    text: `種類: 柱ごとの定番（いつ出しても古くならない話。なぜこれを始めたか・届けたい相手の困りごと・使い方や選び方のコツ・よく聞かれることなど。紹介文と設計に書かれていない商品・機能・実績は書かない）\n柱: ${p.name}${p.example.trim() ? `\n柱の例（話題を示すだけ。文はまねない）: ${p.example.trim()}` : ""}`,
    label: `柱: ${clip(p.name, 20)}`,
    ref: { pillar: p.name },
    allowedUrls: [],
  };
}

// お知らせ・季節: 送る日（日本時間）と次の日の予定。1 つの予定は 2 回まで。なければ季節のあいさつ（飛ばす設定なら飛ばす）
async function pickEvent(admin: Db, plan: AutoPlan & { ownerId: string }, past: PastRef[], dueAt: Date): Promise<Material | NoMaterial> {
  const day = jstDate(dueAt);
  const next = jstDate(new Date(dueAt.getTime() + DAY));
  const { data, error } = await admin
    .from("project_events")
    .select("id, on_date, body")
    .eq("project_id", plan.projectId)
    .eq("owner_id", plan.ownerId)
    .gte("on_date", day)
    .lte("on_date", next)
    .order("on_date");
  if (error) throw error;
  const used = (id: string) => past.filter((r) => r.event_id === id).length;
  const e = data.find((x) => used(x.id) < 2);
  if (e) {
    const when = e.on_date === day ? "今日" : "明日";
    return {
      text: `種類: お知らせ（利用者が書いた予定。書かれていない値段・時間・内容は足さない）\n日付: ${e.on_date}（送る日から見て${when}）\n予定: ${e.body.trim()}`,
      label: `予定: ${clip(e.body.trim(), 20)}`,
      ref: { event_id: e.id },
      allowedUrls: [],
    };
  }
  if (plan.materials.skip_if_empty) return { none: true, reason: "no_material", detail: "この日の予定がありません" };
  const month = Number(day.slice(5, 7));
  return {
    text: `種類: 季節のあいさつ（${month} 月。季節そのもの〈気温・旬・行事の一般的なこと〉を、商品・サービスに無理なくつなげる。特定の日付の催し・割引・新商品は作らない）`,
    label: `季節: ${month} 月`,
    ref: { season: month },
    allowedUrls: [],
  };
}

// シリーズ: 次の回の中身を AI に出させ（用途は自動の投稿の枠）、型に入れる。利用者が埋める穴がある型は、自動では書けない
async function pickSeries(admin: Db, plan: AutoPlan & { ownerId: string }, planData: PlanData, project: ProjectRow, deps: MaterialDeps): Promise<Material | NoMaterial> {
  const formatId = plan.materials.format_id;
  const format = formatId ? await getFormat(admin, plan.projectId, formatId) : null;
  if (!format || !isSeries(format.series)) return { none: true, reason: "no_material", detail: "シリーズのフォーマットが見つかりません" };
  const handSlots = formatSlots(format.body).filter((s) => !(s in format.series.slots));
  if (handSlots.length) return { none: true, reason: "cannot_write", detail: "自分で埋める空欄があるフォーマットは、自動では書けません" };
  // 本文が毎回同じフォーマットは X に送れない（ウィザードと保存で選べないようにしている。あとからフォーマットを変えたとき）
  const fixedBody = fixedBodySeries(format.body, format.series);
  if (fixedBody && plan.targets.x) return { none: true, reason: "cannot_write", detail: X_FIXED_BODY };
  const rounds = await listRounds(admin, format.id);
  const used = usedAnswerKeys(rounds);
  if (!format.series.answer) for (const r of rounds) used.add(answerKey(Object.keys(format.series.slots).map((n) => r.values[n] ?? "").join("|")));
  const call = budgeted(admin, { userId: plan.ownerId, purpose: "auto_post", call: "post_format_round" }, deps.callFormatRound ?? callFormatRound);
  const r = await call(
    buildFormatRoundRequest({
      project: { name: project.name, description: project.description, targetAudience: project.target_audience, productType: project.product_type },
      plan: planData,
      format,
      past: rounds.slice(0, ROUNDS_FOR_AI),
      wish: "",
    }),
  );
  const proposals = r.stopReason === "end_turn" ? normalizeRoundProposals(r.output, format, used) : null;
  const p = proposals?.[0];
  // シリーズの穴は、広く知られた作品・ものごとの一般的な事実だけ（format-series.md の 4.）。「確かめてほしいところ」の数は記録だけ残し、送る前は AI っぽさチェックに任せる
  if (!p) return { none: true, reason: "cannot_write", detail: "重ならない次の回を出せませんでした" };
  const text = fillFormat(format.body, p.values);
  const sns = Object.keys(plan.targets) as SnsKey[];
  return {
    text: `シリーズ「${format.name}」の次の回`,
    label: `シリーズ: ${clip(p.answer || Object.values(p.values).join("・"), 20)}`,
    ref: { format_id: format.id, answer: p.answer.slice(0, 100), checks: p.checks.length },
    allowedUrls: [],
    fixedTexts: Object.fromEntries(sns.map((s) => [s, text])),
    fixedTags: Object.fromEntries(sns.map((s) => [s, formatTagsFor(format.hashtags, s)])),
    series: { formatId: format.id, answer: p.answer, values: p.values, fixedBody },
  };
}

// default_hashtags: プロジェクトの「いつものタグ」（20261117100000。どの使い道の回にも付ける）
export type ProjectRow = { name: string; description: string | null; target_audience: string | null; product_type: string | null; default_hashtags?: unknown };
export type MaterialDeps = { callFormatRound?: typeof callFormatRound };

export async function pickMaterial(
  admin: Db,
  args: { plan: AutoPlan & { ownerId: string }; planData: PlanData; project: ProjectRow; past: PastRef[]; dueAt: Date },
  deps: MaterialDeps = {},
): Promise<Material | NoMaterial> {
  const m = await pickByKind(admin, args, deps);
  if (isNoMaterial(m)) return m;
  // 本文とは別に付けるタグ: SNS ごとに、シリーズのフォーマットのタグ → なければプロジェクトのいつものタグ（2026-11-17。タグのない SNS は持たない）
  const defaults = readDefaultHashtags(args.project.default_hashtags ?? null);
  const fixedTags: Partial<Record<SnsKey, string[]>> = {};
  for (const s of Object.keys(args.plan.targets) as SnsKey[]) {
    const tags = m.fixedTags?.[s]?.length ? m.fixedTags[s]! : defaultTagsFor(defaults, s);
    if (tags.length) fixedTags[s] = tags;
  }
  return { ...m, fixedTags };
}

function pickByKind(
  admin: Db,
  args: { plan: AutoPlan & { ownerId: string }; planData: PlanData; project: ProjectRow; past: PastRef[]; dueAt: Date },
  deps: MaterialDeps,
): Promise<Material | NoMaterial> | Material | NoMaterial {
  switch (args.plan.kind) {
    case "notes":
      return pickNote(admin, args.plan, args.past);
    case "product":
      return pickDestination(admin, args.plan, args.past);
    case "pillars":
      return pickPillar(args.plan, args.planData, args.past);
    case "events":
      return pickEvent(admin, args.plan, args.past, args.dueAt);
    case "series":
      return pickSeries(admin, args.plan, args.planData, args.project, deps);
    default:
      // 伸びた投稿の言い直し・開発の進みは段階 B
      return { none: true, reason: "no_material", detail: "この使い道は、まだ自動では回せません" };
  }
}

export const isNoMaterial = (m: Material | NoMaterial): m is NoMaterial => "none" in m;
