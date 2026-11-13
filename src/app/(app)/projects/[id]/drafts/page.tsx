import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { draftHeadline } from "@/lib/posts/drafts";
import { DRAFTS_LIMIT, listDrafts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { formatShort } from "@/lib/time";

export const metadata: Metadata = { title: "下書き" };

// 下書きの一覧（2026-11-13 PMO2 の確かめ: 保存した下書きへたどる入口が、カレンダーのいちばん下の「日付のない下書き」だけだった）。
// まだどこにも送っていない下書きを、日付のあるものもないものも、直した日の新しい順に並べる。予約した投稿はカレンダーにあるので入れない。
// 行を押すと、その下書き（投稿をつくる）を開く。入口は、概要とカレンダーの「下書き n 件」・投稿をつくるの「下書きから続ける」・More
export default async function DraftsPage(props: PageProps<"/projects/[id]/drafts">) {
  const { id } = await props.params;
  const [project, drafts] = await Promise.all([getProject(id), listDrafts(id)]);
  if (!project) notFound();
  const base = `/projects/${project.id}`;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="下書き"
        sub={drafts.length > 0 ? `${drafts.length} 件` : undefined}
        actions={<ButtonLink href={`${base}/compose`}>＋ 投稿をつくる</ButtonLink>}
      />
      <Card className="overflow-hidden">
        {drafts.length === 0 ? (
          <EmptyState
            title="下書きはありません"
            description="投稿をつくるで「下書きに保存する」を押すと、ここに並びます。"
            action={<ButtonLink href={`${base}/compose`}>投稿をつくる</ButtonLink>}
          />
        ) : (
          <ul>
            {drafts.map((d) => {
              const head = draftHeadline({ body: d.body, overrides: d.overrides, titles: d.titles, images: d.images });
              const chars = [...d.body.trim()].length;
              return (
                <li key={d.id} className="border-t border-line first:border-t-0">
                  <Link href={`${base}/posts/${d.id}`} className="flex flex-col gap-1.5 px-6 py-3.5 hover:bg-surface2 hover:no-underline max-sm:px-4">
                    {/* 長い本文は 2 行まで出して「…」で切る（どこで切れたかわかるように、字数も添える） */}
                    <span className={`line-clamp-2 text-[15px] leading-[1.7] break-words ${head.empty ? "text-muted" : "font-bold text-fg"}`}>{head.text}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {d.sns.length > 0 ? (
                        <span className="flex gap-1">
                          {d.sns.map((s) => (
                            <SnsMark key={s} sns={s} />
                          ))}
                        </span>
                      ) : (
                        <span>送り先はまだ</span>
                      )}
                      <span className="num">{d.plannedAt ? `予定 ${formatShort(d.plannedAt)}` : "日付なし"}</span>
                      {chars > 0 && <span className="num">全 {chars} 字</span>}
                      {d.images > 0 && <span className="num">画像 {d.images} 枚</span>}
                      <span className="num">直した日 {formatShort(d.updatedAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {drafts.length >= DRAFTS_LIMIT && <p className="px-1 text-sm text-muted">新しいほうから {DRAFTS_LIMIT} 件を出しています。</p>}
    </div>
  );
}
