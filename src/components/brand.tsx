import Link from "next/link";

// ロゴ。「矢書」には必ず「やぶみ」のふりがなを振り、右下に朱の角印「文」を添える（docs/design/logo/README.md）。
// 画像のロゴは背景（生成り）が焼き込まれていてダークで浮くので、画面では文字を組み、角印はトークンの色で描く
export function Brand({
  href = "/",
  tone = "default",
  size = "md",
}: {
  href?: string;
  tone?: "default" | "nav";
  size?: "sm" | "md" | "lg";
}) {
  const text = { sm: "text-[19px]", md: "text-[22px]", lg: "text-[24px]" }[size];
  const rt = size === "sm" ? "text-[8px]" : "text-[9px]";
  // 漢字（Zen Kaku Gothic、行の高さ 1）は箱の中央より下に描かれ、隣のメニューの字（ヒラギノ、行の高さ 1.5）は中央より上に描かれる。
  // 中央揃えで並べると漢字が 2〜3px 沈んで見えるので、字の 0.11 倍ほど上げて字面の中央どうしを合わせる（画素で測って決めた）
  const nudge = { sm: "-top-[2px]", md: "-top-[2.5px]", lg: "-top-[2.75px]" }[size];
  const color = tone === "nav" ? "text-nav-strong" : "text-fg";
  const rtColor = tone === "nav" ? "text-nav-fg" : "text-muted";

  return (
    <Link href={href} className={`relative inline-flex items-end gap-1.5 hover:no-underline ${nudge} ${color}`} aria-label="矢書（やぶみ） トップへ">
      {/* ふりがなは漢字の上に浮かせ、ロゴの箱の高さは漢字だけにする。隣のメニューと揃えるのは漢字なので、
          ふりがなまで箱に入れると、ロゴの中央が漢字より上にずれ、メニューの文字が浮いて見える */}
      <span className={`relative font-heading leading-none font-bold ${text}`}>
        矢書
        <span aria-hidden className={`absolute inset-x-0 bottom-full flex justify-around leading-none whitespace-nowrap ${rt} ${rtColor}`}>
          {[..."やぶみ"].map((c) => (
            <span key={c}>{c}</span>
          ))}
        </span>
      </span>
      <Seal size={size} />
    </Link>
  );
}

// 朱の角印「文」。印なので朱（signal）を使ってよい（ボタンには使わない）。
// 字は地の色（surface）で抜くので、ダークでは明るい朱に暗い字になり、どちらでも読める
export function Seal({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box = { sm: "size-[13px] text-[10px]", md: "size-[15px] text-[11px]", lg: "size-4 text-xs" }[size];
  return (
    <span aria-hidden className={`mb-px inline-flex shrink-0 items-center justify-center rounded-[2px] bg-signal font-mincho leading-none font-semibold text-surface ${box}`}>
      文
    </span>
  );
}
