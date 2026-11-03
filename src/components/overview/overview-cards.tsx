import { Delta, Metric } from "@/components/ui/metric";
import { Term } from "@/components/ui/term";
import { KPIS } from "@/lib/metrics/kpis";
import type { OverviewCard } from "@/lib/overview/numbers";

export function formatCardValue(c: OverviewCard): string {
  if (c.notArrived) return "—";
  if (c.currency) return c.currency === "JPY" ? `¥${Math.round(c.value).toLocaleString("ja-JP")}` : `${c.value.toLocaleString("ja-JP")} ${c.currency}`;
  return c.value.toLocaleString("ja-JP");
}

// ラベル。用語の解説があるものは点線（押すと出る）
export function CardLabel({ card }: { card: OverviewCard }) {
  if (card.key === "link_clicks") return <Term k="shortLink">{card.label}</Term>;
  const term = card.kpi ? KPIS[card.kpi].term : undefined;
  return term ? <Term k={term}>{card.label}</Term> : <>{card.label}</>;
}

// 概要の上の数字のカード（見本 A の 4 枚）
// カードが 4 枚に満たないときも、横幅いっぱいに並べる（Tailwind はクラス名をそのまま探すので書き並べる）
const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

// mobileHidden: スマホの大きな数字と同じ数字のカード（スマホでは重ねて出さない）
export function OverviewCards({ cards, mobileHidden, className = "" }: { cards: OverviewCard[]; mobileHidden?: OverviewCard["key"]; className?: string }) {
  return (
    <div className={`grid ${COLS[cards.length] ?? "grid-cols-4"} gap-4 max-lg:grid-cols-2 max-sm:gap-3 ${className}`}>
      {cards.map((c) => (
        <Metric
          key={c.kpi ?? c.key}
          label={<CardLabel card={c} />}
          value={formatCardValue(c)}
          unit={c.unit}
          delta={c.deltaPct !== null ? <Delta value={c.deltaPct} unit="%" /> : undefined}
          note={c.note}
          className={c.key === mobileHidden ? "max-sm:hidden" : ""}
        />
      ))}
    </div>
  );
}
