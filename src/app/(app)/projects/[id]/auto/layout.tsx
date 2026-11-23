import { AutoPostHoldBanner } from "@/components/auto-post/hold-banner";
import { AutoPostStoppedBanner } from "@/components/auto-post/stopped-banner";
import { showAutoPostStopped } from "@/lib/auto-post/job-enabled";
import { getAutoPostHold, listUpcomingAutoRuns } from "@/lib/auto-post/queries";

const DAY_MS = 86_400_000;

// 自動の投稿の画面の共通の枠。運営者が止めているときは、どの画面にも上に帯を出す（docs/design/auto-post.md の「運営者が止める」）。
// 自動投稿のジョブが止まっていて、作る前の回（自動でつくって送る投稿）があるときも、上に帯を出す（2026-11-23 オーナーの了承。カレンダーと同じ帯）
export default async function AutoLayout(props: LayoutProps<"/projects/[id]/auto">) {
  const [{ id }, hold] = await Promise.all([props.params, getAutoPostHold()]);
  // 止めた帯が出るとき・ジョブが動いているときは、自動の回を読まない
  const stopped = !hold && process.env.AUTO_POST_ENABLED !== "true" && showAutoPostStopped({ enabledEnv: process.env.AUTO_POST_ENABLED, hasPlanned: await hasPlannedRuns(id) });
  if (!hold && !stopped) return props.children;
  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      {hold ? <AutoPostHoldBanner heldAt={hold.heldAt} /> : <AutoPostStoppedBanner />}
      {props.children}
    </div>
  );
}

// これから 30 日に、まだ作っていない自動の回があるか（自動投稿の一覧の「これからの投稿」と同じ範囲）。読めなければ帯は出さない
async function hasPlannedRuns(projectId: string): Promise<boolean> {
  const now = new Date();
  const runs = await listUpcomingAutoRuns(projectId, now, new Date(now.getTime() + 30 * DAY_MS)).catch(() => []);
  return runs.some((r) => r.postId === null && (r.status === "waiting" || r.status === "generating"));
}
