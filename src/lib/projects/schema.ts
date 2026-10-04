import { z } from "zod";

const optionalStoreUrl = (hosts: string[], wrongHostMessage: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      let url: URL | null = null;
      try {
        url = new URL(v);
      } catch {
        // URL として読めない
      }
      if (!url || url.protocol !== "https:") {
        ctx.addIssue({ code: "custom", message: "https:// から始まる URL を入れてください" });
      } else if (!hosts.includes(url.hostname)) {
        ctx.addIssue({ code: "custom", message: wrongHostMessage });
      }
    });

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "アプリ名を入れてください").max(100, "アプリ名は 100 文字以内にしてください"),
  description: z.string().trim().max(2000, "説明は 2,000 文字以内にしてください"),
  target_audience: z.string().trim().max(1000, "届けたい相手は 1,000 文字以内にしてください"),
  app_store_url: optionalStoreUrl(["apps.apple.com"], "apps.apple.com の URL を入れてください"),
  play_store_url: optionalStoreUrl(["play.google.com"], "play.google.com の URL を入れてください"),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectFieldErrors = Partial<Record<keyof ProjectInput, string>>;

export function parseProjectForm(formData: FormData) {
  return projectInputSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    target_audience: String(formData.get("target_audience") ?? ""),
    app_store_url: String(formData.get("app_store_url") ?? ""),
    play_store_url: String(formData.get("play_store_url") ?? ""),
  });
}

export function toFieldErrors(error: z.ZodError<unknown>): ProjectFieldErrors {
  const errors: ProjectFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof ProjectInput | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
