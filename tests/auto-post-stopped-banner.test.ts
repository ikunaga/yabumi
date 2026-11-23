// 自動投稿のジョブが止まっているときの帯（2026-11-23 オーナーの了承）。出すのは、ジョブが止まっていて、作る前の回（自動でつくって送る投稿）があり、運営者が止めていないときだけ
import { describe, expect, it } from "vitest";
import { showAutoPostStopped } from "@/lib/auto-post/job-enabled";

describe("自動投稿が止まっている帯", () => {
  it("AUTO_POST_ENABLED が true なら出さない", () => {
    expect(showAutoPostStopped({ enabledEnv: "true", hasPlanned: true })).toBe(false);
  });
  it("入っていない・true 以外で、自動でつくって送る投稿があれば出す", () => {
    expect(showAutoPostStopped({ enabledEnv: undefined, hasPlanned: true })).toBe(true);
    expect(showAutoPostStopped({ enabledEnv: "false", hasPlanned: true })).toBe(true);
    expect(showAutoPostStopped({ enabledEnv: "TRUE", hasPlanned: true })).toBe(true);
  });
  it("自動でつくって送る投稿がなければ出さない", () => {
    expect(showAutoPostStopped({ enabledEnv: undefined, hasPlanned: false })).toBe(false);
  });
  it("運営者が止めているときは、止めた帯だけにする（2 つ重ねない）", () => {
    expect(showAutoPostStopped({ enabledEnv: undefined, hasPlanned: true, held: true })).toBe(false);
  });
});
