import type { Metadata } from "next";
import { PublicCard, PublicFrame } from "@/components/public/public-frame";

export const metadata: Metadata = { title: "データ削除の確認" };

// Delete Callback の応答で Meta に渡す確認ページ。削除は通知を受けた時点で済ませている
export default async function DeletionStatusPage(props: PageProps<"/sns/threads/deletion">) {
  const { code } = await props.searchParams;
  const confirmation = typeof code === "string" && /^[0-9a-f]{16}$/.test(code) ? code : null;

  return (
    <PublicFrame>
      <PublicCard title={`Threads のデータを削除しました`}>
        <p>
          矢書に保存していた Threads のアカウント情報とアクセストークン、Threads から読んだ投稿の数字とフォロワーの数、Threads 上の投稿の ID と URL を削除しました。
        </p>
        <p className="text-muted">矢書で書いた下書きや投稿の本文は残っています。不要であれば矢書から削除してください。</p>
        {confirmation && (
          <p className="rounded-md bg-surface2 px-4 py-3 text-[14px]">
            確認コード: <span className="num font-bold">{confirmation}</span>
          </p>
        )}
      </PublicCard>
    </PublicFrame>
  );
}
