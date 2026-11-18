import { AutoPostHoldBanner } from "@/components/auto-post/hold-banner";
import { getAutoPostHold } from "@/lib/auto-post/queries";

// 自動の投稿の画面の共通の枠。運営者が止めているときは、どの画面にも上に帯を出す（docs/design/auto-post.md の「運営者が止める」）
export default async function AutoLayout(props: LayoutProps<"/projects/[id]/auto">) {
  const hold = await getAutoPostHold();
  if (!hold) return props.children;
  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <AutoPostHoldBanner heldAt={hold.heldAt} />
      {props.children}
    </div>
  );
}
