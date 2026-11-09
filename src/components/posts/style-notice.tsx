// AI の下書きに、直させても残った「日本語の決まりに反する言い回し」（src/lib/ai/japanese-style.ts）。送る前に自分で直せるように知らせる
export function StyleNotice({ style }: { style?: string[] }) {
  if (!style?.length) return null;
  return (
    <p className="text-[13px] leading-[1.7] text-muted">
      <span className="font-semibold text-fg">AI っぽい言い回しが残っています:</span> {style.join("・")}
    </p>
  );
}
