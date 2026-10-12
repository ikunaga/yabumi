"use server";

import { redirect } from "next/navigation";
import { createAppJwt } from "@/lib/github/app-auth";
import { deleteInstallation } from "@/lib/github/api";
import { githubConfig, githubConfigured } from "@/lib/github/config";
import { defaultLinkDomainDeps } from "@/lib/links/domains";
import { revokeDeps } from "@/lib/sns/adapters";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withdrawUser } from "./withdraw";

export type WithdrawState = { error?: string };

// 退会（docs/architecture.md の 4.14）。他人に勝手に退会されないよう、パスワードを入れ直してもらう
export async function withdraw(_prev: WithdrawState, formData: FormData): Promise<WithdrawState> {
  if (formData.get("understood") !== "on") return { error: "消えるものを確かめて、チェックを入れてください。" };
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "パスワードを入れてください。" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!userId || !email) redirect("/login");

  const token = formData.get("cf-turnstile-response");
  const { error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: typeof token === "string" && token ? token : undefined },
  });
  if (authError) {
    return {
      error:
        authError.code === "invalid_credentials"
          ? "パスワードが違います。"
          : authError.code === "captcha_failed"
            ? "ロボットでないことの確認が済んでいません。チェックが終わってから、もう一度押してください。"
            : "本人の確認ができませんでした。時間をおいてもう一度お試しください。",
    };
  }

  try {
    const report = await withdrawUser(createAdminClient(), userId, {
      ...revokeDeps(),
      uninstallGithub: githubConfigured()
        ? async (id) => {
            const cfg = githubConfig();
            await deleteInstallation(createAppJwt(cfg.appId, cfg.privateKey), id);
          }
        : undefined,
      linkDomains: defaultLinkDomainDeps(),
    });
    console.info("[withdraw] 退会しました", JSON.stringify({ sns: report.sns, github: report.github.map((g) => g.result) }));
  } catch (e) {
    console.error("[withdraw] 退会に失敗しました", e instanceof Error ? e.message : e);
    return { error: "退会の手続きに失敗しました。時間をおいてもう一度お試しください。" };
  }

  // 利用者はもう消えているので、手元のログインの cookie だけを消す
  await supabase.auth.signOut({ scope: "local" });
  redirect("/?done=withdrawn");
}
