import type { Metadata } from "next";

export const metadata: Metadata = { title: "データ削除の確認" };

// Delete Callback の応答で Meta に渡す確認ページ。削除は通知を受けた時点で済ませている
export default async function DeletionStatusPage(props: PageProps<"/sns/threads/deletion">) {
  const { code } = await props.searchParams;
  const confirmation = typeof code === "string" && /^[0-9a-f]{16}$/.test(code) ? code : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-16 text-center">
      <h1 className="font-heading text-2xl font-bold">Threads のデータを削除しました</h1>
      <p className="max-w-[480px] text-[14px] leading-[1.7] text-muted">
        矢書に保存していた Threads のアカウント情報とアクセストークンを削除しました。
        矢書で作った下書きや投稿の記録は残っています。不要であれば矢書から削除してください。
      </p>
      {confirmation && (
        <p className="text-[14px]">
          確認コード: <span className="font-bold">{confirmation}</span>
        </p>
      )}
    </main>
  );
}
