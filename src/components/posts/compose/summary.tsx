"use client";

import { COMPOSE_STEPS, type StepNo } from "@/lib/posts/compose-steps";
import { findUrls } from "@/lib/posts/profile-link";
import { SNS } from "@/lib/sns";
import { hashtagLine } from "@/lib/sns/hashtags";
import { type Composer } from "./use-composer";

// ⑤ のまとめ: ①〜④ の短い要約と、直すところ。「直す」でそのステップへ（docs/design/compose-steps.md の 2.）
export function ComposeSummary({ c }: { c: Composer }) {
  const { body, chosen, images, shortLinks, textFor, tagsFor, stepProblems, goStep, isLocked } = c;
  // SNS ごとのタグ（同じタグの SNS はまとめる。4.59）
  const tagGroups = new Map<string, string[]>();
  for (const s of chosen) {
    const line = hashtagLine(tagsFor(s));
    if (line) tagGroups.set(line, [...(tagGroups.get(line) ?? []), SNS[s].label]);
  }
  const tagLines = [...tagGroups].map(([line, labels]) => `タグ ${labels.join("・")}: ${line}`);
  const firstLine = body.trim().split("\n")[0] ?? "";
  const hasLink = findUrls(body).length > 0 || chosen.some((s) => findUrls(textFor(s)).length > 0);
  const rows: { n: StepNo; text: string; sub?: string[] }[] = [
    { n: 1, text: firstLine ? (firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine) : "まだ書いていません" },
    { n: 2, text: chosen.length ? chosen.map((s) => `${SNS[s].label}${isLocked(s) ? "（投稿済み）" : ""}`).join("・") : "まだ選んでいません", sub: tagLines },
    { n: 3, text: images.length ? `画像 ${images.length} 枚` : "画像なし" },
    { n: 4, text: hasLink ? (shortLinks ? "リンクあり（短縮リンクで押された回数を数える）" : "リンクあり") : "リンクなし" },
  ];
  return (
    <section aria-labelledby="compose-summary" className="flex flex-col gap-1">
      <h3 id="compose-summary" className="text-[14px] font-bold">
        まとめ
      </h3>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {rows.map((r) => {
          const problems = stepProblems.filter((p) => p.step === r.n);
          return (
            <li key={r.n} className="flex items-start gap-3 px-3.5 py-2.5">
              <span className="num w-5 shrink-0 pt-0.5 text-[13px] text-faint">{r.n}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] text-muted">{COMPOSE_STEPS[r.n - 1].label}</span>
                <span className="text-[15px] break-words">{r.text}</span>
                {r.sub?.map((t) => (
                  <span key={t} className="text-[13px] break-words text-muted">
                    {t}
                  </span>
                ))}
                {problems.map((p) => (
                  <span key={p.text} className="text-[13px] font-semibold text-signal">
                    ● {p.text}
                  </span>
                ))}
              </span>
              <button type="button" onClick={() => goStep(r.n)} className="shrink-0 pt-0.5 text-[13px] font-semibold text-primary hover:underline">
                直す
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
