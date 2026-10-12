// 「規約の変更のお知らせ」の帯を閉じた版（決定 D31。docs/architecture.md の 4.30）。中身は版（施行日の ISO）だけ。1 年
export const LEGAL_NOTICE_COOKIE = "yabumi_legal_notice_seen";

export function legalNoticeCookie(version: string, secure: boolean): string {
  return `${LEGAL_NOTICE_COOKIE}=${version}; Path=/; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
