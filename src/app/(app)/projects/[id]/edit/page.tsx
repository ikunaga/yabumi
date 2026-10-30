import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { ProjectForm } from "@/components/projects/project-form";
import { SnsAccountsCard } from "@/components/projects/sns-accounts-card";
import { SnsResultBanner } from "@/components/projects/sns-result-banner";
import { Card, CardHeader } from "@/components/ui/card";
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

// プロジェクトの設定（つないだ SNS・このアプリについて・削除）。SNS をつないだあとはここに戻る（src/lib/projects/paths.ts）
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
    <div className="flex max-w-[680px] flex-col gap-8 max-sm:gap-5 xl:max-w-none">
      <h1 className="font-heading text-[30px] font-bold max-sm:text-2xl">プロジェクトの設定</h1>

      <SnsResultBanner connected={connected} error={sns_error} sns={sns} replaced={replacedNames} connectedName={connectedName} />
      {done === "saved" && <SuccessBanner>このアプリについてを保存しました。</SuccessBanner>}

      <div className="xl:max-w-[680px]">
        <SnsAccountsCard
          projectId={project.id}
          accounts={snsAccounts}
          manualChannels={manualChannels ?? []}
          connectable={{ threads: threadsConfigured(), x: xReady, instagram: instagramConfigured(), facebook: facebookConfigured() }}
          xSpend={xSpend}
        />
      </div>

      <ProjectForm
        action={updateProject.bind(null, project.id)}
        initial={project}
        title="このアプリについて"
        titleAs="h2"
        submitLabel="保存する"
        pendingLabel="保存しています…"
        cancelHref={`/projects/${project.id}`}
      />

      <Card className="border-danger/50 xl:max-w-[680px]">
        <CardHeader title={<span className="text-danger">プロジェクトを削除</span>} />
        <div className="flex flex-col gap-4 px-5 py-5 max-sm:px-4">
          <p className="text-[14px] text-muted">削除すると、このプロジェクトの情報は元に戻せません。</p>
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </Card>
    </div>
  );
}
