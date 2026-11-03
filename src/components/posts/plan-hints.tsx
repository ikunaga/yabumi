import Link from "next/link";
import { hasToneBySns, isSplitBySns, pillarsBySns, pillarSnsLabel, type Pillar } from "@/lib/plan/pillars";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";

export type PlanHintsData = {
  // コンセプトの 1 文（4.50。一番上に出す）。前の版のデータは空
  concept?: string;
  pillars: Pillar[];
  tone: string;
  toneBySns: Partial<Record<SnsKey, string>>;
  avoid: string;
};

// 投稿を書くときの手がかり: アカウント設計の「コンセプト」「投稿の柱」「口調」を見返す（コンセプトの 1 文を一番上に）。本文の欄を目立たせるため、閉じて置く（開けば見られる）。
// 柱を SNS ごとに分けているときは、送り先（sns）に選んだ SNS ごとに、その SNS に付いた柱を出す（選んでいなければ、柱ごとに使う SNS を添える）。
// SNS ごとの口調があれば、その SNS の柱の下に出す（柱を分けていなければ、共通の口調の下に SNS ごとに）
export function PlanHints({ projectId, hints, sns = [] }: { projectId: string; hints: PlanHintsData | null; sns?: SnsKey[] }) {
  const planHref = `/projects/${projectId}/plan`;
  const toneBySns = hints?.toneBySns ?? {};
  const concept = hints?.concept?.trim() ?? "";
  const empty = !hints || (!concept && hints.pillars.length === 0 && !hints.tone && !hasToneBySns({ toneBySns }) && !hints.avoid);
  const bySnsView = Boolean(hints && hints.pillars.length > 0 && isSplitBySns(hints.pillars) && sns.length > 0);
  // 共通の口調の下に出す SNS ごとの口調（SNS ごとにまとめて出すときは、そちらに出す）
  const toneRows = bySnsView ? [] : SNS_KEYS.filter((k) => (sns.length === 0 || sns.includes(k)) && toneBySns[k]?.trim());

  return (
    <details className="group rounded-lg border border-border bg-surface text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-semibold">
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ▸
        </span>
        設計を見返す（コンセプト・投稿の柱と口調）
        <Link href={planHref} className="ml-auto shrink-0 text-xs font-semibold whitespace-nowrap text-primary hover:underline">
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
            {concept && (
              <p className="rounded-md bg-surface2 px-3 py-2">
                <span className="block text-xs font-bold text-muted">コンセプト</span>
                {concept}
              </p>
            )}
            {hints.pillars.length > 0 &&
              (bySnsView ? (
                <div className="flex flex-col gap-2">
                  {pillarsBySns(hints.pillars, sns).map(({ sns: k, pillars }) => (
                    <div key={k}>
                      <p className="text-xs font-bold text-muted">{SNS[k].label} の柱</p>
                      {pillars.length ? <PillarList pillars={pillars} /> : <p className="text-muted">この SNS に付いた柱はありません。</p>}
                      {toneBySns[k]?.trim() && (
                        <p>
                          <span className="text-muted">口調: </span>
                          {toneBySns[k]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <PillarList pillars={hints.pillars} withSns={isSplitBySns(hints.pillars)} />
              ))}
            {hints.tone && (
              <p>
                <span className="text-muted">{hasToneBySns({ toneBySns }) ? "口調（共通）: " : "口調: "}</span>
                {hints.tone}
              </p>
            )}
            {toneRows.map((k) => (
              <p key={k}>
                <span className="text-muted">{SNS[k].label} の口調: </span>
                {toneBySns[k]}
              </p>
            ))}
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

function PillarList({ pillars, withSns = false }: { pillars: Pillar[]; withSns?: boolean }) {
  return (
    <ul className="flex flex-col gap-1">
      {pillars.map((p, i) => (
        <li key={i}>
          <b>{p.name}</b>
          {p.share !== null && <span className="text-muted">（{p.share}%）</span>}
          {withSns && <span className="text-muted">［{pillarSnsLabel(p)}］</span>}
          {p.example && <span className="text-muted"> 例: {p.example}</span>}
        </li>
      ))}
    </ul>
  );
}
