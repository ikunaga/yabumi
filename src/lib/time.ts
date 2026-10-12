// 日時の扱い。いまは日本の利用者を前提に、表示と入力をすべて日本時間で行う
export const TIME_ZONE = "Asia/Tokyo";
const OFFSET = "+09:00";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function parts(date: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute };
}

// 日本時間の "YYYY-MM-DD"
export function toYmd(date: Date): string {
  const p = parts(date);
  return `${p.y}-${p.m}-${p.d}`;
}

// datetime-local の値（日本時間の "YYYY-MM-DDTHH:mm"）
export function toInputValue(iso: string | null): string {
  if (!iso) return "";
  const p = parts(new Date(iso));
  return `${p.y}-${p.m}-${p.d}T${p.hh}:${p.mm}`;
}

// datetime-local の値を日本時間として ISO 文字列にする。読めなければ null
export function fromInputValue(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00${OFFSET}`).getTime());
}

// "YYYY-MM-DD"（日本時間）の 0 時を表す Date
export function startOfYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00${OFFSET}`);
}

export function addDays(ymd: string, days: number): string {
  const d = startOfYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

export function weekdayOf(ymd: string): number {
  // 日本時間の 0 時は UTC の前日 15 時なので、正午で曜日を取る
  return new Date(`${ymd}T12:00:00${OFFSET}`).getUTCDay();
}

// その日を含む週（月曜はじまり）の 7 日
export function weekOf(ymd: string): string[] {
  const monday = addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function weekdayLabel(ymd: string): string {
  return WEEKDAYS[weekdayOf(ymd)];
}

export function dayOfMonth(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

export function monthOf(ymd: string): number {
  return Number(ymd.slice(5, 7));
}

// "10/14 20:00"
export function formatShort(iso: string): string {
  const p = parts(new Date(iso));
  return `${Number(p.m)}/${Number(p.d)} ${p.hh}:${p.mm}`;
}

// "20:00"
export function formatTime(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.hh}:${p.mm}`;
}

// 日本時間の年月 "YYYY-MM"
export function isYm(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function ymOf(ymd: string): string {
  return ymd.slice(0, 7);
}

export function addMonths(ym: string, months: number): string {
  const total = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + months;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// 月の表示のマス: その月の 1 日を含む週の月曜から 6 週（42 日）。週の表示と同じ月曜はじまり。
// 6 週あれば、どの月も（31 日で 1 日が日曜でも）収まる。前後の月の日も入る
export function monthGrid(ym: string): string[] {
  const start = weekOf(`${ym}-01`)[0];
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
