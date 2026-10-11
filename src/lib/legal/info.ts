// 利用規約とプライバシーポリシーに出す運営者の情報（docs/legal.md の「オーナーに確かめてほしい点」）。
// 2026-10-11 にオーナーが代表者・問い合わせ先・管轄・年齢を決めた。施行日だけは、登録の受付を開く日に決めて入れる。
// 施行日が決まるまでは、両方のページの先頭に「施行日は未定」の知らせを出す
export const LEGAL = {
  // 運営者の表示。屋号と代表者（表記はこのとおり）
  operator: "YuXport Labs" as string | null,
  representative: "生長 真尚" as string | null,
  // 問い合わせ先（運営者が受け取るアドレス。2026-10-11 オーナーが決定）
  contact: "contact@yuxport.com" as string | null,
  // 施行日（例: "2026年11月1日"）。登録の受付を開く日に決める
  effectiveDate: null as string | null,
  // 第一審の専属的合意管轄裁判所
  court: "東京地方裁判所" as string | null,
  // 登録できる年齢（生年月日は聞かず、規約と登録の画面の同意で確かめる）
  minAge: 18,
} as const;

export const PENDING = "（確認中）";

export function orPending(value: string | null): string {
  return value ?? PENDING;
}

// 「YuXport Labs（代表 生長 真尚）」の形。決まっていないところは「（確認中）」
export function operatorLabel(): string {
  return `${orPending(LEGAL.operator)}（代表 ${orPending(LEGAL.representative)}）`;
}
