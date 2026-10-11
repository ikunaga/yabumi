# Meta（Threads、後で Instagram・Facebook）の審査の準備

- **作成日**: 2026-10-11
- **対象のアプリ**: Yabumi Dev（Threads 専用。architecture.md の 4.6）。Instagram・Facebook 用のアプリは未作成
- **いまの状態**: 開発モード。Threads Tester に登録したアカウント（オーナーの @masa_i82）だけがつなげる

## 他の人がつなげるようになるまで

| # | 何を | どこで | 要るもの | 期間 |
|---|---|---|---|---|
| 1 | ビジネスポートフォリオを作り、アプリをそこに入れる | Meta Business Suite（business.facebook.com）→ 設定 → ビジネスポートフォリオ。アプリのダッシュボード → App settings → Basic → 「Business portfolio」で紐づけ | ― | すぐ |
| 2 | **ビジネス認証**（Business Verification） | ビジネス設定 → セキュリティセンター →「認証を開始」。管理者だけができる | 事業者名・住所・電話・Web サイト（独自ドメインが望ましい）と、それが書かれた書類（下） | 数日（公式の目安は未確認） |
| 3 | アプリの基本設定を埋める | App settings → Basic（下の「基本設定」） | プライバシーポリシーの URL、アイコン、カテゴリ、連絡先メール、データ削除の URL | すぐ |
| 4 | 各権限で API を 1 回以上呼んでおく | 本番の矢書で、テスターのアカウントでつないで投稿・削除する | 申請の **30 日以内**に、申請する権限ごとに成功した呼び出しが要る | ― |
| 5 | **App Review** に出す | App Review → Requests → 権限を選んで「Request」 | 権限ごとの説明文と画面の録画（下）、審査の担当者用のアカウント | 1 週間ほど（公式）。却下されたら直して出し直す |
| 6 | データの扱いの質問に答える（Data Handling Questions） | App Review の提出の中、またはダッシュボードの案内 | 下の「データの扱いの答え」 | その場で判定（最大 30 秒） |
| 7 | **Tech Provider 認証**（Access Verification） | App settings → Basic → Verifications → Access verification | 矢書がどんなサービスか、他の人のデータをどう使うかの説明（下） | 約 5 日 |
| 8 | アプリを **Live** にする | 左のメニューの「Publish」（Threads の新しい画面） | 1〜7 が済んでいること。Data Use Checkup（年 1 回）も済ませる | すぐ |

- 7 は、アプリの役割を持たない人が threads_basic・threads_content_publish・threads_manage_insights を使うときに要る（済んでいないと、エラーコード 100 で断られる）。threads_delete は一覧にない
- Live にすると、開発モードのときのテストの投稿も公開のものとして扱われる。テストの投稿は Live の前に消しておく
- 出典: [Threads の始め方](https://developers.facebook.com/docs/threads/get-started)、[権限の一覧](https://developers.facebook.com/docs/permissions)、[App Review の出し方](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)、[ビジネス認証](https://developers.facebook.com/docs/development/release/business-verification)、[Access Verification](https://developers.facebook.com/docs/development/release/access-verification/)、[アプリのモード](https://developers.facebook.com/docs/development/build-and-test/app-modes)、[Data Use Checkup](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/data-use-checkup)

## 先に決めること: threads_manage_insights を申請するか

矢書はいま、threads_manage_insights（投稿の閲覧数などを読む権限）を求めているが、**使っていない**（指標 F07 はフェーズ 3）。Meta は「要らない権限の申請」を却下の理由に挙げており、手順 4 の「30 日以内に呼んだ実績」も作れない。

| 案 | 中身 | 長所 | 短所 |
|---|---|---|---|
| A（おすすめ） | いまは申請しない。矢書が求める権限からも外す（src/lib/sns/threads/api.ts の THREADS_SCOPES）。指標を作るときに足して、その権限だけ追加で審査に出す | 審査が通りやすく、早い。利用者に「使わない権限」を求めない | 指標を作ったとき、利用者に「つなぎ直す」をしてもらう必要がある |
| B | 先に指標の一部（投稿ごとの閲覧数）を作ってから、4 つまとめて申請する | つなぎ直しが要らない | 審査が指標の完成まで遅れる |

## ビジネス認証に出す書類（日本）

公式のヘルプは画面が JavaScript で、内容を確かめられなかった（【未確認】）。第三者のまとめ（[Wati](https://support.wati.io/en/articles/11463208-meta-business-verification-required-documents-by-country)）では、日本で通る書類は次のとおり。

- 法人: 履歴事項全部証明書、法人番号指定通知書、定款
- 個人事業主: **個人事業の開業・廃業等届出書（開業届）の控え**、営業許可、納税証明書
- 住所の確認: 公共料金の請求書、事業用の銀行の明細

注意:

- 書類の名前・住所と、ビジネスポートフォリオに入れた名前・住所を一字一句そろえる
- 本人確認書類（免許証やパスポート）だけでは通らないとされる
- 開業届を出していない個人が通るかは【未確認】（通らない可能性が高い）。docs/review/README.md の R2

## 基本設定（App settings → Basic）

| 欄 | 入れる値 |
|---|---|
| Display name | Yabumi（審査の前に、名前に「Dev」を含まないアプリ名にする。名前を変えると審査の出し直しになることがあるので、申請の前に決める） |
| App icon | docs/design/logo/icons/ios/AppIcon-1024.png（1024×1024、PNG、5MB 未満。Meta のロゴを含めない） |
| Privacy Policy URL | `https://<本番のドメイン>/privacy` |
| Terms of Service URL | `https://<本番のドメイン>/terms`（必須かは【未確認】だが入れる） |
| User data deletion | 「Data deletion callback URL」を選び、`https://<本番のドメイン>/sns/threads/delete`（作り済み。署名を確かめ、Threads のアカウントの情報とトークンを消し、確認ページ /sns/threads/deletion の URL と確認コードを返す） |
| Category | Productivity（または Business and Pages） |
| Contact email | オーナーの連絡先（審査の結果が届く） |
| App purpose | Clients（他の人が使うアプリ） |

Threads の Use cases → Settings の Uninstall Callback URL は `https://<本番のドメイン>/sns/threads/uninstall`、Delete Callback URL は上と同じ（deploy.md の 6-1）。

## 権限ごとの説明文（英語。申請の欄にそのまま貼る）

権限ごとに別の文にする（Meta は同じ文の使い回しを嫌う）。

### threads_basic

> Yabumi is a social media scheduling tool for indie app developers. After a user connects their Threads account via Threads Login, we use threads_basic to read the user's Threads user ID and username. We show "✓ @username" on the user's project overview so they can confirm which Threads account their posts will be published to, and we store the user ID to link scheduled posts to the right account. We do not read any other profile data.

### threads_content_publish

> Users write a post in Yabumi, review the Threads preview (character count and the exact text), and then either click "Send now" or schedule it for a date and time. Only when the user clicks one of these buttons do we use threads_content_publish to create a text post on the user's own Threads account (create a media container, then publish it). After publishing, we show a "View on Threads" link with the permalink so the user can see the result. We never post anything the user did not write or approve, and we never post to accounts other than the one the user connected.

### threads_delete

> On each published post's page, Yabumi shows a "Delete from Threads" button. When the user clicks it and confirms, we use threads_delete to delete that post from the user's Threads account, and we mark the post as deleted in Yabumi. This lets users quickly remove a test post or a post with a mistake without leaving Yabumi. We only delete posts that were published through Yabumi by that same user.

### threads_manage_insights（案 B を選んだときだけ）

> （指標の画面ができてから書く。どの画面で、どの数字を、何のために見せるかを書く）

## 画面の録画（権限ごとに 1 本）

共通の決まり: 1080p 以上、音声なし、マウスで操作、英語の字幕か注釈を付ける（画面は日本語なので、各操作に「Click "Connect" (つなぐ)」のような注釈）。最初に、ブラウザのアドレスバーで本番の URL が見えるようにする。

| 権限 | 録画の流れ |
|---|---|
| threads_basic | ① 審査用のアカウントで矢書にログイン ② プロジェクトの概要の「つないだ SNS」→ Threads の「つなぐ」③ Threads の認可画面（求める権限が並ぶ）で許可 ④ 矢書に戻り「✓ @ユーザー名」が出る |
| threads_content_publish | ① ログイン済み、Threads はつないだ状態から ②「投稿をつくる」で本文を入れ、送り先に Threads を選ぶ ③ Threads のプレビュー（文字数）を見せる ④「今すぐ送る」⑤ 送信の結果の「Threads で見る」を押し、Threads で投稿が出ていることを見せる ⑥ 予約も見せる: 数分後に予約 → カレンダーに出る → 時刻が来て「✓ 送信済み」 |
| threads_delete | ① 送信済みの投稿の画面 ②「Threads から取り消す」→ 確認 ③ 送信の結果が取り消しに変わる ④ Threads で投稿が消えたことを見せる |

## 審査の担当者向けの説明（Reviewer instructions に貼る）

> 1. Open https://<production-domain>/login and sign in with the test account below (Yabumi account, not a Meta account).
> 2. Open the sample project "Sample App". In "Connected SNS" (つないだ SNS), click "Connect" (つなぐ) on the Threads row and authorize with your Threads test account.
> 3. Click "Create post" (投稿をつくる), enter any text, select Threads, and click "Send now" (今すぐ送る). Click "View on Threads" (Threads で見る) to see the post.
> 4. On the same page, click "Delete from Threads" (Threads から取り消す) to delete it.
> The UI is in Japanese; the English labels above are shown in parentheses in the screencasts.
>
> Test account: email ______ / password ______

- テスト用のアカウントは、審査のためだけに作る（deploy.md の 5-3 の手順で、本番に作る）。オーナー個人の Meta アカウントの情報は書かない
- 審査の担当者が矢書にログインできないと、提出全体が却下される

## データの扱いの答え（Data Handling Questions の下書き）

| 質問の趣旨 | 答え |
|---|---|
| データを処理する他社（委託先）はあるか | ある: Supabase（DB、東京）、Vercel（サーバー、東京）、Anthropic（AI。投稿の下書きを作るときに、利用者が入れたプロジェクトの情報を送る。Threads から取ったデータは送らない） |
| Threads のデータを他社に売る・渡すか | しない |
| 政府などからの開示の求めへの方針 | 法律に基づく正式な求めにだけ、必要な範囲で応じる。求めが不当なら争う。利用者に知らせることが法律で禁じられていなければ知らせる（運営者の方針として、オーナーが確かめる） |
| 保存するデータ | Threads のユーザー ID、ユーザー名、アクセストークン（AES-256-GCM で暗号化）、矢書から送った投稿の ID と URL |
| 削除 | 利用者が「外す」・退会したとき、Meta から削除の通知が来たときにすぐ消す |

## 後で: Instagram と Facebook ページ

別の Meta アプリ（Instagram・Facebook 用。architecture.md の 4.6）を作り、同じ流れ（ビジネス認証は同じポートフォリオで済む）で申請する。

| SNS | 権限 | 条件 |
|---|---|---|
| Instagram（Instagram Login） | instagram_business_basic、instagram_business_content_publish（指標は instagram_business_manage_insights） | プロアカウント（ビジネスかクリエイター）だけ。画像は JPEG、公開 URL に置く。API での投稿は 24 時間に 100 件まで |
| Facebook ページ | pages_manage_posts、pages_read_engagement、pages_show_list（動画は publish_video） | 利用者がそのページで投稿を作れる役割を持っていること |

- どちらも Tech Provider 認証の対象（一度済めば同じビジネスで使える）
- 出典: [Instagram のコンテンツの公開](https://developers.facebook.com/docs/instagram-platform/content-publishing)、[Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)、[ページの投稿](https://developers.facebook.com/docs/pages-api/posts)
