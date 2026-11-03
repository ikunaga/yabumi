// PC の月の表示の 1 日のマスに出すもの（docs/architecture.md の 4.39）。マスの高さをそろえるため、やることと投稿の札は合わせて MAX_CELL_LINES 行まで。
// 入りきらない日は 1 行減らして「ほか n 件」にし、押すとその日の週の表示へ。やることを先に、投稿は時刻の順
export const MAX_CELL_LINES = 3;

export function monthCellLines<T, I>(todos: T[], items: I[], count: number, max = MAX_CELL_LINES): { todos: T[]; items: I[]; more: number } {
  // count は DB で数えた投稿の数（読んだ行より多いことがある）
  const total = todos.length + Math.max(count, items.length);
  const room = total > max ? max - 1 : max;
  const shownTodos = todos.slice(0, room);
  const shownItems = items.slice(0, room - shownTodos.length);
  return { todos: shownTodos, items: shownItems, more: total - shownTodos.length - shownItems.length };
}
