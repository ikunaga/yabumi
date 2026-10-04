import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { SECTION_KEYS, isSectionDone, type PlanData } from "@/lib/plan/schema";

// 概要の「アカウント設計」: 進み具合と投稿の柱。スマホではここから設計を開く
export function PlanSummaryCard({ projectId, plan }: { projectId: string; plan: PlanData }) {
  const doneCount = SECTION_KEYS.filter((k) => isSectionDone(k, plan[k])).length;
  const pillars = plan.pillars.items.filter((p) => p.name.trim());
  const href = `/projects/${projectId}/plan`;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="アカウント設計"
        action={
          <Link href={href} className="hover:underline">
            {doneCount === 0 ? "設計する" : "開く"}
          </Link>
        }
      />
      <dl className="grid grid-cols-[120px_1fr] text-[14px]">
        <dt className="border-b border-line px-5 py-3 text-muted max-sm:px-4">記入済み</dt>
        <dd className="border-b border-line py-3 pr-5">
          {doneCount} / {SECTION_KEYS.length}
        </dd>
        <dt className="px-5 py-3 text-muted max-sm:px-4">投稿の柱</dt>
        <dd className="min-w-0 py-3 pr-5 leading-[1.6]">
          {pillars.length ? pillars.map((p) => p.name).join("・") : <span className="text-muted">まだ決まっていません</span>}
        </dd>
      </dl>
    </Card>
  );
}
