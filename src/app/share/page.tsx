import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { PageHeader } from "@/components/ui/page-header";
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
      <TopBar email={email} crumb={<b className="text-fg">ネタ帳に残す</b>} mobileBack={{ href: "/projects", title: "ネタ帳に残す" }} quickNote={false} />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader title="ネタ帳に残す" />
        <Columns
          main={
            <section className="rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
              <ShareReceiver projects={projects} fromServer={fromServer} />
            </section>
          }
          side={
            projects.length > 0 && (
              <Card>
                <CardHeader title="ネタ帳を開く" />
                <ul className="px-6 pb-3 max-sm:px-4">
                  {projects.map((p) => (
                    <li key={p.id} className="border-t border-line first:border-t-0">
                      <Link href={`/projects/${p.id}/notes`} className="flex items-center gap-2 py-2.5 text-[15px] hover:no-underline">
                        <span className="min-w-0 truncate hover:underline">{p.name}</span>
                        <span aria-hidden className="ml-auto text-faint">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          }
        />
      </main>
    </div>
  );
}
