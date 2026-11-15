# TikTok の連携（設計メモ）

- **作成日**: 2026-11-14（実装担当3。PM の依頼）
- **いまの状態**: 設計だけ。コードは PM の了承のあと
- **オーナーが決めたこと（2026-11-14）**
  - 順番は「つなぐ＋写真 → 審査を申請 → 動画」。動画（architecture.md の 4.24。WebCodecs・post-videos・TUS）は、審査を待っている間に作る
  - 送り方は、予約も今すぐ送るも直接投稿（Direct Post、video.publish）。下書き（MEDIA_UPLOAD、video.upload）は、直接投稿が使えないときの逃げ道として残す。予約で直接投稿してよいかは、TikTok のサポートに念のため問い合わせる（返事を待たずに作る）
- **前提**: architecture.md の 4.24（2026-10-11 の調査）、docs/review/tiktok.md（審査の 8 つの決まり）
- **出典**: TikTok for Developers の公式の資料（2026-11-14 に読み直した）
  - [Photo Post](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post)
  - [Direct Post（動画）](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
  - [Upload（下書き）](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video)
  - [creator_info](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info)
  - [status/fetch](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status)
  - [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)
  - [Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)
  - [Manage User Access Tokens](https://developers.tiktok.com/doc/oauth-user-access-token-management)
  - [Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web)
  - [Webhooks](https://developers.tiktok.com/doc/webhooks-overview)・[Webhook events](https://developers.tiktok.com/doc/webhooks-events)
  - [Rate limits](https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit)
  - 2026-11-14 の読み直しで読めなかったページ（トークンの取得・更新・取り消し、Webhook の署名）は、同じ日に PM が公式の資料で確かめた（下の「確かめた窓口」）

## 0. オーナーに決めてもらうこと（おすすめ順）

| # | 決めること | 選択肢 | おすすめ | 理由 |
|---|---|---|---|---|
| A | 写真を渡す入口の URL を「一回きり」にするか | ① 1 回読まれたら無効 ② 1 時間で無効、送り終えたらその場で無効 | **②** | TikTok は取りに来るのを失敗するとやり直すことがあり、取りに来る回数は資料に書かれていない。① だと、やり直しのたびに送れなくなるおそれがある。② でも、推測できないトークン・他人の画像を返さない・送り終えたら無効、で守れる |
| B | 「TikTok は手で投稿する」を選べるようにするか（X と同じ） | ① 作る ② 作らない | **① 作る** | 審査の前は、API の投稿が「自分だけ」に限られる。審査を待つ間（数週間）に TikTok に出したい人は、手で投稿するしかない。X の手で投稿する作り（X_BY_HAND）をそのまま広げられ、手間は小さい |
| C | 審査の前の画面の伝え方 | 送る画面の上に帯を出す（下の 9.） | 帯の文の案（下）でよいか | 利用者のせいではなく yabumi の準備の都合だと、はっきり書く |
| D | Webhook を何に使うか | ① 外されたとき（authorization.removed）だけ ② 投稿の状態も | **①** | 署名は確かめる（下の「確かめた窓口」）が、投稿の状態は status/fetch（1 分 30 回まで）で確かめられる。Webhook の中身は信じず、きっかけとしてだけ使う |

## 1. つなぐ・外す（Login Kit）

- **入口**: `/sns/tiktok/connect` → `https://www.tiktok.com/v2/auth/authorize/`
  - client_key、scope（カンマ区切り）、response_type=code、redirect_uri、**state（必須）**
  - state は既存の src/lib/sns/oauth-state.ts（cookie に入れた乱数と、どのプロジェクトからかを照らす）をそのまま使う
  - PKCE は Web の資料に書かれていない（docs/review の 2026-10-11 の調べでは「必須ではない」）
- **戻り先**: `https://yabumi.app/sns/tiktok/callback`
  - 登録できるのは 10 個まで・https の絶対 URL・クエリと # は不可・512 文字まで
  - 戻ってくるもの: code・scopes・state・error・error_description
- **スコープ**: `user.info.basic`・`video.publish`・`video.upload` だけ
  - 戻ってきた scopes に video.publish がなければ、つなげはするが「直接投稿が使えません」と出し、下書き（8.）だけにする
- **トークンを取る**（2026-11-14 に確かめた。下の「確かめた窓口」）
  - `POST https://open.tiktokapis.com/v2/oauth/token/`（client_key・client_secret・code・grant_type=authorization_code・redirect_uri）。返ってくるもの: access_token・expires_in・refresh_token・refresh_expires_in・open_id・scope
  - サーバーでだけ呼ぶ。client_secret は画面に出さない
- **トークンの期限**: 資料が食い違っている
  - docs/review/tiktok.md（2026-10-11）: アクセス 24 時間、リフレッシュ 365 日
  - いまの「Manage User Access Tokens」（2026-11-05 更新）: アクセス 2 時間、リフレッシュ 180 日、と読める（読み取りに自信がない）
  - **どちらでも動くよう、期限は決め打ちにせず、返ってきた expires_in・refresh_expires_in を social_account_tokens.expires_at に入れる**
  - 更新のたびにリフレッシュトークンも新しくなる（使い捨て。X と同じ）ので、毎回入れ替える。古いリフレッシュトークンを使うと、以後の更新ができなくなり、つなぎ直しになる
  - 既存の refreshDueTokens（期限の前に取り直す毎日のジョブ）に TikTok を足す。アクセスが 2 時間なら、送る直前にも期限を見て取り直す（X と同じ）
  - 同時に 2 か所で取り直すと、片方のリフレッシュトークンが無効になるので、既存の refresh_locked_until の鍵を使う
- **アカウントの記録**: 既存の social_accounts（sns = 'tiktok'、external_id = open_id、display_name = ニックネーム、handle = ユーザー名）
  - ニックネームとユーザー名は、user.info.basic（/v2/user/info/）か creator_info で読む
  - アイコンの URL は 2 時間で切れるので、保存しない（画面を出すたびに creator_info で読む）
- **外す**: yabumi の「外す」で、トークンの取り消し（`POST /v2/oauth/revoke/`）→ social_accounts を消し、purgeSnsDataOf（下の 12.）

## 2. 写真を渡す入口

TikTok の写真の投稿は PULL_FROM_URL だけで、**所有を確かめたドメインか URL の前半**の下の URL しか取りに来ない。Supabase の署名 URL（xxx.supabase.co）は使えない。

- **URL の形**: `https://yabumi.app/tiktok-media/<トークン>.jpg`
  - TikTok には「URL の前半」として `https://yabumi.app/tiktok-media/` を登録する（ドメインごとよりも狭い）
  - 末尾を `.jpg` にすると、src/proxy.ts の matcher（画像の拡張子を外している）でログインの確かめと独自ドメインへの転送を通らないので、**3xx を返さない**
  - www・末尾の / の転送も起きない形にする。作ったあと、curl で 200 と Content-Type: image/jpeg が直接返ることを確かめる（3xx は TikTok が不可とする）
- **トークン**: 32 バイトの乱数（推測できない）。DB には SHA-256 だけを持つ（新しい表 `tiktok_media_tickets`。下の 11.）
  - 誰の・どの配信先の・どの画像か（owner_id・post_target_id・media_id）を持ち、期限は 1 時間（TikTok の取りに来る時間の上限と同じ）
  - 送り終えたら（PUBLISH_COMPLETE・FAILED）その場で消す。期限切れは毎日の片付けで消す
- **返すもの**: 画像だけ（Content-Type: image/jpeg、Cache-Control: no-store）
  - トークンが違う・期限切れ・消えた → 404。どれも同じ 404 で、理由は返さない
  - 画像は、トークンが指す media_id だけを Storage から読む（サーバーの権限）。その画像が、いまもその配信先の投稿に添えてあることも確かめる（あとで外した画像は返さない）
  - 他人の画像は、トークンに持ち主と配信先が結びついているので返らない
- **大きさ**: TikTok の写真は JPEG か WebP、**1080p まで**、1 枚 20MB まで。yabumi の画像は長い辺 2048px までなので、そのままでは大きい
  - 入口で返すときに、長い辺 1080px に縮めた JPEG を返す。縮めた画像はその場で作り、置かない
  - 縮めるのは純粋な JS のライブラリ（候補: jpeg-js。MIT・依存なし。2048px の画像で 0.5 秒ほどの見込み）。sharp は Vercel で重いので使わない。作る前に、Vercel の関数で 1 枚の時間を測る
- **Vercel の転送量**
  - 1080px の JPEG は 1 枚 200〜400KB。1 投稿 平均 3 枚・TikTok を使う人 10 人・1 人 1 日 1 本・30 日なら、約 0.3GB/月
  - Hobby の 100GB/月 に比べて十分小さい。Supabase の転送（無料 5GB/月）も、同じくらい増えるだけ
  - TikTok は最大 100Mbps で取りに来る

## 3. 送る画面（審査の 8 つの決まり。docs/review/tiktok.md）

TikTok を送り先に選んだ投稿の、⑤ 送る（と ② 送り先の TikTok の欄）に、TikTok の確かめの欄を出す。この欄で同意するまで、TikTok には送らない。

1. **開くたびに creator_info を読む**（1 分 20 回まで）
   - ニックネーム（「@ユーザー名（ニックネーム）として投稿します」）を出す
   - 投稿できない状態（spam_risk_too_many_posts・spam_risk_user_banned_from_posting・reached_active_user_cap）なら、送るボタンを押せなくし、理由と「時間をおいて」を出す
   - 動画は max_video_post_duration_sec と比べる（動画のとき）
2. **タイトルと本文を直せる**
   - TikTok の写真は、タイトル 90 字・説明 4000 字（どちらも UTF-16 で数える）
   - タイトルは post_targets.title（note・Substack と同じ列）、説明は TikTok の文面（body_override か共通の本文）に入れる
   - yabumi が入れたハッシュタグも、ここで直せる
3. **公開範囲は利用者が選ぶ**
   - privacy_level_options（公開のアカウント: 全員・相互フォロー・自分だけ。非公開のアカウント: フォロワー・相互フォロー・自分だけ）から、プルダウンで選ぶ
   - **最初は何も選んでいない**。選ぶまで送れない
4. **コメントを許可する**（写真はコメントだけ。動画は Duet・Stitch も）
   - 最初はオフ。creator_info で無効のものは押せない
5. **宣伝の内容（Commercial content disclosure）**
   - スイッチは最初オフ。オンにしたら「自分のブランド」「ブランドコンテンツ」の少なくとも一方を選ばないと送れない
   - 出す言葉（資料のとおり英語のまま、日本語の説明を添える）
     - 自分のブランド: 「'Promotional content' のラベルが付きます」
     - ブランドコンテンツ・両方: 「'Paid partnership' のラベルが付きます」
   - ブランドコンテンツは「自分だけ」にできない。選んだら「自分だけ」を押せなくし、hover に「Branded content visibility cannot be set to private.」
   - yabumi の利用者は自分の商品・お店の宣伝が多いので、「自分のブランド」の説明を用語の点線で添える
6. **同意の文とリンク**（送るボタンの前）
   - 自分のブランドだけか、宣伝でない: 「By posting, you agree to TikTok's Music Usage Confirmation.」（Music Usage Confirmation へのリンク）
   - ブランドコンテンツを含む: 「By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.」（両方へのリンク）
   - 英語の文はそのまま出し、下に日本語の訳を小さく添える
7. **プレビュー**
   - TikTok だけの見え方（写真をめくる形・タイトル・説明・ニックネーム・アイコン）を、送るものと同じ文と画像で出す
   - yabumi の透かし・ロゴ・宣伝の文は付けない
8. **送ったあと**: 「TikTok で反映されるまで数分かかることがあります」と出す（6.）

## 4. 予約のときの守り方

審査の決まりは「投稿の画面を出すときに最新の creator_info を読む」「同意のあとでだけ送る」。予約は同意と送る時刻が離れるので、次のとおりにする。

- **予約を決めるとき**（保存するとき）
  - creator_info を読み直し、選んだ公開範囲が privacy_level_options にあり、投稿できる状態かを確かめる。だめなら保存しない
  - 同意したときの設定を、配信先に記録する（11. の post_targets.tiktok）: 公開範囲・コメント・宣伝のスイッチ・AI の印・同意した時刻（サーバーが決める）・同意したときのタイトルと説明の指紋（SHA-256）・同意したときのニックネーム
- **送る直前**（送信ジョブ）
  - creator_info を読み直す
  - 次のときは送らずに failed にして、要確認と通知（既存の送れなかった知らせ）で知らせる
    - 選んだ公開範囲が選べなくなっている
    - 投稿できない状態（上の 3 つの理由）
    - ニックネームが変わっていた（別のアカウントにつなぎ直したなど）
    - 同意したときのタイトル・説明の指紋と、いまの文が違う（同意のあとに文を変えた）
  - 理由は「TikTok の設定が予約のときと変わったので、送りませんでした。投稿の画面で確かめてから、もう一度送ってください」のように、直し方まで書く
- 同意の記録の改ざん（画面から公開範囲や同意の時刻を書き換える）を防ぐため、post_targets.tiktok は、保存のサーバー関数だけが書き、利用者の権限では書けない列にする（11.）

## 5. 「他の SNS の写し」と見られない作り

審査で「他の SNS の中身を機械的に複製するアプリ」は認められない。

- TikTok を送り先に選んだら、**TikTok のタイトル・説明の欄を必ず開いて確かめる**。3. の同意で、その文の指紋を記録するので、確かめずには送れない
- タイトルは共通の本文からは作らない（空のまま）。AI で投稿に整える（4.34）で TikTok を選んだときだけ、TikTok 向けの案（タイトル 90 字・説明）を出す
- プレビューは、送るものと同じ文と画像で、TikTok だけの見え方にする（ほかの SNS の見え方を使い回さない）
- 送るのは、利用者が同意した時点の中身だけ（4. の指紋）

## 6. 送ったあと

- init の答えの publish_id を、配信先の sns_container に入れ、status を preparing にする（Threads・Instagram の、準備に時間がかかる送り方と同じ作り。src/lib/sns/adapters/staged.ts）
- 送信ジョブが status/fetch で確かめる（トークン 1 つで 1 分 30 回まで。1 分ごとに 1 回）
  - PROCESSING_DOWNLOAD: まだ。preparing のまま
  - PUBLISH_COMPLETE: published。publicaly_available_post_id（綴りは資料のまま）があれば外部の ID と URL を入れる。公開の投稿は審査（ふつう 1 分以内、数時間かかることもある）が済むまで ID が来ないので、来るまで「投稿済み（TikTok で確認中）」として、あとで取りに行く
  - FAILED: fail_reason ごとに分ける
    - internal・photo_pull_failed・video_pull_failed → やり直す
    - auth_removed → つなぎ直し
    - spam_risk_* → やり直さない
    - 形の問題 → 画像の直し方を出す
  - SEND_TO_USER_INBOX: 下書き（8.）のとき。「TikTok のアプリの受信箱から仕上げてください」
- 画面: 送信の結果に「TikTok で処理しています（数分かかることがあります）」。既存の SendProgress と同じく、読み込み直すと結果が出る
- Webhook（post.publish.*）は、資料の 2 つのページで食い違っているので、最初は使わない（0. の D）

## 7. 回数の上限

| 上限 | 中身 | yabumi の扱い |
|---|---|---|
| init | トークン 1 つで 1 分 6 回（写真・動画・下書き） | 送信ジョブは、同じアカウントの TikTok を 1 分に 3 本までにする。429 は retryable（1 分あけてやり直す） |
| creator_info | 1 分 20 回 | 画面を開いたときと、送る直前だけ |
| status/fetch | 1 分 30 回 | 1 本につき 1 分に 1 回 |
| 1 アカウント 1 日 | 約 15 本（ほかのアプリとの合計。正確な数は資料に書かれていない） | 予約を決めるときに、その日の yabumi からの TikTok の数を数えて、10 本を超えたら「TikTok は 1 日 15 本ほどまでです」と出す（止めはしない）。spam_risk_too_many_posts は failed（やり直さない）で、「今日の TikTok の上限に達しました。明日送るか、TikTok のアプリから投稿してください」 |
| 下書き | 未完了の下書きは 24 時間で 5 件まで | spam_risk_too_many_pending_share は failed で、「TikTok のアプリで、受信箱の下書きを仕上げるか消してください」 |
| 審査の前 | 24 時間で 5 人まで | reached_active_user_cap は failed で、9. の文 |

## 8. 下書き（MEDIA_UPLOAD）への逃げ道

直接投稿を基本にし、次のときだけ下書きで送る。

- 戻ってきた scopes に video.publish がない（利用者が許可しなかった・アプリの設定で直接投稿が使えない）
- 利用者が「TikTok のアプリで仕上げる」を選んだ（音楽を足したい・TikTok のアプリで編集したい）

決まり:

- 写真の下書きは `post_mode: MEDIA_UPLOAD`。TikTok のアプリが 31.8 より古いと送れない（app_version_check_failed → 「TikTok のアプリを新しくしてください」）
- 動画の下書きは、別の窓口（/v2/post/publish/inbox/video/init/）。タイトル・公開範囲・AI の印は送れない（利用者がアプリで決める）
- 送ったあとは SEND_TO_USER_INBOX で止まる。「TikTok のアプリの受信箱の通知から、仕上げて投稿してください」と出す（資料が求める知らせ）
- 予約で下書きを送ったときは、送った時刻に TikTok のアプリに通知が届くだけで、投稿は利用者が仕上げたときになる、と画面に書く

## 9. 審査の前の制限

- 投稿は「自分だけ」（SELF_ONLY）に限られる。投稿するアカウントは非公開にしておく必要がある（unaudited_client_can_only_post_to_private_accounts）。24 時間で 5 人まで
- yabumi の設定（環境変数 `TIKTOK_AUDITED`。既定は false）で、審査の前の作りにする
  - 公開範囲は「自分だけ」だけを選べる（creator_info の選択肢から、ほかを押せなくする）
  - 送る画面の上に帯を出す（0. の C の案）:
    - 「いまは、yabumi が TikTok の審査を受けている途中のため、TikTok には『自分だけ』に見える投稿しかできません（yabumi の準備の都合で、あなたのアカウントの問題ではありません）。送る前に、TikTok のアカウントを非公開にしてください。審査が終わると、公開範囲を選べるようになります。」
  - 「TikTok は手で投稿する」（0. の B）を作るなら、帯に「公開で出したいときは、手で投稿するを選んでください」を添える
- 審査のあと、TIKTOK_AUDITED を true にすれば、選べる公開範囲がふつうに戻る

## 10. AI で作ったものの印

- 資料に **is_aigc（bool）** がある。true にすると、TikTok が説明に「AI-generated」の印を付ける
  - 写真の資料では、本文の一番上の階層（post_info・source_info と並ぶ）に書かれている
  - 動画の資料では、post_info の中に書かれている
  - **どちらに置くかは【未確認】**。サンドボックスで、写真・動画それぞれ 1 本ずつ送って確かめる
- 下書きの動画（inbox）には、この項目がない
- yabumi では、添えた画像に AI で作ったもの（media_files.ai_generated）が 1 枚でもあれば、**サーバーが** is_aigc を true にする（利用者の画面からは決めさせない）。送る画面には「AI で作った画像が含まれるので、TikTok で AI の印が付きます」と出す

## 11. 表・列・RLS・grant

既存の SNS に合わせる。

- **social_accounts・social_account_tokens**: そのまま使う（sns = 'tiktok'）。トークンは既存どおり暗号化して、サーバーの権限だけが読む
- **新しい表 post_target_tiktok**（送るときの同意の記録。配信先ごとに 1 行。2026-11-14 に、post_targets の列から別の表に変えた）
  - post_targets は利用者の権限で表ごと select を許しているので、列だけを読めなくするには select を列ごとの grant に組み直す必要があり、利用者の権限で select * しているところが壊れる。別の表にして、RLS を有効・ポリシーなし・利用者には grant しない形で、利用者の権限では読めず書けないことを守る（PM の了承）
  - 列: post_target_id（主キー。on delete cascade）・owner_id・privacy_level（4 つのどれか）・disable_comment・brand_organic・brand_content・post_mode（DIRECT_POST・MEDIA_UPLOAD）・is_aigc・consented_at・consent_text_hash（SHA-256 の hex）・consent_nickname・consent_username・updated_at
  - check: ブランドコンテンツは「自分だけ」にできない
  - 書くのは保存のサーバー関数だけ（creator_info を読んだうえで zod で確かめる）。is_aigc・consented_at・consent_text_hash はサーバーが決める。画面に出すときは、サーバーが本人の配信先か確かめてから読む
  - トリガー（tiktok_check_owner）で、配信先が同じ持ち主の TikTok の配信先であることを確かめる
- **新しい表 tiktok_media_tickets**（2. の入口のトークン）
  - token_hash（主キー）・owner_id・post_target_id・media_id・expires_at・created_at
  - RLS は有効。ポリシーは置かず、authenticated・anon には grant しない（サーバーの権限だけ）
  - post_target_id・media_id は on delete cascade（配信先や画像が消えたら一緒に消える）
  - トリガー（tiktok_check_owner）で、配信先と画像が同じ持ち主のものであることを確かめる
  - マイグレーションは 20261114120000_tiktok（2 つの表とトリガー）
  - 毎日の片付けで、期限切れの行を消す
- **SNS の定義**（src/lib/sns/index.ts）: TikTok は media: "video"・maxImages: 0 になっている。写真の 35 枚まで・タイトル 90 字・説明 4000 字に直す。字数は UTF-16 で数える（いまの数え方は書記素なので、TikTok だけ別に数える）
- 結合テストで、post_target_tiktok・tiktok_media_tickets が利用者の権限で読めず書けないこと、配信先を消すと一緒に消えることを確かめる（tests/tiktok-media.integration.test.ts）

## 12. 外されたとき・データの削除

- **TikTok の側で外された**: Webhook の authorization.removed（reason: 1 アプリで外した・2 アカウントの削除・3 年齢・4 停止・5 開発者が取り消し）
  - `/sns/tiktok/webhook` で受ける
  - 署名（TikTok-Signature）を確かめたうえで、**中身は信じない**。届いた user_openid のアカウントについて、こちらからトークンでユーザー情報を読み、401 なら外されたと見なす（どのみちトークンは無効になっている）
  - 外されたと確かめたら、既存の revoke と同じく、social_accounts を「解除済み」にしてトークンを消し、purgeSnsDataOf で、送った投稿の ID・URL・送信の途中の情報（sns_container）を消す
  - 受けたら、すぐ 200 を返す（返さないと 72 時間やり直してくる）。同じ通知が何度も来ても同じ結果になるようにする
- **yabumi の「外す」**: 1. のとおり、取り消してから同じく消す
- **データの削除の求め**: 既存の /sns/deletion の案内に TikTok を足す
- 削除のときに、tiktok_media_tickets の、そのアカウントの配信先の行も消す（cascade で消える）

## 13. 法務（② として扱う）

新しい送り先なので ②。前もって知らせる期間を置くか（noticeWaived）は、施行の時点の利用者で PM・オーナーが決める。

- **プライバシーポリシーに足す文の案**
  - 預かる情報: 「TikTok のアカウント: TikTok のユーザーの ID（open_id）、ユーザー名、ニックネーム、アクセストークン（暗号化して保存）。TikTok に送るときに選んだ公開範囲・コメントの許可・宣伝の内容の表示と、同意した日時」
  - 送り先（第 3 条）: 「TikTok（TikTok Pte. Ltd. など）: 投稿のタイトルと説明、添えた画像（TikTok が取りに来るための、1 時間で切れる URL）、公開範囲などの設定、AI で作った画像かどうか、アクセストークン」
  - 保存期間: 「TikTok のアカウントとトークン: 外すか、TikTok の側で外されるか、退会まで」「TikTok に画像を渡すための URL の記録: 1 時間（送り終えたらすぐ消す）」
- **利用規約に足す文の案**: 「TikTok に送るときは、TikTok の利用規約（https://www.tiktok.com/legal/page/global/terms-of-service/en）、音楽の利用の確認（Music Usage Confirmation）、ブランドコンテンツの決まり（Branded Content Policy）に従ってください。TikTok での公開範囲や宣伝の内容の表示は、利用者が選び、その内容に責任を持ちます」
  - リンク先の URL は、作るときに開いて確かめる
- docs/legal.md に ② と理由（新しい送り先・新しく預かる情報）を記録し、LEGAL_VERSIONS に版を足す

## 14. 審査の申請に要るもの

- **デモ動画で見せる流れ**（サンドボックス・yabumi.app の URL のまま撮る）
  1. yabumi にログインし、設定から「TikTok をつなぐ」→ TikTok の許可の画面（3 つのスコープ）→ yabumi に戻り、ニックネームが出る
  2. 投稿をつくる → 写真を 2〜3 枚添える → 送り先に TikTok を選ぶ → TikTok のタイトルと説明を直す
  3. ⑤ 送る: ニックネーム、公開範囲のプルダウン（最初は空）、コメントのスイッチ（オフ）、宣伝の内容のスイッチ（オフ→オンで 2 つの選択肢）、同意の文とリンク、プレビュー
  4. 今すぐ送る → 「数分かかります」→ 送信の結果が投稿済みになる → TikTok のアプリで、自分だけの投稿として出ていることを見せる
  5. 予約: 日時を決めて予約 → 送る時刻に送られ、結果が出る
  6. 下書き（video.upload）: 「TikTok のアプリで仕上げる」で送り、受信箱の通知から仕上げる
  7. 外す: 設定で TikTok を外す
- **スコープごとの説明の文の案（英語）**
  - user.info.basic: "Yabumi shows the connected TikTok account's nickname and avatar on the posting screen, so the user can confirm which account they are posting to before publishing."
  - video.publish: "Users write and preview a post for TikTok in Yabumi (title, description, photos), choose the privacy level and interaction settings themselves, agree to TikTok's Music Usage Confirmation, and then publish it directly to their own TikTok account, either immediately or at a time they scheduled."
  - video.upload: "When direct posting is not available, or when the user prefers to finish the post in the TikTok app (for example, to add music), Yabumi uploads the user's content to their TikTok inbox as a draft, and the user completes and publishes it in the TikTok app."
- アプリの名前「Yabumi」、アイコン、Web サイト、規約とポリシーの URL の所有確認は docs/review/tiktok.md のとおり

## 15. オーナーの作業

- developers.tiktok.com で
  1. アプリを作る（Yabumi）。Login Kit と Content Posting API を足す
  2. Content Posting API の設定で、Direct Post を有効にする
  3. リダイレクト URI: `https://yabumi.app/sns/tiktok/callback`（ローカルで試すときは、サンドボックス用に別の URI を足す。localhost を許すかは【未確認】）
  4. URL の所有確認: URL の前半 `https://yabumi.app/tiktok-media/`（Manage URL properties）。規約・ポリシー・Web の URL の所有確認も（docs/review のとおり）
  5. Webhook の URL: `https://yabumi.app/sns/tiktok/webhook`
  6. サンドボックスに、テストのアカウント（オーナーの TikTok）を登録する。そのアカウントを非公開にしておく
- Vercel の環境変数（Production と Preview。値は画面にもログにも出さない）
  - `TIKTOK_CLIENT_KEY`
  - `TIKTOK_CLIENT_SECRET`
  - `TIKTOK_AUDITED`（審査の前は false。審査のあと true）
- ローカルの .env.local にも同じ名前で（サンドボックスの鍵）

## 16. 作る順と、テストの案

| 段 | 作るもの | 確かめ |
|---|---|---|
| 1 | つなぐ・外す・トークンの取り直し（social_accounts・tokens。state） | 結合: state が違うと断る、トークンは本人の行でも利用者の権限で読めない、取り直しの鍵、外すと purge |
| 2 | 写真を渡す入口（tiktok_media_tickets・/tiktok-media/<token>.jpg・1080 に縮める） | 結合: 推測できないトークン（ハッシュだけを持つ）、期限切れ・消えたトークン・他人の配信先の画像・外した画像は 404、3xx を返さない、送り終えたら無効。Vercel で 1 枚縮める時間を測る |
| 3 | 送る画面（3. の 8 つ）と post_targets.tiktok（サーバーだけが書く） | 単体: 公開範囲は選ぶまで送れない、宣伝のスイッチと選択肢、同意の文の出し分け、ブランドコンテンツと「自分だけ」。結合: tiktok 列を利用者の権限で書けない、同意の時刻と指紋はサーバーが決める |
| 4 | 送信のアダプター（写真の直接投稿・status/fetch・is_aigc・上限の扱い） | 単体: fail_reason ごとの扱い、429 のやり直し、spam_risk のやり直さない。偽の TikTok（fetch の差し替え）で、送る → preparing → published |
| 5 | 予約の守り（送る直前の creator_info・指紋） | 単体と結合: 公開範囲が選べなくなった・ニックネームが変わった・文が変わった・投稿できない状態なら failed と要確認 |
| 6 | 下書きの逃げ道・審査の前の帯・（B なら）手で投稿する | 画面（スマホ・PC、明暗） |
| 7 | Webhook（authorization.removed） | 結合: 中身を信じずにこちらから確かめる、何度来ても同じ |
| 8 | 法務の版 | 版と本文のテスト |
| 9 | サンドボックスで本物に送る（オーナーのアカウント・自分だけ） | is_aigc の置き場所、写真の 1080 の上限、PULL_FROM_URL が 3xx なしで取れること |
| 10 | デモ動画を撮って申請 → 審査の間に動画（4.24） | |

- 本物の TikTok に送るのは 9. の段だけで、オーナーの了承を得てからにする（本物の SNS に投稿しない決まり）

## 17. 「TikTok は手で投稿する」

0. の B のとおり、**作るのがおすすめ**。

- X の「手で投稿する」（X_BY_HAND_MESSAGE・isXByHand）と同じ作りにする。送り先の TikTok で「手で投稿する」を選ぶと、予約の時刻に「手で投稿する番」として知らせ、投稿の画面で本文をコピー・画像を保存して、TikTok のアプリから投稿し、記録する
- 審査の前（自分だけにしか出せない間）に、公開で出したい人の逃げ道になる
- 審査のあとも、TikTok のアプリで音楽を付けたい人が使える（下書きの逃げ道と役割が近いので、審査のあとにどちらを残すかは、使われ方を見て決める）

## 18. 作ったもの（段 1〜5。2026-11-14、feat/tiktok）

- 段 1〜2: 11. のとおり。同意の設定は post_targets の列ではなく、別の表 **post_target_tiktok** に置いた（post_targets は画面が `select *` で読むので、列の権限で隠すと読みがすべて止まる。PM の了承）
- 段 3 送る画面: ⑤ 送るに「TikTok に送る内容の確かめ」（src/components/posts/compose/tiktok-panel.tsx）。開くたびに creator_info を読み（getTikTokCreator）、ニックネームと @ の名前、審査の前の帯、送り方（そのまま投稿する／TikTok のアプリで仕上げる。許可のスコープがないほうは押せない）、公開範囲（最初は選んでいない。審査の前は「自分だけ」だけ）、コメント（最初はオフ。TikTok 側で止めていれば押せない）、宣伝の内容（自分のブランド・ブランドコンテンツ。ブランドコンテンツと「自分だけ」は同時に選べない）、TikTok だけの見え方、同意の文（英語の原文とリンク・日本語の添え書き）。タイトル（90 字）は ② 送り先の TikTok の欄
- 保存（savePost）: 画面から受け取るのは選んだもの（posts/schema.ts の tiktok）だけ。サーバーが creator_info を読み直して確かめ（checkTikTokChoice）、いったん下書きで保存してから、同意の記録（writeTikTokConsent）を書き、予約に戻す（記録の前に送信ジョブが取り出さないように。X の手で投稿すると同じ順）。同意の時刻・文の指紋（タイトルと、送信ジョブが送る文 post_target_text の SHA-256）・AI の印・ニックネームはサーバーが決める
- 段 4 送信の部品（src/lib/sns/adapters/tiktok.ts）: preparing の 2 段（startPublish で creator_info → 確かめ → 入口の URL → content/init、continuePublish で status/fetch）。配信先ごとの設定を読むため、startPublish に配信先（PublishTarget: id と、短縮リンクに置き換える前の文）を渡すようにした。入口は送り終えたとき・失敗したときに閉じる。失敗の理由は failureOf で retryable・auth・permanent に分ける
- 段 5 予約の守り: 送る直前に checkBeforeSend（同意がない・公開範囲が選べなくなった・アカウントが変わった・タイトルか説明が変わった → 送らずに失敗にする）。投稿できない状態（CANNOT_POST_CODES）は creator_info の時点で止め、入口も作らない
- テスト: tests/tiktok-publish.test.ts（決まり・送る直前の確かめ・偽の TikTok での送信）、tests/tiktok-media.integration.test.ts（入口・表の権限・同意の記録がサーバーの値で書かれ、指紋が post_target_text と合うこと）
- 段 6（2026-11-15）:
  - 「TikTok は手で投稿する」（17.）: X と同じ作り（配信先を failed にし、error_message に決まった文）。文は TS では src/lib/sns/by-hand.ts の BY_HAND_MESSAGE（SNS ごと）、SQL では public.by_hand_message の 1 か所に置き、close_attention はこの関数を読む（20261115090000_tiktok_by_hand。PM の了承）。一致は tests/tiktok-by-hand.integration.test.ts で close_attention の動きから確かめる。mark_manual_target_posted は TikTok の失敗も記録できるようにした。X だけだった判定（isXByHand・NOT_X_BY_HAND_FILTER・markXByHand・手で投稿する番）は、SNS ごとの判定（isByHand・NOT_BY_HAND_FILTER・markByHand）に広げた
  - ⑤ の TikTok の欄の上に「TikTok は手で投稿する」。選ぶとほかの欄を畳み、TikTok には送らない。送信の結果の「TikTok に手で投稿する」は、タイトルと本文のコピー・TikTok のアプリでの手順・記録（写真の投稿をウェブで開く窓口はない）
  - 手で投稿する SNS だけ（note・Substack と、手で投稿すると選んだ X・TikTok）なら、今すぐ送るは押せない（画面と savePost の両方。前は X だけを手で投稿にすると、送り先が空の確かめが出た）
  - 下書きの逃げ道（8.）: 送信の結果で、TikTok の URL のない送信は「送信」と書き、受信箱の通知から仕上げることと、取り消しは TikTok のアプリからであることを出す（TikTok の API では投稿を消せない）
  - 1 日の上限（7.）は、送り方の下に「1 日 15 本ほどまで（ほかのアプリの分も含む）」と出す。数えて止めるのは TikTok の答え（spam_risk_too_many_posts）に任せる（ほかのアプリの分はこちらから数えられないため）

- 段 7（2026-11-15）: /sns/tiktok/webhook（src/lib/sns/tiktok/webhook.ts）。署名（TikTok-Signature、5 分）が合わなければ 401。authorization.removed だけを扱い、届いた open_id のアカウントごとに、こちらのトークンでユーザー情報を読み、使えなくなっていたアカウントだけを revokeAccountsByIds で外す（トークンを消し、purgeSnsDataOf）。同じ open_id を別の利用者がつないでいても、確かめはアカウントごと。外したアカウントは見ないので、何度届いても同じ。確かめが TikTok の障害でできないときは 500（やり直してもらう）。Webhook と /tiktok-media は、ログインなしで届くパス（src/lib/supabase/public-paths.ts）に足した（ログインへの 3xx を返さない）。/sns/deletion は Meta のデータ削除の通知に返すページなので、TikTok は足さない（TikTok にはデータ削除の通知がない。外したとき・退会で消える）
- 段 8（2026-11-15）: 法務の ② の版（docs/legal.md の「案: TikTok の連携」）。プライバシーポリシーと利用規約の本文、LEGAL_VERSIONS の 2026-11-30【仮】。オーナーの了承まで本番に出さない

## 作る前に確かめること（読めなかった資料）

2026-11-14 に PM が公式の資料で確かめたもの（下の「確かめた窓口」）を除き、残りは次のとおり。

- is_aigc の置き場所（写真と動画で違うか）。サンドボックスで確かめる
- 宣伝のスイッチ（brand_content_toggle・brand_organic_toggle）が必須か
- photo_cover_index が範囲の外のときの扱い
- サンドボックスでのリダイレクト URI に localhost を使えるか

## 確かめた窓口（2026-11-14、PM が公式の資料で確かめた）

- トークンを取る: POST https://open.tiktokapis.com/v2/oauth/token/（x-www-form-urlencoded。client_key・client_secret・code（URL デコード済み）・grant_type=authorization_code・redirect_uri（認可のときと同じ））。code_verifier はモバイル・デスクトップのときだけで、Web では要らない（[Get a user access token](https://developers.tiktok.com/doc/oauth-get-a-user-access-token)）
- 取り直す: 同じ URL で grant_type=refresh_token。毎回新しいリフレッシュトークンが返るので入れ替える。古いものを使うと以後の取り直しが失敗し、つなぎ直しが要る（並んで取り直さないよう鍵を付ける）
- 取り消す: POST https://open.tiktokapis.com/v2/oauth/revoke/（client_key・client_secret・token）。成功は空の本文、失敗は error・error_description・log_id
- ユーザー情報: GET https://open.tiktokapis.com/v2/user/info/?fields=...（Bearer）。user.info.basic で読めるのは open_id・union_id・avatar_url・avatar_url_100・avatar_large_url・display_name。username は user.info.profile のスコープなので申請せず、creator_info から読む。資料に「この API は移行の予定がある」と注意書きがある
- 期限: いまの資料ではアクセス 2 時間・リフレッシュ 180 日（[Manage User Access Tokens](https://developers.tiktok.com/doc/oauth-user-access-token-management)）。expires_in・refresh_expires_in を使う作りのまま。アクセスが 2 時間なので、送る直前にも期限を見て取り直す
- Webhook の署名: ヘッダー TikTok-Signature: t=<時刻>,s=<hex>。署名する文字列は「t の文字列 + "." + 受け取った本文（生のまま）」、HMAC-SHA256、鍵は client_secret。比べるときは timingSafeEqual。t と今の差の許容は資料にないので 5 分にする。署名が合っても中身は信じず、こちらから確かめる（[Webhooks verification](https://developers.tiktok.com/doc/webhooks-verification)）
