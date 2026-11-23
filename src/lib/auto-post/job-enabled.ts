// 自動投稿のジョブが止まっているときの帯（2026-11-23 オーナーの了承）。
// ジョブは環境変数 AUTO_POST_ENABLED が "true" のときだけ動く（src/app/api/jobs/auto-post/route.ts と同じ決まり）。
// 止まっている間は、作る前の回（自動でつくって送る投稿）が時刻を過ぎても投稿されないので、カレンダーと自動投稿の画面に帯を出す。
// 運営者がその人を止めている（held）ときは、止めた帯だけを出す（2 つ重ねない）
export function showAutoPostStopped(opts: { enabledEnv: string | undefined; hasPlanned: boolean; held?: boolean }): boolean {
  return opts.enabledEnv !== "true" && opts.hasPlanned && !opts.held;
}
