// 段取りの印（「1 材料 › 2 中身 › 3 ネタ」）。いまいるステップを黒で示し、行けるステップは押して移れる
export function Steps<K extends string | number>({
  steps,
  current,
  canGo,
  onGo,
  label,
}: {
  steps: { key: K; label: string }[];
  current: K;
  canGo: (key: K) => boolean;
  onGo: (key: K) => void;
  label: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {steps.map((s, i) => {
          const on = s.key === current;
          const go = !on && canGo(s.key);
          const body = (
            <>
              <span
                className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${on ? "bg-primary text-on-primary" : "border border-border text-muted"}`}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className={on ? "font-bold text-fg" : "text-muted"}>{s.label}</span>
            </>
          );
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-muted" aria-hidden="true">
                  ›
                </span>
              )}
              {go ? (
                <button type="button" onClick={() => onGo(s.key)} className="flex items-center gap-1.5 rounded-md px-1 py-1 hover:underline">
                  {body}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 px-1 py-1" aria-current={on ? "step" : undefined}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
