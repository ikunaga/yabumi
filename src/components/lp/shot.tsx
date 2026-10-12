import Image from "next/image";

// 画面の見本（LP。docs/architecture.md の 4.29）。見本用のデータ（オーナーの実データは使わない）で撮った画面を、ライトとダークで出し分ける。
// 画像は public/lp/<name>-light.jpg と <name>-dark.jpg（README の「LP の画面の見本」の手順で撮る）。next/image が端末に合う大きさと形式（AVIF・WebP）に縮めて配る
export function Shot({ name, alt, priority = false, sizes = "(max-width: 1024px) 100vw, 640px" }: { name: string; alt: string; priority?: boolean; sizes?: string }) {
  const common = { width: 1492, height: 812, sizes, priority, className: "h-auto w-full" } as const;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <Image src={`/lp/${name}-light.jpg`} alt={alt} {...common} className={`${common.className} dark:hidden`} />
      <Image src={`/lp/${name}-dark.jpg`} alt={alt} {...common} className={`${common.className} hidden dark:block`} />
    </div>
  );
}
