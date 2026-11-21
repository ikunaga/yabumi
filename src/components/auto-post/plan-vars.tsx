"use client";

import { Badge } from "@/components/ui/chip";
import { Input, Textarea } from "@/components/ui/field";
import { Choice } from "@/components/posts/maker-parts";
import { MAX_PLAN_VAR_VALUE, MAX_SERIES_INSTRUCTION, handVars, type FormatSeries, type PlanVars } from "@/lib/post-formats/series";

// 自動投稿の設定の「自分で入れる」変数の決め方（2026-11-21 オーナーの決定。docs/design/format-series.md の 1.2）。
// フォーマットは変えず、決め方は回し方（auto_plans.materials.format_vars）に持つ。決めていない変数があると保存できない
export function PlanVarsFields({ series, bodyVars, value, onChange }: { series: FormatSeries; bodyVars: string[]; value: PlanVars; onChange: (v: PlanVars) => void }) {
  const hand = handVars(series);
  if (!hand.length) return null;
  const set = (name: string, c: PlanVars[string] | null) => {
    const next = { ...value };
    if (c) next[name] = c;
    else delete next[name];
    onChange(next);
  };
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3" aria-label="自分で入れる変数の決め方">
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-bold">自分で入れる変数の決め方</p>
        <p className="text-xs leading-[1.7] text-muted">このフォーマットには、投稿をつくるときに自分で入れる変数があります。自動投稿での入れ方を選んでください。</p>
      </div>
      {hand.map((v) => {
        const c = value[v.name];
        const how = !c ? null : "instruction" in c ? "ai" : "value";
        return (
          <div key={v.name} className="flex flex-col gap-2 border-t border-line pt-3 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold">{`{${v.name}}`}</span>
              {bodyVars.includes(v.name) ? <Badge tone="info">本文</Badge> : <Badge tone="success">画像</Badge>}
              {!c && <Badge tone="signal">要確認</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Choice on={how === "value"} onClick={() => how !== "value" && set(v.name, { value: "" })}>
                毎回同じ言葉を入れる
              </Choice>
              <Choice on={how === "ai"} onClick={() => how !== "ai" && set(v.name, { instruction: "" })}>
                自動投稿では AI に考えてもらう
              </Choice>
            </div>
            {c && "value" in c && (
              <Input aria-label={`${v.name} に毎回入れる言葉`} value={c.value} maxLength={MAX_PLAN_VAR_VALUE} onChange={(e) => set(v.name, { value: e.target.value })} placeholder="毎回入れる言葉" className="py-2 text-sm" />
            )}
            {c && "instruction" in c && (
              <Textarea
                aria-label={`${v.name} の AI への指示`}
                value={c.instruction}
                maxLength={MAX_SERIES_INSTRUCTION}
                rows={2}
                onChange={(e) => set(v.name, { instruction: e.target.value })}
                placeholder="AI への指示。例: 季節に合う言葉を 1 つ"
                className="min-h-[3.75rem] py-2 text-sm [field-sizing:content]"
              />
            )}
          </div>
        );
      })}
    </section>
  );
}

// 決め方がそろっているか（選んでいて、言葉か指示が入っている）
export function planVarsReady(series: FormatSeries | null | undefined, value: PlanVars | undefined): boolean {
  return handVars(series).every((v) => {
    const c = value?.[v.name];
    return !!c && ("value" in c ? c.value.trim() : c.instruction.trim()).length > 0;
  });
}
