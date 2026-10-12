// 招待の申し込み（F19、決定 D30。docs/architecture.md の 4.29）の決まり。画面とサーバーの両方から読む

export const MAX_NOTE_CHARS = 200;
// 同じ端末（IP アドレス）からの申し込みは 1 時間に 3 回まで
export const PER_IP_PER_HOUR = 3;
// 全員を合わせて 1 時間に 30 件まで（ロボットにまとめて入れられても、確認のメールを大量に送らない）
export const ALL_PER_HOUR = 30;

// メールアドレスの形を大まかに確かめ、小文字にそろえる（形が違えば null）
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  // ローカル部@ドメイン（ドメインに点が 1 つ以上）。空白や山かっこは入れない
  if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) return null;
  return email;
}

export function cleanNote(raw: string): string {
  return Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, MAX_NOTE_CHARS).join("");
}
