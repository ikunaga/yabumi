// 利用規約とプライバシーポリシーに出す運営者の情報（docs/legal.md の「オーナーに確かめてほしい点」）。
// オーナーが決めたら値を入れ、draft を false にする。draft の間は、両方のページの先頭に「確認中の下書き」と出す
export const LEGAL = {
  draft: true,
  // 運営者の表示。屋号（2026-10-11 オーナーが決定。表記はこのとおり）と、代表者の氏名（確認中）
  operator: "YuXport Labs" as string | null,
  representative: null as string | null,
  // 問い合わせ先。support@yabumi.app（Cloudflare Email Routing）に届くのを確かめてから入れる（deploy.md の 11 の G-4）
  contact: null as string | null,
  // 施行日（例: "2026年11月1日"）
  effectiveDate: null as string | null,
  // 裁判の管轄（例: "東京地方裁判所"）
  court: null as string | null,
  // 登録できる年齢（例: 18 歳以上。未成年は保護者の同意つき、など）
  minAge: 18,
} as const;

export const PENDING = "（確認中）";

export function orPending(value: string | null): string {
  return value ?? PENDING;
}

// 「YuXport Labs（代表 山田太郎）」の形。決まっていないところは「（確認中）」
export function operatorLabel(): string {
  return `${orPending(LEGAL.operator)}（代表 ${orPending(LEGAL.representative)}）`;
}
