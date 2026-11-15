// ログインしていなくても開けるパス（src/lib/supabase/proxy.ts が、ここにないパスを未ログインならログインへ送る）
// SNS からの通知（アンインストール・データ削除）、削除の確認ページ、定期実行のジョブ（合言葉で守る）は、ログインなしで届く
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/auth",
  "/sns/threads/uninstall",
  "/sns/threads/delete",
  "/sns/threads/deletion",
  "/sns/instagram/uninstall",
  "/sns/instagram/delete",
  "/sns/facebook/uninstall",
  "/sns/facebook/delete",
  "/sns/deletion",
  // TikTok の Webhook（外されたとき）と、TikTok が写真を取りに来る入口（ログインへ転送すると 3xx になり、TikTok が取れない。docs/design/tiktok.md の 2. と 12.）
  "/sns/tiktok/webhook",
  "/tiktok-media",
  "/api/jobs",
  // 短縮リンクの転送（4.22）。ふつうは src/proxy.ts がログインの確認より先に通すが、念のため
  "/go",
  // 利用規約とプライバシーポリシー（登録の前に読めるように。SNS 各社の審査でも、ログインなしで開けることが求められる）
  "/terms",
  "/privacy",
  // ほかのアプリからの「共有」（4.26）。受け取ったものをブラウザに控えてから、画面がログインへ送る（ログインのあとで続ける）
  "/share",
  // 招待の申し込みの取り消し（確認のメールのリンク。4.29）
  "/waitlist",
  // 伴走のお知らせのメールを止める（4.27）。メールのリンクから、ログインしなくても止められるように（合言葉で本人のものだけ）
  "/unsubscribe",
  "/api/unsubscribe",
];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}
