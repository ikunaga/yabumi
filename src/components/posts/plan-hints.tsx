import Link from "next/link";

export type PlanHintsData = {
  pillars: { name: string; share: number | null; example: string }[];
  tone: string;
  avoid: string;
};

// 投稿を書くときの手がかり: アカウント設計の「投稿の柱」と「口調」を見返す
export function PlanHints({ projectId, hints }: { projectId: string; hints: PlanHintsData | null }) {
  const planHref = `/projects/${projectId}/plan`;
  const empty = !hints || (hints.pillars.length === 0 && !hints.tone && !hints.avoid);

  return (
    <details className="group rounded-lg border border-border bg-surface text-sm" open={!empty}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-bold">
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ▸
        </span>
        設計を見返す（投稿の柱と口調）
        <Link href={planHref} className="ml-auto text-xs font-semibold text-primary hover:underline">
          設計を直す
        </Link>
      </summary>
      <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3 leading-[1.7]">
        {empty ? (
          <p className="text-muted">
            まだ設計がありません。
            <Link href={planHref} className="font-semibold text-primary hover:underline">
              アカウント設計
            </Link>
            で投稿の柱と口調を決めると、ここに出ます。
          </p>
        ) : (
          <>
            {hints.pillars.length > 0 && (
              <ul className="flex flex-col gap-1">
                {hints.pillars.map((p, i) => (
                  <li key={i}>
                    <b>{p.name}</b>
                    {p.share !== null && <span className="text-muted">（{p.share}%）</span>}
                    {p.example && <span className="text-muted"> 例: {p.example}</span>}
                  </li>
                ))}
              </ul>
            )}
            {hints.tone && (
              <p>
                <span className="text-muted">口調: </span>
                {hints.tone}
              </p>
            )}
            {hints.avoid && (
              <p>
                <span className="text-muted">やらないこと: </span>
                {hints.avoid}
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
