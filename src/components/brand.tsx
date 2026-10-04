import Link from "next/link";

// ロゴ。「矢書」には必ず「やぶみ」のふりがなを振る
export function Brand({
  href = "/",
  tone = "default",
  size = "md",
  withMark = false,
}: {
  href?: string;
  tone?: "default" | "nav";
  size?: "sm" | "md" | "lg";
  withMark?: boolean;
}) {
  const text = { sm: "text-[19px]", md: "text-[22px]", lg: "text-[24px]" }[size];
  const rt = size === "sm" ? "text-[8px]" : "text-[9px]";
  const color = tone === "nav" ? "text-nav-strong" : "text-fg";
  const rtColor = tone === "nav" ? "text-nav-fg" : "text-muted";

  return (
    <Link href={href} className={`inline-flex items-center gap-3 hover:no-underline ${color}`} aria-label="矢書（やぶみ） トップへ">
      {withMark && (
        <span
          aria-hidden
          className="flex size-7 items-center justify-center border-2 border-primary font-heading text-base leading-none font-bold text-primary"
        >
          矢
        </span>
      )}
      <ruby className={`font-heading leading-none font-bold ${text}`}>
        矢書<rt className={`${rt} ${rtColor}`}>やぶみ</rt>
      </ruby>
    </Link>
  );
}
