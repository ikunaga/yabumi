import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { ProjectForm } from "@/components/projects/project-form";
import { SnsAccountsCard } from "@/components/projects/sns-accounts-card";
import { SnsResultBanner } from "@/components/projects/sns-result-banner";
import { Disclosure } from "@/components/ui/help";
import { PageHeader } from "@/components/ui/page-header";
import { SuccessBanner } from "@/components/ui/feedback";
import { updateProject } from "@/lib/projects/actions";
import { getProject } from "@/lib/projects/queries";
import { facebookConfigured } from "@/lib/sns/facebook/config";
import { instagramConfigured } from "@/lib/sns/instagram/config";
import { readReplacedCookie, SNS_REPLACED_COOKIE } from "@/lib/sns/link";
import { listProjectSnsAccounts } from "@/lib/sns/queries";
import { threadsConfigured } from "@/lib/sns/threads/config";
import { xConfigured } from "@/lib/sns/x/config";
import { xSpendThisMonth } from "@/lib/sns/x/spend";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "プロジェクトの設定" };

// プロジェクトの設定（つないだ SNS・このアプリについて・いちばん下に畳んだ削除）。SNS をつないだあとはここに戻る（src/lib/projects/paths.ts）
export default async function ProjectSettingsPage(props: PageProps<"/projects/[id]/edit">) {
  const { id } = await props.params;
  const { connected, sns_error, sns, done } = await props.searchParams;
  const project = await getProject(id);
  if (!project) notFound();
  const supabase = await createClient();
  const xReady = xConfigured();
  const [snsAccounts, { data: manualChannels }, xSpend] = await Promise.all([
    listProjectSnsAccounts(project.id),
    supabase.from("project_manual_channels").select("sns, profile_url").eq("project_id", project.id),
    xReady ? xSpendThisMonth() : null,
  ]);
  // 同じ SNS の別のアカウントから付け替えたとき（つないだ直後だけ）。新しいアカウントの名前は今つながっているものから
  const replacedNames = typeof connected === "string" ? readReplacedCookie((await cookies()).get(SNS_REPLACED_COOKIE)?.value) : [];
  const connectedAccount = snsAccounts.find((a) => a.sns === connected && a.status === "active");
  const connectedName = connectedAccount ? (connectedAccount.handle ? `@${connectedAccount.handle}` : connectedAccount.displayName) : null;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader title="プロジェクトの設定" />

      <SnsResultBanner connected={connected} error={sns_error} sns={sns} replaced={replacedNames} connectedName={connectedName} />
      {done === "saved" && <SuccessBanner>このアプリについてを保存しました。</SuccessBanner>}

      <SnsAccountsCard
        projectId={project.id}
        accounts={snsAccounts}
        manualChannels={manualChannels ?? []}
        connectable={{ threads: threadsConfigured(), x: xReady, instagram: instagramConfigured(), facebook: facebookConfigured() }}
        xSpend={xSpend}
      />

      <ProjectForm
        action={updateProject.bind(null, project.id)}
        initial={project}
        title="このアプリについて"
        titleAs="h2"
        submitLabel="保存する"
        pendingLabel="保存しています…"
        cancelHref={`/projects/${project.id}`}
      />

      {/* 削除は目立たせず、いちばん下に畳んで置く（2026-11-02 オーナーの指示）。開くと説明と確認の欄が出る */}
      <Disclosure summary="プロジェクトを削除する" className="mt-6 border-t border-line pt-5">
        <div className="flex max-w-xl flex-col gap-4 pt-1">
          <p>削除すると、このプロジェクトの情報は元に戻せません。</p>
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </Disclosure>
    </div>
  );
}
