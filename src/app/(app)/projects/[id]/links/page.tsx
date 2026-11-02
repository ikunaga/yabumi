import { isAppProject } from "@/lib/projects/product-types";
import { destinationCandidates, listDestinations } from "@/lib/projects/destinations";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { LinkDomainCard } from "@/components/links/link-domain-card";
import { CopyButton, CustomLinkForm, ProfileLinkForm, ProviderTokenForm } from "@/components/links/link-forms";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { SnsMark } from "@/components/ui/marks";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { Term } from "@/components/ui/term";
import { setLinkDisabled } from "@/lib/links/actions";
import { getLinkDomain } from "@/lib/links/domains";
import { listLinks, type LinkRow } from "@/lib/links/queries";
import { shortLinkBase } from "@/lib/links/rules";
import { vercelConfig } from "@/lib/links/vercel";
import { PROFILE_RULES } from "@/lib/plan/profile";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";
import { SNS, type SnsKey } from "@/lib/sns";

export const metadata: Metadata = { title: "短縮リンク" };

// プロフィールに置くリンクを作る SNS の順（X と Instagram は本文のリンクで数えにくいので先に）
const PROFILE_SNS: SnsKey[] = ["x", "instagram", "threads", "facebook", "tiktok", "youtube", "note", "substack"];

const PROFILE_NOTE: Partial<Record<SnsKey, ReactNode>> = {
  x: (
    <>
      X は本文に URL があると、投稿 1 本の<Term k="payPerUse">API の料金</Term>が上がります（約 2 円 → 約 30 円）。URL はプロフィールに置き、このリンクで数えるのがおすすめです。
    </>
  ),
  instagram: "Instagram は投稿の本文の URL を押せません。プロフィールのリンク（とストーリーズのリンク）に置いて数えます。",
};

function formatCount(n: number) {
  return n.toLocaleString("ja-JP");
}

function Clicks({ link }: { link: LinkRow }) {
  return (
    <span className="num text-sm whitespace-nowrap text-faint">
      7 日 <b className="text-[16px] text-fg">{formatCount(link.clicks7d)}</b>　30 日 <b className="text-fg">{formatCount(link.clicks30d)}</b>　これまで{" "}
      <b className="text-fg">{formatCount(link.clicksTotal)}</b>
    </span>
  );
}

function LinkLine({ projectId, link }: { projectId: string; link: LinkRow }) {
  return (
    <li className="flex flex-col gap-1.5 border-t border-line px-6 py-3.5 max-sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {link.sns && <SnsMark sns={link.sns} />}
        <span className={`font-bold break-all ${link.disabled ? "text-muted line-through" : ""}`}>{link.url.replace(/^https:\/\//, "")}</span>
        {!link.disabled && <CopyButton text={link.url} />}
        <span className="ml-auto">
          <Clicks link={link} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {link.label && <span>{link.label}</span>}
        <span className="min-w-0 break-all">→ {link.destination}</span>
        {link.postId && (
          <Link href={`/projects/${projectId}/posts/${link.postId}`} className="text-primary hover:underline">
            投稿を見る
          </Link>
        )}
        <form action={setLinkDisabled.bind(null, projectId, link.id, !link.disabled)} className="ml-auto">
          <button type="submit" className="text-muted hover:text-fg hover:underline">
            {link.disabled ? "使い直す" : "止める"}
          </button>
        </form>
      </div>
    </li>
  );
}

// 短縮リンク（F07 のストアページ到達。docs/architecture.md の 4.22、決定 D20）
export default async function LinksPage(props: PageProps<"/projects/[id]/links">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const supabase = await createClient();
  const [links, linkDomain, registered] = await Promise.all([listLinks(project.id), getLinkDomain(supabase, project.id), listDestinations(supabase, project.id)]);

  // 行き先の候補: アプリならストアの URL、そしてプロジェクトの設定で入れた行き先の URL（決定 D34）
  const destinations = destinationCandidates(project, registered);
  const profile = new Map(links.filter((l) => l.kind === "profile" && !l.disabled && l.sns).map((l) => [l.sns!, l]));
  const postLinks = links.filter((l) => l.kind === "post");
  const others = links.filter((l) => l.kind !== "post" && !(l.kind === "profile" && !l.disabled));
  const totalExcluded = links.reduce((n, l) => n + l.excludedTotal, 0);
  const sum = (f: (l: LinkRow) => number) => links.reduce((n, l) => n + f(l), 0);

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="短縮リンク"
        help={
          <>
            {isAppProject(project) ? (
              <>
                SNS から<Term k="storeListing">ストアページ</Term>に来た人を数えるための<Term k="shortLink">短縮リンク</Term>です。SNS ごとに別のリンクを使うと、どの SNS から何人来たかがわかります。行き先には、ストアの側でも見分けられる<Term k="campaignLink">印</Term>を自動で付けます。
              </>
            ) : (
              <>
                SNS から行き先のページ（サイト・予約・お店のページなど）に来た人を数えるための<Term k="shortLink">短縮リンク</Term>です。SNS ごとに別のリンクを使うと、どの SNS から何人来たかがわかります。行き先には、解析の道具でも見分けられる<Term k="campaignLink">印</Term>を自動で付けます。
              </>
            )}
          </>
        }
      />

      {/* 数字の段（見本 A の上の 4 つ） */}
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-3">
        <Metric label="クリック（7 日）" value={formatCount(sum((l) => l.clicks7d))} unit="回" />
        <Metric label="クリック（30 日）" value={formatCount(sum((l) => l.clicks30d))} unit="回" />
        <Metric label="クリック（これまで）" value={formatCount(sum((l) => l.clicksTotal))} unit="回" />
        <Metric label="使っているリンク" value={links.filter((l) => !l.disabled).length} unit="本" note={`止めた ${links.filter((l) => l.disabled).length} 本`} />
      </div>

      {/* 「この画面のリンクは投稿と連動するのか、手で貼るのか」で迷わないよう、2 種類あることを開く欄に置く */}
      <Disclosure summary="2 種類のリンク（プロフィールに置く・投稿の本文から自動で作る）">
        <ul className="flex flex-col gap-2">
          <li>
            <b className="text-fg">プロフィールに置くリンク</b>: この画面で作り、コピーして SNS のプロフィールに<b className="text-fg">自分で貼ります</b>。yabumi がプロフィールを書き換えることはありません。
          </li>
          <li>
            <b className="text-fg">投稿の本文の URL</b>: 投稿をつくるときに本文に URL を入れると、送るときに投稿ごと・SNS ごとの短縮リンクに<b className="text-fg">自動で置き換わります</b>
            。この画面のリンクを本文に貼る必要はありません。
          </li>
        </ul>
      </Disclosure>

      <Columns
        main={
          <>
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    プロフィールに置くリンク
                    <HelpTip label="プロフィールに置くリンク">SNS のプロフィールのリンク欄に貼ります。投稿を見て興味を持った人は、プロフィールから{isAppProject(project) ? "ストア" : "行き先のページ"}へ進むことが多いからです。</HelpTip>
                  </span>
                }
              />
              {destinations.length === 0 ? (
                <EmptyState
                  description={
                    <>
                      先に、プロジェクトの設定で{isAppProject(project) ? "ストアの URL か行き先の URL" : "行き先の URL（サイト・予約・お店のページなど）"}を入れてください（<Link href={`/projects/${project.id}/edit`} className="text-primary hover:underline">プロジェクトの設定</Link>）。ほかの URL へのリンクは、下の「自由に作るリンク」で作れます。
                    </>
                  }
                />
              ) : (
                <ul>
                  {PROFILE_SNS.map((sns) => {
                    const link = profile.get(sns);
                    return (
                      <li key={sns} className="flex flex-col gap-2 border-t border-line px-6 py-4 max-sm:px-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <SnsMark sns={sns} />
                          <b>{SNS[sns].label}</b>
                          <HelpTip label={`${SNS[sns].label} のリンクを貼る場所`}>
                            {link ? "コピーして" : "作ったら、コピーして"}、{SNS[sns].label} のプロフィールに自分で貼ってください（yabumi からプロフィールは書き換えません）。貼る場所: {PROFILE_RULES[sns].linkNote}
                            {PROFILE_NOTE[sns] && <span className="mt-2 block">{PROFILE_NOTE[sns]}</span>}
                          </HelpTip>
                          {link ? (
                            <>
                              <span className="break-all">{link.url.replace(/^https:\/\//, "")}</span>
                              <CopyButton text={link.url} />
                              <span className="ml-auto">
                                <Clicks link={link} />
                              </span>
                            </>
                          ) : null}
                        </div>
                        {link ? (
                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                            <span className="min-w-0 break-all">→ {link.destination}</span>
                            <form action={setLinkDisabled.bind(null, project.id, link.id, true)} className="ml-auto">
                              <button type="submit" className="hover:text-fg hover:underline">
                                止める
                              </button>
                            </form>
                          </div>
                        ) : (
                          <ProfileLinkForm projectId={project.id} sns={sns} destinations={destinations} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    投稿の本文から作ったリンク
                    <HelpTip label="投稿の本文から作ったリンク">
                      投稿の本文の URL から自動で作ったリンクです（投稿ごと・SNS ごと）。投稿どうしで比べるなら、
                      <Link href={`/projects/${project.id}/metrics`} className="font-bold underline">
                        分析
                      </Link>
                      の「クリックの多い投稿」が見やすいです。
                    </HelpTip>
                  </span>
                }
                action={<span className="num">{postLinks.length} 本</span>}
              />
              {postLinks.length ? (
                <ul className="pb-1">
                  {postLinks.map((l) => (
                    <LinkLine key={l.id} projectId={project.id} link={l} />
                  ))}
                </ul>
              ) : (
                <EmptyState description="まだありません。投稿の本文に URL を入れて保存すると、ここに並びます（Instagram と手で投稿する SNS は置き換えません）。" />
              )}
            </Card>

            <Card>
              <CardHeader title="自由に作ったリンク・止めたリンク" action={<span className="num">{others.length} 本</span>} />
              {others.length ? (
                <ul>
                  {others.map((l) => (
                    <LinkLine key={l.id} projectId={project.id} link={l} />
                  ))}
                </ul>
              ) : (
                <EmptyState description="まだありません。上の「自由に作るリンク」で作ると、ここに並びます。" />
              )}
            </Card>

          </>
        }
        side={
          <>
            <Card>
              <CardHeader title="自由に作るリンク" />
              <div className="px-6 pt-1 pb-5 max-sm:px-4">
                <CustomLinkForm projectId={project.id} destinations={destinations} />
              </div>
            </Card>

            <LinkDomainCard
              projectId={project.id}
              ready={vercelConfig() !== null}
              defaultHost={shortLinkBase().replace(/^https?:\/\//, "")}
              domain={
                linkDomain && {
                  domain: linkDomain.domain,
                  status: linkDomain.status as "pending" | "active",
                  cnameTarget: linkDomain.cname_target,
                  txtName: linkDomain.txt_name,
                  txtValue: linkDomain.txt_value,
                  ownershipToken: linkDomain.ownership_token,
                  pendingSince: linkDomain.pending_since,
                  verifiedAt: linkDomain.verified_at,
                  lastCheck: linkDomain.last_check,
                  lastCheckedAt: linkDomain.last_checked_at,
                }
              }
              profileLinks={PROFILE_SNS.flatMap((sns) => {
                const l = profile.get(sns);
                return l ? [{ sns: SNS[sns].label, url: l.url }] : [];
              })}
            />

            {isAppProject(project) && project.app_store_url && (
              <Card>
                <CardHeader title="App Store のキャンペーンの印（任意）" />
                <div className="flex flex-col gap-3 px-6 pt-1 pb-5 text-sm leading-[1.8] max-sm:px-4">
                  <Disclosure summary="入れるとできること・入れ方">
                    <p>
                      入れておくと、App Store Connect の「キャンペーン」で、SNS ごとのストアの閲覧やダウンロードが見られるようになります（数が少ないうちは表示されません）。
                    </p>
                    <ol className="mt-1 list-decimal pl-5">
                      <li>App Store Connect →「アプリ」→ このアプリ →「分析」→「獲得」→「キャンペーン」を開く</li>
                      <li>「キャンペーンリンクを作成」で、名前を何か入れてリンクを作る（アプリに分析のデータがまだないと作れません）</li>
                      <li>できたリンクの「pt=」のあとの数字を、下に入れる</li>
                    </ol>
                  </Disclosure>
                  <ProviderTokenForm projectId={project.id} current={project.app_store_provider_token ?? null} />
                </div>
              </Card>
            )}
            <Disclosure summary="数えないクリック">
              SNS がリンクのプレビューを作るための自動の読み込み、ブラウザの先読み、同じ人が 10 分以内にもう一度押したもの
              {totalExcluded > 0 && `（これまで ${formatCount(totalExcluded)} 回）`}は数えません。押した人の IP アドレスは保存しません。
            </Disclosure>

          </>
        }
      />
    </div>
  );
}
