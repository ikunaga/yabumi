import { SentLoadingNotice } from "@/components/posts/send-progress";
import { PageSkeleton } from "@/components/ui/skeleton";

// 押した瞬間に出す骨組み（画面ができるまでの間）。今すぐ送ったあとに移ってきたときは、上に「結果を読み込んでいます」を出す（4.36）
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <SentLoadingNotice />
      <PageSkeleton variant="single" />
    </div>
  );
}
