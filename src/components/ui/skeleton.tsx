// 画面を読み込んでいる間の骨組み（loading.tsx）。押した瞬間に次の画面の形を出し、押した感覚を返す。
// チカチカしないよう、色は地より一段濃い灰だけで動かさず、すぐ終わる読み込みでは見えないよう 0.15 秒待ってから薄く出す
const fade = "animate-[skeleton-in_200ms_ease-out_150ms_both]";

function Block({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-md bg-subtle ${className}`} />;
}

function CardShape({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col gap-3 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 ${className}`}>
      <Block className="h-5 w-40" />
      {Array.from({ length: rows }, (_, i) => (
        <Block key={i} className={`h-4 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

// metrics: 上に数字の段がある画面（概要・分析・カレンダー・ロードマップ・短縮リンク）。
// columns: 2 列の画面（設計・相談・ネタ帳・設定など）。single: 1 列の画面（投稿をつくるなど、形が大きく違う画面）
export function PageSkeleton({ variant = "columns", label = "読み込んでいます" }: { variant?: "metrics" | "columns" | "single"; label?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col gap-5 max-sm:gap-4 ${fade}`}>
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex items-center justify-between gap-4">
        <Block className="h-8 w-48 max-sm:w-36" />
        <Block className="h-10 w-32 max-sm:hidden" />
      </div>
      {variant === "metrics" && (
        <div aria-hidden className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4">
              <Block className="h-4 w-24" />
              <Block className="h-9 w-20" />
            </div>
          ))}
        </div>
      )}
      {variant === "single" ? (
        <CardShape rows={6} />
      ) : (
        <div aria-hidden className="grid items-start gap-5 max-sm:gap-4 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5 max-sm:gap-4">
            <CardShape rows={5} />
            <CardShape rows={3} />
          </div>
          <div className="flex flex-col gap-5 max-sm:gap-4 max-xl:hidden">
            <CardShape rows={4} />
          </div>
        </div>
      )}
    </div>
  );
}
