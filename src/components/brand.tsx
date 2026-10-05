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
  const color = tone === "nav" ? "text-nav-strong" : "text-fg";
  const rtColor = tone === "nav" ? "text-nav-fg" : "text-muted";

  return (
    <Link href={href} className={`inline-flex items-end gap-1.5 hover:no-underline ${color}`} aria-label="矢書（やぶみ） トップへ">
      <ruby className={`font-heading leading-none font-bold ${text}`}>
        矢書<rt className={`${rt} ${rtColor}`}>やぶみ</rt>
      </ruby>
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
