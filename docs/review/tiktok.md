# TikTok の審査（監査）の準備

- **作成日**: 2026-10-11
- **いまの状態**: 未接続（フェーズ 5 の画像・動画と一緒に作る）。ここは「つなぐ機能を作るときに慌てないため」の整理
- 出典: [Content Posting API の始め方](https://developers.tiktok.com/doc/content-posting-api-get-started)、[コンテンツ共有のガイドライン](https://developers.tiktok.com/doc/content-sharing-guidelines)、[アプリ審査のガイドライン](https://developers.tiktok.com/doc/app-review-guidelines)、[スコープ](https://developers.tiktok.com/doc/tiktok-api-scopes)、[Login Kit（Web）](https://developers.tiktok.com/doc/login-kit-web)

## 監査の前と後

| | 監査の前 | 監査の後 |
|---|---|---|
| 投稿の公開範囲 | 自分だけ（SELF_ONLY）に限られる。投稿するアカウントも非公開である必要がある（Direct Post の資料: "Unaudited clients can only post to a private account."） | 利用者が選んだ範囲 |
| 使える人数 | 24 時間で 5 人まで | 制限なし（1 アカウント 1 日 約 15 本の上限は、監査の有無にかかわらず、他のアプリとの合計） |

- 申請: https://developers.tiktok.com/application/content-posting-api
- 認められない例: 他の SNS の中身を TikTok へ機械的に複製するだけのアプリ、自分やチームのアカウントにだけ上げる道具。矢書は「利用者が TikTok 向けに作り、確かめてから送る」形にする
- 予約投稿（同意した時点と、実際に送る時刻が違う）を認めるかは【未確認】（2026-10-11 にもう一度、コンテンツ共有のガイドラインと Direct Post の資料を見たが、書かれていない）。「投稿の画面を出すときに最新の creator_info を読む」「同意のあとでだけ送る」の決まりがあるので、作る前に TikTok の開発者サポートに確かめる。それまでは、予約は下書き（Upload）で送る（architecture.md の 4.24）

## 下書き（Upload）と直接投稿（Direct Post）（2026-10-11）

| | 下書き（video.upload、/v2/post/publish/inbox/video/init/） | 直接投稿（video.publish、/v2/post/publish/video/init/） |
|---|---|---|
| 送ったあと | 利用者が TikTok のアプリの受信箱の通知を押し、アプリで仕上げて投稿する | そのまま投稿される（監査の前は「自分だけ」） |
| 上限 | 未完了のものは 24 時間で 5 件まで（spam_risk_too_many_pending_share） | 投稿は 1 アカウント 1 日 約 15 本（全部のアプリの合計） |
| 矢書での使い方（おすすめ） | 最初はこれだけ。予約もこれで送る | 監査のあと、まず「今すぐ送る」で |

- 動画の渡し方: FILE_UPLOAD（矢書のサーバーが 5〜64MB ずつ送る）を使う。PULL_FROM_URL は、URL のドメインか URL の前半の所有確認が要り（3xx を返す URL は不可）、Supabase の URL（xxx.supabase.co）は矢書のドメインではないので使えない
- init はトークン 1 つで 1 分 6 回まで。状態の確かめ（status/fetch）は 1 分 30 回まで、Webhook もある
- トークン: アクセス 24 時間、リフレッシュ 365 日。Web の Login Kit は state が必須、PKCE は必須ではない

## 申請に要るもの

| 項目 | 中身 | 矢書の状態 |
|---|---|---|
| アプリの名前 | 独自の名前。「TikTok」を含めない | Yabumi |
| アイコン | はっきりした画像。他社のブランドに似せない | docs/design/logo/icons/ios/AppIcon-1024.png |
| Web サイト | 外から開ける、完成した公式サイト（ログインの画面だけは不可）。利用規約とプライバシーポリシーへのリンクが、メニューを開かなくても見える | トップ（/）に説明とフッターのリンクがある。済み |
| URL の所有確認 | 2024-09-09 以降に作ったアプリは、利用規約・プライバシーポリシー・Web の URL の所有を確かめる（DNS に署名を入れるか、ファイルを置く） | yabumi.app で行う（README の R1）。DNS に署名を入れる方法（Cloudflare の DNS）か、ファイルを public/ に置く方法 |
| リダイレクト URI | https の絶対 URL、クエリと # は不可 | `/sns/tiktok/callback` を作る |
| デモ動画 | 1〜5 本、各 50MB 以下。最初の審査はサンドボックスで撮る。全体の流れと、申請したスコープをすべて見せる。動画に映るドメインと申請の URL を揃える | つなぐ機能ができてから |
| スコープ | user.info.basic（プロフィール）、video.publish（直接投稿）。下書きとして送るだけなら video.upload | 使わないスコープは外す（外さないと審査が遅れる） |

## 投稿の画面の決まり（Direct Post。監査で確かめられる）

作るときにそのまま守る。

1. 投稿の画面を開くたびに creator_info を読み、TikTok のニックネームを出す。投稿できない状態なら止めて知らせる。動画の長さを max_video_post_duration_sec と比べる
2. タイトルは利用者が直せる。矢書が入れたハッシュタグなども直せる
3. 公開範囲は privacy_level_options から**利用者が選ぶ**。最初から選んだ状態にしない
4. コメント・Duet・Stitch は最初はすべてオフ。クリエイターが無効にしているものは押せない状態にする。写真はコメントだけ
5. 「商業的な内容の開示」のスイッチは最初はオフ。オンにしたら「自分のブランド（Your brand）」「ブランドコンテンツ（Branded content）」の少なくとも一方を選ばないと投稿できない。表示の文言は「Promotional content」「Paid partnership」。ブランドコンテンツは「自分だけ」にできない
6. 投稿のボタンの前に同意の文を出し、TikTok の公式のページにリンクする: 「By posting, you agree to TikTok's Music Usage Confirmation」（ブランドコンテンツを含むときは「By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.」）
7. プレビューを出す。矢書の透かしやロゴを付けない
8. 投稿のあと「反映まで数分かかる」と出し、状態を確かめる（status fetch か Webhook）

## オーナーの作業（つなぐ機能を作るとき）

1. developers.tiktok.com でアプリを作る（Login Kit と Content Posting API を足す）
2. URL の所有確認（yabumi.app）
3. サンドボックスで、テストのアカウントを登録して動かす
4. デモ動画を撮って監査を申請する
