import type { Metadata } from "next";
import { cookies } from "next/headers";
import { TopBar } from "@/components/nav/top-bar";
import { ShareReceiver, ShareStash } from "@/components/notes/share-receiver";
import { SHARE_COOKIE, decodeShareCookie } from "@/lib/notes/share";
import { listProjectNames } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ネタ帳に残す" };

// ほかのアプリから「共有」されたもの・ショートカットから送られたものを、ネタ帳のメモにする（docs/architecture.md の 4.26）。
// ログインしていなくても開ける（受け取ったものをブラウザに控えてから、ログインへ送る。ログインのあとで続ける）
export default async function SharePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return <ShareStash />;

  const projects = await listProjectNames();
  const fromServer = decodeShareCookie((await cookies()).get(SHARE_COOKIE)?.value);
  const email = typeof claims.email === "string" ? claims.email : "";

  return (
    <div className="flex flex-1 flex-col bg-bg">
      <TopBar email={email} crumb={<b>ネタ帳に残す</b>} mobileBack={{ href: "/projects", title: "ネタ帳に残す" }} quickNote={false} />
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-6 py-10 max-sm:px-4 max-sm:py-5">
        <h1 className="font-heading text-2xl font-bold max-sm:text-xl">ネタ帳に残す</h1>
        <ShareReceiver projects={projects} fromServer={fromServer} />
      </main>
    </div>
  );
}
