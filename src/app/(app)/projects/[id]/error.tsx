"use client";

import { useParams } from "next/navigation";
import { ErrorFallback } from "@/components/error-fallback";

// プロジェクトの中の画面で起きた思わぬエラー。メニュー（サイドバー・下のタブ）は残したまま、中身だけを差し替える
export default function ProjectError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { id } = useParams<{ id: string }>();
  return <ErrorFallback error={error} retry={retry} backHref={`/projects/${id}`} backLabel="概要へ" />;
}
