# Meta（Threads、後で Instagram・Facebook）の審査の準備

- **作成日**: 2026-10-11
- **対象のアプリ**: Yabumi Dev（Threads 専用。architecture.md の 4.6）と、Instagram・Facebook 用のアプリ（Yabumi。矢書の側は architecture.md の 4.21 で作り済み。Meta の側のアプリを作るのはオーナーの作業で、deploy.md の 12）
- **ポリシーとの一致**: 下の説明文とデータの扱いの答えは、/privacy の第 1〜6 条と同じ中身にしてある（2026-10-11 に突き合わせ）。どちらかを変えたら、もう片方も直す
- **いまの状態**: 開発モード。Threads Tester に登録したアカウント（オーナーの @masa_i82）だけがつなげる

## 他の人がつなげるようになるまで

| # | 何を | どこで | 要るもの | 期間 |
|---|---|---|---|---|
| 1 | ビジネスポートフォリオを作り、アプリをそこに入れる | Meta Business Suite（business.facebook.com）→ 設定 → ビジネスポートフォリオ。アプリのダッシュボード → App settings → Basic → 「Business portfolio」で紐づけ | ― | すぐ |
| 2 | **ビジネス認証**（Business Verification） | ビジネス設定 → セキュリティセンター →「認証を開始」。管理者だけができる | YuXport Labs の名前・住所・電話、Web サイト `https://yabumi.app` と、それが書かれた書類（下の「ビジネス認証」） | 数日（公式の目安は未確認） |
| 3 | アプリの基本設定を埋める | App settings → Basic（下の「基本設定」） | プライバシーポリシーの URL、アイコン、カテゴリ、連絡先メール、データ削除の URL | すぐ |
| 4 | 各権限で API を 1 回以上呼んでおく | 本番の矢書で、テスターのアカウントでつないで投稿・削除する | 申請の **30 日以内**に、申請する権限ごとに成功した呼び出しが要る | ― |
| 5 | **App Review** に出す | App Review → Requests → 権限を選んで「Request」 | 権限ごとの説明文と画面の録画（下）、審査の担当者用のアカウント | 1 週間ほど（公式）。却下されたら直して出し直す |
| 6 | データの扱いの質問に答える（Data Handling Questions） | App Review の提出の中、またはダッシュボードの案内 | 下の「データの扱いの答え」 | その場で判定（最大 30 秒） |
| 7 | **Tech Provider 認証**（Access Verification） | App settings → Basic → Verifications → Access verification | 矢書がどんなサービスか、他の人のデータをどう使うかの説明（下） | 約 5 日 |
| 8 | アプリを **Live** にする | 左のメニューの「Publish」（Threads の新しい画面） | 1〜7 が済んでいること。Data Use Checkup（年 1 回）も済ませる | すぐ |

- 7 は、アプリの役割を持たない人が threads_basic・threads_content_publish（と、将来足す threads_manage_insights）を使うときに要る（済んでいないと、エラーコード 100 で断られる）。threads_delete は一覧にない
- Live にすると、開発モードのときのテストの投稿も公開のものとして扱われる。テストの投稿は Live の前に消しておく
- 出典: [Threads の始め方](https://developers.facebook.com/docs/threads/get-started)、[権限の一覧](https://developers.facebook.com/docs/permissions)、[App Review の出し方](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)、[ビジネス認証](https://developers.facebook.com/docs/development/release/business-verification)、[Access Verification](https://developers.facebook.com/docs/development/release/access-verification/)、[アプリのモード](https://developers.facebook.com/docs/development/build-and-test/app-modes)、[Data Use Checkup](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/data-use-checkup)

## 決めたこと: threads_manage_insights は申請しない（案 A、2026-10-11 オーナーの決定）

矢書は threads_manage_insights（投稿の閲覧数などを読む権限）を求めていたが、**使っていない**（指標 F07 はフェーズ 3）ので、案 A に決めて求める権限から外した（src/lib/sns/threads/api.ts の THREADS_SCOPES）。審査には threads_basic・threads_content_publish・threads_delete を出す。

**2026-10-11 追記**: 指標の画面（F07）を作ったので、threads_manage_insights は「使う権限」になった。最初の審査（threads_basic・threads_content_publish・threads_delete）はそのまま出し、threads_manage_insights は Instagram の申請と一緒に追加で出す（決定 D21）。手順は下の「権限ごとの説明文」の threads_manage_insights。矢書がこの権限を求めるのは、環境変数 SNS_INSIGHTS に threads を入れたときだけ（deploy.md の 14）

### オーナーの作業: Meta アプリから権限を外す

1. https://developers.facebook.com/apps で Yabumi Dev を開く
2. 左のメニューの Use cases → 「Access the Threads API」の Customize（または Permissions）
3. threads_manage_insights の行の「Remove」（外す）を押す。threads_basic・threads_content_publish・threads_delete は残す
4. すでにつないでいるアカウントは、次に「つなぎ直す」までは前の権限のまま。矢書は threads_manage_insights を使っていないので、困ることはない
5. 指標を作るときは、ここで threads_manage_insights を足し直し、その権限だけを追加で審査に出す

以下は、決める前の検討（記録として残す）。Meta は「要らない権限の申請」を却下の理由に挙げており、手順 4 の「30 日以内に呼んだ実績」も作れない。

| 案 | 中身 | 長所 | 短所 |
|---|---|---|---|
| A（おすすめ） | いまは申請しない。矢書が求める権限からも外す（src/lib/sns/threads/api.ts の THREADS_SCOPES）。指標を作るときに足して、その権限だけ追加で審査に出す | 審査が通りやすく、早い。利用者に「使わない権限」を求めない | 指標を作ったとき、利用者に「つなぎ直す」をしてもらう必要がある |
| B | 先に指標の一部（投稿ごとの閲覧数）を作ってから、4 つまとめて申請する | つなぎ直しが要らない | 審査が指標の完成まで遅れる |

## ビジネス認証（YuXport Labs の名義。2026-10-11 決定）

個人事業主「YuXport Labs」（開業届は提出済み）として申請する。

| # | どこで | やること |
|---|---|---|
| BV-1 | Meta Business Suite（business.facebook.com）→ 設定 → ビジネス情報 | ビジネスポートフォリオの**名前**を `YuXport Labs`、**住所・電話番号**を開業届に書いたものと一字一句同じにする。Web サイトは `https://yabumi.app`（切り替えのあと） |
| BV-2 | 同じく ビジネス情報 | ビジネスのメールアドレスを `support@yabumi.app` にする（ドメインのメールで確かめると通りやすい。deploy.md の 11 の G で受け取れるようにしてから） |
| BV-3 | 設定 → セキュリティセンター →「認証を開始」 | 国は日本。事業者名 `YuXport Labs` で検索して出なければ、手で入れる。認証の方法は「書類をアップロード」 |
| BV-4 | 同上 | 書類を上げる（下の表）。名前と住所が BV-1 と同じであること |
| BV-5 | 同上 | 確認のコードを、メール（support@yabumi.app）か電話で受け取って入れる |
| BV-6 | ― | 結果を待つ（数日。公式の目安は未確認）。通ったら、アプリのダッシュボードの App settings → Basic で、アプリがこのビジネスポートフォリオに入っているか確かめる |

| 書類 | 何を確かめる | 注意 |
|---|---|---|
| **個人事業の開業・廃業等届出書（開業届）の控え** | 事業者名（屋号）と住所 | 税務署の受付印か、e-Tax の受信通知があるもの。屋号の欄が `YuXport Labs` になっているか確かめる（違えば、届け出た屋号の表記に、ポートフォリオの名前を合わせる） |
| 住所の確認（どれか 1 つ）: 公共料金の請求書、事業用の銀行の明細、納税証明書 | 住所 | 開業届と同じ住所で、名前（屋号または氏名）が載っているもの。3 か月以内のものが無難 |

- 出典: 第三者のまとめ（[Wati](https://support.wati.io/en/articles/11463208-meta-business-verification-required-documents-by-country)）。Meta の公式のヘルプは画面が JavaScript で、内容を確かめられなかった【未確認】
- 本人確認書類（免許証やパスポート）だけでは通らないとされる。通らなかったときは、断られた理由の表示に従って書類を足す

## 基本設定（App settings → Basic）

| 欄 | 入れる値 |
|---|---|
| Display name | Yabumi（審査の前に、名前に「Dev」を含まないアプリ名にする。名前を変えると審査の出し直しになることがあるので、申請の前に決める） |
| App icon | docs/design/logo/icons/ios/AppIcon-1024.png（1024×1024、PNG、5MB 未満。Meta のロゴを含めない） |
| Privacy Policy URL | `https://yabumi.app/privacy` |
| Terms of Service URL | `https://yabumi.app/terms`（必須かは【未確認】だが入れる） |
| User data deletion | 「Data deletion callback URL」を選び、`https://yabumi.app/sns/threads/delete`（作り済み。署名を確かめ、Threads のアカウントの情報とトークンを消し、確認ページ /sns/threads/deletion の URL と確認コードを返す） |
| Category | Productivity（または Business and Pages） |
| Contact email | オーナーの連絡先（審査の結果が届く） |
| App purpose | Clients（他の人が使うアプリ） |

Threads の Use cases → Settings の Uninstall Callback URL は `https://yabumi.app/sns/threads/uninstall`、Delete Callback URL は上と同じ（deploy.md の 6-1）。

## 権限ごとの説明文（英語。申請の欄にそのまま貼る）

権限ごとに別の文にする（Meta は同じ文の使い回しを嫌う）。

### threads_basic

> Yabumi is a social media scheduling tool for indie app developers. After a user connects their Threads account via Threads Login, we use threads_basic to read the user's Threads user ID and username. We show "✓ @username" on the user's project overview so they can confirm which Threads account their posts will be published to, and we store the user ID to link scheduled posts to the right account. We do not read any other profile data.

### threads_content_publish

> Users write a post in Yabumi, review the Threads preview (character count and the exact text), and then either click "Send now" or schedule it for a date and time. Only when the user clicks one of these buttons do we use threads_content_publish to create a post on the user's own Threads account: a text post, or a post with the images the user attached (with the alt text the user wrote). We create a media container, then publish it; for images we pass a signed URL that expires in one hour. After publishing, we show a "View on Threads" link with the permalink so the user can see the result. We never post anything the user did not write or approve, and we never post to accounts other than the one the user connected.

### threads_delete

> On each published post's page, Yabumi shows a "Delete from Threads" button. When the user clicks it and confirms, we use threads_delete to delete that post from the user's Threads account, and we mark the post as deleted in Yabumi. This lets users quickly remove a test post or a post with a mistake without leaving Yabumi. We only delete posts that were published through Yabumi by that same user.

### threads_manage_insights（指標を作ったので、追加で申請する。2026-10-11 に画面ができた）

> Yabumi shows indie developers whether their posts are reaching people, on the project's "Metrics" (指標) page. After a user connects their Threads account with this permission, a daily job reads the insights of the posts the user published through Yabumi (views, likes, replies, reposts, quotes, shares) on day 1, 3, 7 and 30 after publishing, and the account's followers_count once a day. We show the total views of the last 7 days compared with the previous week, the follower growth, and a ranked list of the most viewed posts, so non-marketers can see which kind of post works. If the user asks Yabumi's AI assistant to review their numbers, these numbers are included in that request so the assistant can point out what worked (our AI provider, Anthropic, does not use API data for training and deletes it within 30 days). We only read insights of the user's own account and of posts published through Yabumi; we never read other users' data, we never sell or share these numbers, and we never post or change anything with this permission. When the user disconnects the account in Yabumi, removes Yabumi in Threads settings, or Meta sends a data deletion request, we delete these numbers immediately.

#### 申請までの流れ（オーナー。DB と画面は 2026-10-11 に作り済み）

1. Meta の Yabumi Dev → Use cases → Access the Threads API → Permissions で threads_manage_insights を足す（Add）。開発モードなので、Tester のアカウントにはすぐ使える
2. Vercel の環境変数 `SNS_INSIGHTS` に `threads` を入れて Redeploy（deploy.md の 14）。これで矢書がつなぐときに threads_manage_insights も求める
3. 矢書の概要の「つないだ SNS」で Threads を**つなぎ直す**（認可画面に、投稿の数字を読む権限が増えて出る）。つなぎ直すまでは、指標の画面に「● 要確認 … つなぎ直しが要ります」と出る
4. 何か投稿を送り、翌日 5 時以降に指標の画面の「よく見られた投稿」と「投稿の閲覧数」に数字が出ることを確かめる（**これが申請の 30 日以内の呼び出しの実績になる**）
5. 画面の録画（下の表の threads_manage_insights）を撮り、App Review でこの権限だけを追加で申請する（Instagram の申請と一緒に出す。決定 D21）

## 画面の録画（権限ごとに 1 本）

共通の決まり: 1080p 以上、音声なし、マウスで操作、英語の字幕か注釈を付ける（画面は日本語なので、各操作に「Click "Connect" (つなぐ)」のような注釈）。最初に、ブラウザのアドレスバーで本番の URL が見えるようにする。

| 権限 | 録画の流れ |
|---|---|
| threads_basic | ① 審査用のアカウントで矢書にログイン ② プロジェクトの概要の「つないだ SNS」→ Threads の「つなぐ」③ Threads の認可画面（求める権限が並ぶ）で許可 ④ 矢書に戻り「✓ @ユーザー名」が出る |
| threads_content_publish | ① ログイン済み、Threads はつないだ状態から ②「投稿をつくる」で本文を入れ、送り先に Threads を選ぶ ③ Threads のプレビュー（文字数）を見せる ④「今すぐ送る」⑤ 送信の結果の「Threads で見る」を押し、Threads で投稿が出ていることを見せる ⑥ 予約も見せる: 数分後に予約 → カレンダーに出る → 時刻が来て「✓ 送信済み」 |
| threads_delete | ① 送信済みの投稿の画面 ②「Threads から取り消す」→ 確認 ③ 送信の結果が取り消しに変わる ④ Threads で投稿が消えたことを見せる |
| threads_manage_insights | ① ログイン済みで、概要の「つないだ SNS」から Threads を「つなぎ直す」→ 認可画面に投稿の数字を読む権限（insights）が出ているところを見せて許可 ② 数日前に送った投稿がある状態で、サイドバーの「指標」（Metrics）を開く ③「投稿の閲覧数」（views）と先週との差、「フォロワーの増え方」を見せる ④「よく見られた投稿」（Most viewed posts）の 1 位を押して、その投稿の画面を開く ⑤ 同じ投稿を Threads のアプリで開き、表示回数が同じくらいであることを見せる（数字は 1 日 1 回の取り込みなので、少しずれてよい） |

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
| データを処理する他社（委託先）はあるか | ある: Supabase（DB、東京）、Vercel（サーバー、東京）、Anthropic（AI）。Anthropic には、利用者が AI の機能を使うときに、利用者が入れたプロジェクトの情報と矢書で書いた投稿の本文を送る。利用者が「AI と相談」「AI と振り返る」を使うときは、その利用者自身の投稿の数字（Threads・Instagram・Facebook から読んだ閲覧数・フォロワー数など）も送る（/privacy の第 3 条）。Anthropic は API の内容を学習に使わず、30 日以内に消す |
| Threads のデータを他社に売る・渡すか | しない |
| 政府などからの開示の求めへの方針 | 法律に基づく正式な求めにだけ、必要な範囲で応じる。求めが不当なら争う。利用者に知らせることが法律で禁じられていなければ知らせる（運営者の方針として、オーナーが確かめる） |
| 保存するデータ | ユーザー ID、ユーザー名、表示名、アクセストークン（AES-256-GCM で暗号化）、矢書から送った投稿の ID と URL。数字の権限つきでつないだときは、矢書から送った投稿の数字（1・3・7・30 日目）とフォロワー数（日ごと）。Facebook はページの ID・名前と、つないだ Facebook の利用者の ID（ページを選ぶまでの 15 分だけ、ページの一覧と暗号化したページのトークンも） |
| 削除 | 利用者が矢書で「外す」とき、Meta の側で矢書が外されたとき（Deauthorize の知らせ）、Meta からデータの削除の依頼が来たとき（確認のページと確認コードを返す）、退会したとき: どれも、アカウントの情報（Deauthorize のときは「解除済み」の印だけ残す）・トークン・フォロワー数・矢書から送った投稿の数字・SNS 上の投稿の ID と URL をすぐ消す（Threads・Instagram・Facebook とも）。SNS で投稿が消されたら、その投稿の数字と ID・URL を消す。矢書で書いた投稿の本文は利用者のものなので残す |

## Instagram と Facebook ページ

矢書の側は作り済み（architecture.md の 4.21）。別の Meta アプリ（Instagram・Facebook 用）を作り、同じ流れ（ビジネス認証は同じポートフォリオで済む）で申請する。設計と、アプリの作り方・権限・コールバック URL は architecture.md の 4.21（Instagram は Instagram Login、Facebook はページだけ。Instagram Login では投稿を API で消せないので、threads_delete に当たる権限は申請しない）。

| SNS | 権限 | 条件 |
|---|---|---|
| Instagram（Instagram Login） | instagram_business_basic、instagram_business_content_publish、instagram_business_manage_insights（指標。2026-10-11 に読み方を作った。threads_manage_insights と同じ流れで、Meta のアプリに足す → SNS_INSIGHTS に instagram → つなぎ直す → 30 日以内に読んだ実績 → 録画 → 申請） | プロアカウント（ビジネスかクリエイター）だけ。画像は JPEG、公開 URL に置く。API での投稿は 24 時間に 100 件まで |
| Facebook ページ | pages_manage_posts、pages_read_engagement、pages_show_list（動画は publish_video）、read_insights（指標。Facebook Login for Business の設定（configuration）に足す → SNS_INSIGHTS に facebook → ページをつなぎ直す） | 利用者がそのページで投稿を作れる役割を持っていること |

- どちらも Tech Provider 認証の対象（一度済めば同じビジネスで使える）
- 出典: [Instagram のコンテンツの公開](https://developers.facebook.com/docs/instagram-platform/content-publishing)、[Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)、[ページの投稿](https://developers.facebook.com/docs/pages-api/posts)

### 権限ごとの説明文（英語。申請の欄にそのまま貼る。2026-10-11 に実装と /privacy に合わせて書いた）

#### instagram_business_basic

> Yabumi is a social media scheduling tool for indie app developers. After a user connects their Instagram professional account via Instagram Login, we use instagram_business_basic to read the account's user ID, username and account type. We show "✓ @username" on the user's project overview so they can confirm which Instagram account their posts will be published to, and if the account is not a professional account we explain how to switch instead of connecting. We store the user ID to link scheduled posts to the right account. We do not read any other profile data.

#### instagram_business_content_publish

> Users write a caption in Yabumi, attach one image or up to 10 images (a carousel), optionally write alt text for each image, review the Instagram preview (caption length and image aspect ratio), and then click "Send now" or schedule it. Only when the user clicks one of these buttons do we use instagram_business_content_publish to create media containers with a signed image URL that expires in one hour, wait until the container is ready, and publish it to the user's own Instagram account. After publishing, we show a "View on Instagram" link with the permalink. We never post anything the user did not write or approve. Because Instagram Login cannot delete media, Yabumi tells users to delete Instagram posts from the Instagram app.

#### instagram_business_manage_insights

> On the project's "Metrics" page, Yabumi shows indie developers whether their posts are reaching people. With this permission, a daily job reads the insights of the posts the user published through Yabumi (views, reach, likes, comments, saves, shares, total interactions) on day 2, 4, 8 and 31 after publishing, and the account's followers_count once a day. We show the total views of the last 7 days compared with the previous week, the follower growth, and the most viewed posts. If the user asks Yabumi's AI assistant to review their numbers, these numbers are included in that request (Anthropic does not use API data for training and deletes it within 30 days). We only read the user's own account and posts published through Yabumi, and we never sell or share these numbers. When the user disconnects the account in Yabumi, removes Yabumi in Instagram settings, or Meta sends a data deletion request, we delete these numbers immediately.

#### pages_show_list

> Personal Facebook profiles cannot be posted to via the API, so Yabumi connects Facebook Pages. After the user logs in with Facebook Login for Business, we use pages_show_list to list the Pages the user manages (only those where the user can create content) and show them on a "Choose a Page" screen. The user picks one Page; we keep the list for at most 15 minutes until the user chooses, then delete it. We store only the chosen Page's ID, name and Page access token (encrypted).

#### pages_read_engagement

> We use pages_read_engagement together with pages_manage_posts, as required to read the chosen Page's basic information (name) and to get the permalink of the posts Yabumi published, which we show as a "View on Facebook" link. If the user enabled metrics, we also read the Page's followers_count once a day to show follower growth on the "Metrics" page. We do not read posts or comments written by other people.

#### pages_manage_posts

> Users write a post in Yabumi, optionally attach images, review the Facebook preview, and click "Send now" or schedule it. Only then do we use pages_manage_posts to publish a text, link or photo post to the Page the user chose (images are passed as signed URLs that expire in one hour). On each published post's page, Yabumi shows a "Delete from Facebook" button; when the user clicks it and confirms, we delete that post. We only publish to and delete from the Page the user connected, and only posts the user wrote or approved.

#### read_insights

> With read_insights, a daily job reads the insights of the Page posts published through Yabumi (media views, unique viewers, reactions, clicks) on day 1, 3, 7 and 30 after publishing, so the "Metrics" page can show which posts reached people. If the user asks Yabumi's AI assistant to review their numbers, these numbers are included in that request (Anthropic does not use API data for training and deletes it within 30 days). We only read the Page the user connected and posts published through Yabumi, and we never sell or share these numbers. When the user disconnects the Page in Yabumi, removes Yabumi in Facebook's Business Integrations, or Meta sends a data deletion request, we delete these numbers immediately.

- 録画は Threads と同じ形（つなぐ → 認可画面 → 「✓」、投稿 → 「Instagram で見る」、指標の画面）。Instagram の録画では「Instagram からは取り消せないので、Instagram のアプリから消す」案内も見せる
- Instagram の数字の読み方（2・4・8・31 日目）と Facebook の数字の名前は src/lib/sns/insights/index.ts と、SNS 上の投稿 ID の扱いは src/lib/sns/accounts.ts と揃える

