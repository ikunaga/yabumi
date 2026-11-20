// 伸びた投稿の判定（docs/design/winning-posts.md の 2.）: 同じ SNS の中央値と比べる・7 日たったものだけ・6 本そろうまで判定しない・
// 1.5 倍と下限・SNS ごとに 3 本まで・X は見ない・目標で見る数字を変える・自動の投稿の「いつ」の初期値
import { describe, expect, it } from "vitest";
import { suggestSchedules } from "@/lib/auto-post/suggest";
import { FLOOR, MAX_WINNERS, MIN_POSTS, hitText, judgeWinners, median, metricForGoal, winnerTime, winnersCardText, type TargetNumbers } from "@/lib/metrics/winners";
import type { SnsKey } from "@/lib/sns";

const NOW = new Date("2026-11-19T03:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
let seq = 0;
const row = (sns: SnsKey, views: number | null, opts: { days?: number; clicks?: number | null; postId?: string } = {}): TargetNumbers => {
  seq++;
  return { targetId: `t${seq}`, postId: opts.postId ?? `p${seq}`, sns, publishedAt: daysAgo(opts.days ?? 10), views, clicks: opts.clicks ?? null };
};
const many = (sns: SnsKey, values: number[], opts: { days?: number } = {}) => values.map((v) => row(sns, v, opts));

describe("中央値", () => {
  it("奇数はまん中、偶数はまん中の 2 つの平均。空は null", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("伸びた投稿の判定", () => {
  it("同じ SNS の中央値の 1.5 倍以上で、下限を超えたものを、倍率の大きい順に出す", () => {
    const rows = [...many("threads", [200, 200, 200, 200, 200]), row("threads", 500, { postId: "big" }), row("threads", 290, { postId: "small" })];
    const j = judgeWinners(rows, { metric: "views", now: NOW });
    expect(j.bySns).toEqual([{ sns: "threads", metric: "views", posts: 7, median: 200, need: 0 }]);
    expect(j.winners.map((w) => w.postId)).toEqual(["big"]);
    expect(j.winners[0].best).toEqual({ sns: "threads", metric: "views", value: 500, median: 200, ratio: 2.5 });
    expect(hitText(j.winners[0].best)).toBe("いつもの 2.5 倍見られました");
  });

  it(`SNS ごとに ${MIN_POSTS} 本そろうまでは判定せず、あと何本かを返す`, () => {
    const j = judgeWinners([...many("threads", [10, 10, 10, 10]), row("threads", 5000)], { metric: "views", now: NOW });
    expect(j.winners).toEqual([]);
    expect(j.bySns[0]).toMatchObject({ posts: 5, need: 1 });
  });

  it("送って 7 日たっていないもの・90 日より前のものは見ない", () => {
    const rows = [...many("threads", [200, 200, 200, 200, 200, 200]), row("threads", 5000, { days: 3, postId: "fresh" }), row("threads", 5000, { days: 120, postId: "old" })];
    const j = judgeWinners(rows, { metric: "views", now: NOW });
    expect(j.winners).toEqual([]);
    expect(j.bySns[0].posts).toBe(6);
  });

  it(`小さい数どうしの倍は出さない（見られた数は ${FLOOR.views} から）`, () => {
    const j = judgeWinners([...many("instagram", [10, 10, 10, 10, 10]), row("instagram", 90)], { metric: "views", now: NOW });
    expect(j.winners).toEqual([]);
  });

  it("X の数字は判定に使わない（X の規約で AI の会社に渡せるか確かめられないため）", () => {
    const j = judgeWinners([...many("x", [100, 100, 100, 100, 100]), row("x", 9000)], { metric: "views", now: NOW });
    expect(j.bySns).toEqual([]);
    expect(j.winners).toEqual([]);
  });

  it("SNS ごとに上から 3 本まで、全体で 5 本まで。1 つの投稿が 2 つの SNS で伸びたら 1 本にまとめ、倍率の大きい SNS を先にする", () => {
    const base = [...many("threads", [100, 100, 100, 100, 100, 100]), ...many("facebook", [100, 100, 100, 100, 100, 100])];
    const th = [400, 500, 600, 700].map((v, i) => row("threads", v, { postId: `th${i}` }));
    const fb = [row("facebook", 900, { postId: "th0" }), row("facebook", 300, { postId: "fb1" }), row("facebook", 350, { postId: "fb2" })];
    const j = judgeWinners([...base, ...th, ...fb], { metric: "views", now: NOW });
    expect(j.winners.length).toBe(MAX_WINNERS);
    const th0 = j.winners.find((w) => w.postId === "th0");
    // 400 は threads の上 3 本に入らないが、facebook で伸びたので出る
    expect(th0?.hits.map((h) => h.sns)).toEqual(["facebook"]);
    expect(j.winners.filter((w) => w.hits.some((h) => h.sns === "threads"))).toHaveLength(3);
  });

  it("押された数で見るのは、その SNS で短縮リンクのある投稿がそろっているときだけ。足りなければ見られた数で見る", () => {
    const withLinks = [5, 5, 5, 5, 5].map((c) => row("threads", 100, { clicks: c }));
    const j = judgeWinners([...withLinks, row("threads", 100, { clicks: 20, postId: "clicked" })], { metric: "clicks", now: NOW });
    expect(j.bySns[0].metric).toBe("clicks");
    expect(j.winners[0]).toMatchObject({ postId: "clicked", best: { metric: "clicks", ratio: 4 } });
    expect(hitText(j.winners[0].best)).toBe("いつもの 4 倍押されました");
    const few = judgeWinners([...many("threads", [100, 100, 100, 100, 100]), row("threads", 400, { clicks: 50 })], { metric: "clicks", now: NOW });
    expect(few.bySns[0].metric).toBe("views");
  });

  it("中央値が 0 でも 0 で割らない", () => {
    const j = judgeWinners([...many("threads", [0, 0, 0, 0, 0]), row("threads", 300, { postId: "a" })], { metric: "views", now: NOW });
    expect(j.winners[0].best.ratio).toBe(4.5);
  });

  it("目標で見る数字を変える（知ってもらう・フォロー・未設定は見られた数、それ以外は押された数）", () => {
    expect(metricForGoal("awareness")).toBe("views");
    expect(metricForGoal("follow")).toBe("views");
    expect(metricForGoal(null)).toBe("views");
    expect(metricForGoal("download")).toBe("clicks");
    expect(metricForGoal("booking")).toBe("clicks");
  });
});

describe("自動の投稿の「何を」のカードと「いつ」", () => {
  const label = (s: SnsKey) => ({ threads: "Threads" })[s as "threads"] ?? s;
  it("伸びた投稿があればその 1 行、なければあと何本か", () => {
    const j = judgeWinners([...many("threads", [200, 200, 200, 200, 200]), row("threads", 500)], { metric: "views", now: NOW });
    expect(winnersCardText(j, label)).toEqual({ text: "Threads でいつもの 2.5 倍見られた投稿があります", off: false });
    expect(winnersCardText({ bySns: [{ sns: "threads", metric: "views", posts: 2, median: 1, need: 4 }], winners: [] }, label)).toEqual({ text: "Threads にあと 4 本送ると、伸びた投稿がわかります", off: true });
    expect(winnersCardText({ bySns: [], winners: [] }, label)?.off).toBe(true);
  });

  it("伸びた投稿を送った時間帯（日本時間）の時刻にする", () => {
    expect(winnerTime("2026-11-10T10:30:00Z").time).toBe("18:00"); // 日本時間 19:30 は夕（16〜20 時）
    expect(winnerTime("2026-11-10T23:30:00Z").time).toBe("08:00"); // 日本時間 8:30 は朝
  });

  it("伸びた投稿から始めたときは、週 2・週 1 を先に出し、時刻を伸びた時間帯にする", () => {
    const s = suggestSchedules({
      kind: "series",
      materials: { unusedNotes: 0, unusedPhotoNotes: 0, seriesFormats: 1, destinations: 0 },
      targets: ["threads"],
      trends: null,
      planFrequency: "毎日",
      start: "2026-11-19",
      fromWinner: { time: "08:00", reason: "伸びた投稿を送った時間帯（朝・5〜11 時）にします" },
    });
    expect(s.map((x) => x.perWeek).slice(0, 2)).toEqual([2, 1]);
    expect(s[0].schedule.time).toBe("08:00");
    expect(s[0].timeReason).toContain("伸びた投稿");
    expect(s.some((x) => x.fromPlan)).toBe(false);
  });
});
