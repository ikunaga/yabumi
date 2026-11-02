import { PageSkeleton } from "@/components/ui/skeleton";

// 押した瞬間に出す骨組み（画面ができるまでの間）
export default function Loading() {
  return <PageSkeleton variant="metrics" />;
}
