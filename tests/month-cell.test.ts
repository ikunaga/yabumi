// PC の月の表示の 1 日のマスに出す札の数（src/lib/calendar/month-cell.ts。docs/architecture.md の 4.39）
import { describe, expect, it } from "vitest";
import { MAX_CELL_LINES, monthCellLines } from "@/lib/calendar/month-cell";

const posts = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe("monthCellLines（月のマスの札）", () => {
  it("3 件までは全部出す", () => {
    expect(MAX_CELL_LINES).toBe(3);
    expect(monthCellLines([], posts(3), 3)).toEqual({ todos: [], items: posts(3), more: 0 });
  });

  it("4 件以上は 2 件と「ほか n 件」（マスの高さをそろえる）", () => {
    expect(monthCellLines([], posts(5), 5)).toEqual({ todos: [], items: posts(2), more: 3 });
  });

  it("やることも行に数える。やることを先に出す", () => {
    expect(monthCellLines(["t1"], posts(2), 2)).toEqual({ todos: ["t1"], items: posts(2), more: 0 });
    expect(monthCellLines(["t1"], posts(3), 3)).toEqual({ todos: ["t1"], items: posts(1), more: 2 });
    expect(monthCellLines(["t1", "t2", "t3", "t4"], posts(1), 1)).toEqual({ todos: ["t1", "t2"], items: [], more: 3 });
  });

  it("DB で数えた数が読んだ行より多いときは、その数で「ほか n 件」を出す", () => {
    expect(monthCellLines([], posts(2), 4)).toEqual({ todos: [], items: posts(2), more: 2 });
    expect(monthCellLines([], posts(3), 3)).toEqual({ todos: [], items: posts(3), more: 0 });
  });
});
