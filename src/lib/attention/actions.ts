"use server";

// 概要の「● 要確認」の帯を × で閉じる（4.71）。画面に出していた項目だけを渡し、確かめて閉じるのは DB の close_attention
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MAX_ATTENTION_ITEMS, type AttentionItem } from "./dismissals";

const itemSchema = z.union([
  z.object({ kind: z.literal("failed"), id: z.uuid() }),
  z.object({ kind: z.enum(["overdue", "manual"]), id: z.uuid(), stamp: z.string().min(1).max(40) }),
  z.object({ kind: z.literal("todo"), id: z.uuid(), stamp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);
const inputSchema = z.object({ projectId: z.uuid(), items: z.array(itemSchema).min(1).max(MAX_ATTENTION_ITEMS) });

export async function closeAttention(projectId: string, items: AttentionItem[]): Promise<{ error?: string }> {
  const parsed = inputSchema.safeParse({ projectId, items });
  if (!parsed.success) return { error: "閉じられませんでした。画面を読み込み直してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_attention", { p_project_id: parsed.data.projectId, p_items: parsed.data.items });
  if (error) return { error: "閉じられませんでした。画面を読み込み直してください。" };
  return {};
}
