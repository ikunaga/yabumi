// 利用者のログインの cookie で動く route handler（POST）を、ほかのサイトから呼ばせない（CSRF）。
// server action は Next.js が呼び元を確かめるが、route handler は自分で確かめる。いまの cookie は SameSite=Lax で、ほかのサイトからの POST には付かないが、守りを二重にする。
// ① 中身は JSON だけ（ほかのサイトのフォームは JSON を送れず、fetch で送るとブラウザが前もって確かめて止める。req.json() は Content-Type を見ないので、ここで見る）
// ② 呼び元が同じサイト: Origin（なければ Referer）のホストがこのサイトと同じ。Sec-Fetch-Site があれば same-origin であること
// 使う route: /api/ai/tidy-draft、/api/push/renew。cookie を使わない POST（SNS からの知らせ・メールの配信停止・共有の受け口・ジョブ）には使わない
export function isSameOriginJson(req: Request): boolean {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const from = req.headers.get("origin") ?? req.headers.get("referer");
  if (!from) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}
