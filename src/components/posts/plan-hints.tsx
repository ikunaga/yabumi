import Link from "next/link";
import { hasToneBySns, isSplitBySns, pillarsBySns, pillarSnsLabel, type Pillar } from "@/lib/plan/pillars";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { DisclosureBox } from "@/components/ui/disclosure";

export type PlanHintsData = {
  // コンセプトの 1 文（4.50。一番上に出す）。前の版のデータは空
  concept?: string;
  pillars: Pillar[];
  tone: string;
  toneBySns: Partial<Record<SnsKey, string>>;
  avoid: string;
  // ハッシュタグの候補（# なし。投稿のフォーマットのタグに押して足す。4.59）
  hashtags?: string[];
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
    <DisclosureBox label="アカウントの方針を表示" className="text-sm">
      <div className="flex flex-col gap-2.5 leading-[1.7]">
        {!empty && (
          <Link href={planHref} className="self-end text-xs font-semibold text-primary hover:underline">
            アカウントの方針を編集
          </Link>
        )}
        {empty ? (
          <p className="text-muted">
            まだアカウントの方針がありません。
            <Link href={planHref} className="font-semibold text-primary hover:underline">
              「アカウントの方針」
            </Link>
            で投稿のテーマと口調を決めると、ここに出ます。
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
                      <p className="text-xs font-bold text-muted">{SNS[k].label} の投稿のテーマ</p>
                      {pillars.length ? <PillarList pillars={pillars} /> : <p className="text-muted">この SNS には、投稿のテーマがありません。</p>}
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
                <span className="text-muted">{hasToneBySns({ toneBySns }) ? "共通の口調: " : "口調: "}</span>
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
    </DisclosureBox>
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
