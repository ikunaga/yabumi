// カレンダーの表示（週・月）。URL（?view=）で指定がないときは、最後に選んだ表示を cookie から読み、サーバーで最初からその表示を出す
// （localStorage だとサーバーで読めず、週の表示が一瞬出てから月に移っていた）。cookie に入れるのは表示の種類だけ
export type CalendarView = "week" | "month";

export const CALENDAR_VIEW_COOKIE = "yabumi_calendar_view";
const ONE_YEAR = 365 * 24 * 60 * 60;

export function parseCalendarView(value: unknown): CalendarView | null {
  return value === "week" || value === "month" ? value : null;
}

// URL の指定（view・week・month のどれか）があればそれに従い、なければ覚えた表示、それもなければ週
export function resolveCalendarView(params: Record<string, string | string[] | undefined>, stored: string | undefined): CalendarView {
  if (params.view === "month") return "month";
  if (["view", "week", "month"].some((k) => params[k] !== undefined)) return "week";
  return parseCalendarView(stored) ?? "week";
}

// 画面（ブラウザ）で document.cookie に入れる値。画面の表示を覚えるだけなので HttpOnly にはしない
export function calendarViewCookie(view: CalendarView, secure: boolean): string {
  return `${CALENDAR_VIEW_COOKIE}=${view}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
