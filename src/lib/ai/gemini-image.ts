import "server-only";
import { envReady } from "@/lib/env-check";
import { photoModel } from "./photo";

// Google の Gemini API で画像を 1 枚作る（docs/architecture.md の 4.25 の ②）。
// 2026-11-02 の公式の案内（ai.google.dev/gemini-api/docs/image-generation）の Interactions API を、SDK を足さずに fetch で呼ぶ。
// キー（GEMINI_API_KEY）は Google Cloud の別のプロジェクトで作り、支払いの上限を置く（docs/deploy.md の 24）。テストでは呼ばない（差し替える）

export function photoConfigured(): boolean {
  return envReady("AI の画像（Gemini API）", ["GEMINI_API_KEY"]);
}

export type GeneratedImage = { bytes: Uint8Array; mimeType: string; inputTokens: number };
export type GenerateImage = (args: { prompt: string; aspectRatio: string }) => Promise<GeneratedImage>;

// 安全の決まりで断られた（作られなかった）とき。画面にはそのことだけを出す
export class ImageBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageBlockedError";
  }
}

type Block = { type?: string; data?: string; mime_type?: string; mimeType?: string };

// 返事から画像を探す。steps[].content[] にあるものを基本に、output_image などの形にも備える（形は【未確認】な部分があるので、見つからなければ失敗にする）
export function extractImage(json: unknown): { data: string; mimeType: string } | null {
  const o = json as { steps?: { type?: string; content?: Block[] }[]; outputs?: Block[]; output_image?: Block };
  const candidates: Block[] = [
    ...(o?.steps ?? []).filter((s) => s?.type !== "thought").flatMap((s) => s?.content ?? []),
    ...(o?.outputs ?? []),
    ...(o?.output_image ? [o.output_image] : []),
  ];
  // 考える途中の画像（thought）を除き、最後の画像を使う
  const img = candidates.filter((b) => b?.type === "image" && typeof b.data === "string" && b.data).at(-1);
  return img ? { data: img.data!, mimeType: img.mime_type ?? img.mimeType ?? "image/jpeg" } : null;
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

// 開発のときだけ、送り先を手元の偽物に差し替えられる（画面の確かめで本物を呼ばないため）。本番では使わない（鍵を別の場所に送らない）
export function geminiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const local = env.GEMINI_API_BASE_URL_DEV?.trim();
  return env.NODE_ENV !== "production" && local && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local) ? local : GEMINI_BASE_URL;
}

export const generateWithGemini: GenerateImage = async ({ prompt, aspectRatio }) => {
  const res = await fetch(`${geminiBaseUrl()}/v1beta/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: photoModel(),
      input: [{ type: "text", text: prompt }],
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspectRatio, image_size: "1K" },
    }),
    signal: AbortSignal.timeout(110_000),
  });
  const json = (await res.json().catch(() => null)) as { status?: string; errors?: { code?: string; message?: string }[]; usage?: { total_input_tokens?: number } } | null;
  if (!res.ok) {
    // 400 で安全の決まりに当たったときも、ここに来る。中身（指示文）はログに出さない
    const msg = json?.errors?.[0]?.message ?? (json as { error?: { message?: string } } | null)?.error?.message ?? "";
    if (/safety|blocked|policy|prohibited/i.test(msg)) throw new ImageBlockedError(msg);
    throw new Error(`Gemini API ${res.status}`);
  }
  const image = extractImage(json);
  if (!image) {
    if (json?.status === "failed" || json?.errors?.length) throw new ImageBlockedError(json?.errors?.[0]?.message ?? "failed");
    throw new Error("画像が返ってきませんでした");
  }
  return { bytes: Uint8Array.from(Buffer.from(image.data, "base64")), mimeType: image.mimeType, inputTokens: json?.usage?.total_input_tokens ?? 0 };
};
