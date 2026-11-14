# SNS のコメントに気付く（段階 A）

オーナーの要望「SNS に投稿した内容に、コメントやいいねが付いたかを yabumi で見られるようにしたい。コメントがあれば返信したいので、少なくとも気付けるようにしたい」（2026-11-14、PM の依頼）。調査と段階の案は PM に送り、オーナーが 2026-11-14 に次の 5 つを了承した。

1. 段階 A（Threads・Instagram・Facebook のコメントに気付く）で始める
2. 通知はスマホの 1 日 1 回のまとめだけ。メールはなし
3. コメントの保存は 30 日。SNS を外したとき・投稿を取り消したとき・退会したときは、すぐ消す
4. X は中身を読まず、返信の数だけ
5. 法務は ②。noticeWaived（いまの利用者はオーナーだけ）で、本番に出す日から施行する

後の段階（このメモでは作らない）: B は X の返信の中身を読む（1 人 月 約 $1.35）。C は yabumi から返信する。D は webhook に切り替える（Meta のアプリの Live とビジネス認証のあと）。

公式の資料（2026-11-14 に読んだ。本物の API は呼んでいない）で確かめられなかったものは【未確認】と書く。実装の最初に、オーナーの開発モードのアカウントで 1 回ずつ呼んで確かめる（PM の了承を得てから）。

## 1. 何をするか

- 3 時間ごとのジョブが、yabumi から送った Threads・Instagram・Facebook の投稿のうち、**送ってから 7 日以内**のものについて、コメントを読みに行って保存する
- 新しいコメント（自分のものを除き、まだ見ていないもの）を、概要の帯・コメントの画面・投稿の画面に出す。返信は「SNS で開いて返信する」で SNS の画面に行って行う
- 1 日 1 回（19:00）、新しいコメントがあれば、スマホにまとめの通知を送る
- X は新しく読まない。毎日の数字の取り込み（4.22。SNS_INSIGHTS に x があるとき）で取っている返信の数（reply_count）と、いいねの数を出す。費用は増えない
- いいねは、毎日の数字の取り込み（post_metrics）の最新の値を出す。Instagram は、コメントを読むときに like_count も一緒に取れるので、それで新しくする

## 2. 権限（scope）

| SNS | 足す権限 | 読むもの | 審査 |
|---|---|---|---|
| Threads | `threads_read_replies` | `GET /{media-id}/conversation`（返信への返信も含む） | 要る（他の人に使ってもらうとき） |
| Instagram（Instagram ログイン） | `instagram_business_manage_comments` | `GET /{ig-media-id}?fields=like_count,comments_count` と `GET /{ig-media-id}/comments?fields=id,text,timestamp,username,from,replies{...}` | 要る（Advanced Access。権限ごとの英語の画面の録画） |
| Facebook ページ | `pages_read_user_content`【未確認: 他の人のコメントを読むのに、今の pages_read_engagement で足りるか。足りなければこれを足す】 | `GET /{post-id}/comments?filter=stream&fields=id,message,created_time,from{name}` | 要る |

- 数字の権限（4.22 の SNS_INSIGHTS）と同じ作りにする。環境変数 `SNS_COMMENTS`（例 `threads,instagram,facebook`）に入れた SNS だけ、つなぐときにこの権限を求める。Meta のアプリの側で権限を先に足してから入れる（逆にすると、つなぐ画面がエラーになる）。src/lib/sns/insights/scopes.ts と同じ形で `COMMENTS_SCOPE`・`withCommentsScope`・`hasCommentsScope` を作る
- 読むのは、その権限つきでつないだアカウントだけ（social_accounts.scopes で確かめる）
- 開発モードのいまは、オーナー（Tester）がつなぎ直せばすぐ使える。他の人に使ってもらうには、出す予定の Meta の審査（docs/review/meta.md）に、この権限も加える。審査の録画の手順は、実装のときに docs/review/meta.md に足す
- X は権限を変えない（中身を読まないため）

### つなぎ直しの案内

- 権限が足りないアカウントがあるとき、概要（新しいコメントの帯の場所）とコメントの画面に「● 要確認　Threads・Instagram のコメントを見るには、つなぎ直しが要ります。つないだ SNS へ」と「?」を出す（分析の画面の「数字の権限」と同じ形。見本 1）
- 「?」の中: 「コメントを読む権限は、あとから足した権限です。つなぎ直すと、SNS の画面でコメントを読む権限を許可できます。」
- 出すのは、SNS_COMMENTS に入っている SNS で、そのプロジェクトにつないだアカウントだけ。プロジェクトの設定の「つないだ SNS」は、いまの「つなぎ直す」をそのまま使う
- オーナーの段取り（deploy.md に足す）: ① Meta のアプリで権限を足す ② Vercel に SNS_COMMENTS を足して Redeploy ③ yabumi で Threads・Instagram・Facebook をつなぎ直す ④ 3 時間以内に、コメントの画面に出ることを確かめる

## 3. 表

### 3.1 sns_comments（読んだコメント）

| 列 | 型 | 中身 |
|---|---|---|
| id | uuid | |
| owner_id | uuid | auth.users、on delete cascade |
| post_target_id | uuid | post_targets、on delete cascade（yabumi の投稿を消したら消える） |
| social_account_id | uuid | social_accounts、on delete cascade（**SNS を外したら消える**） |
| sns | sns_key | threads・instagram・facebook だけ（check） |
| external_id | text | SNS のコメントの ID。unique (post_target_id, external_id) |
| parent_external_id | text null | 返信への返信のとき、親のコメントの ID |
| author_name | text | @名前（Facebook は表示名）。100 字まで |
| body | text | 本文。3,000 字まで（超えたら切って保存） |
| is_own | boolean | 自分（つないだアカウント）が書いたもの。新しいコメントに数えない |
| commented_at | timestamptz | SNS の時刻 |
| fetched_at | timestamptz | 初めて読んだ時刻 |
| seen_at | timestamptz null | 利用者が見た時刻（サーバーが決める） |
| notified_at | timestamptz null | まとめの通知に入れた時刻 |

- 持たないもの: 書いた人の SNS の ID・プロフィール画像・いいねの数。書いた人の ID は、自分のものかを見分けるためにジョブの中で使うだけで、保存しない。プロフィール画像は他社のサーバーの画像を画面で読むことになるので、出さない
- RLS: 本人の行だけ select。**insert・update・delete は authenticated に grant しない**（書くのはジョブの service_role だけ）
- grant: `revoke all ... from anon, authenticated` のあと、`grant select (id, post_target_id, sns, parent_external_id, author_name, body, is_own, commented_at, seen_at) to authenticated`。social_account_id・notified_at・fetched_at は画面に要らないので出さない
- 見たことにする: 関数 `mark_sns_comments_seen(p_project_id uuid, p_post_id uuid default null)`。security definer、`set search_path = ''`、auth.uid() の行だけ、seen_at = now()。public・anon・authenticated・service_role から revoke してから、authenticated に grant する。時刻はクライアントに決めさせない
- 索引: (owner_id, seen_at) where not is_own、(post_target_id, commented_at)

### 3.2 sns_comment_polls（投稿ごとの読みに行く予定）

| 列 | 型 | 中身 |
|---|---|---|
| post_target_id | uuid pk | post_targets、on delete cascade |
| owner_id | uuid | |
| next_check_at | timestamptz | 次に読む時刻 |
| last_checked_at | timestamptz null | |
| last_count | int null | 前に読んだときのコメントの数（Instagram は数が同じなら一覧を読まない） |
| fails | smallint | 続けて失敗した回数（3 回で 12 時間あける。権限がないときは止める） |

- RLS を有効にし、authenticated・anon には何も grant しない（サーバーだけ）
- 行は、ジョブが「送ってから 7 日以内で、まだ行がない投稿」を見つけたときに作る。7 日を過ぎたら消す

### 3.3 notification_prefs に 1 列

- `comment_push text not null default 'daily' check (comment_push in ('daily', 'off'))`。本人が直せる列に足す（いまの grant update の列に加える）

### 3.4 消す

| とき | どう消すか |
|---|---|
| 30 日たった | purge_expired_data に「commented_at が 30 日より前の sns_comments を消す」を足す |
| SNS を外した（yabumi で外す・Meta の「外した」「データを消して」の通知） | social_accounts の行が消えるので、on delete cascade で消える |
| 投稿を取り消した（post_targets.status が deleted になる） | トリガーで、その配信先の sns_comments と sns_comment_polls を消す |
| SNS の側で投稿が消えていた（読みに行って 404・「ない」） | ジョブがその配信先のコメントと予定を消す |
| SNS の側でコメントが消された・隠された | 読みに行ったとき、一覧を最後まで読めた（1 投稿 200 件まで）ら、返ってこなかった行を消す。隠したもの（Threads の hide_status・Instagram の hidden）は保存しない |
| yabumi の投稿を消した | post_target が消えるので、on delete cascade で消える |
| 退会した | owner_id の on delete cascade で消える（退会の削除の順番の確かめに sns_comments を足す） |

## 4. ジョブ

- `/api/jobs/import-sns-comments`（ほかのジョブと同じ CRON_SECRET の確かめ）。pg_cron で **3 時間ごと**: `'15 */3 * * *'`、取り残しを拾うために同じ時の 25 分・35 分にも呼ぶ（読むのは next_check_at が来たものだけなので、重ならない）。maxDuration 60 秒、40 秒で新しいものに手をつけない（sns-import.ts と同じ）
- 読む順: 関数 `sns_comment_due(p_limit int)`（service_role だけ）が、next_check_at が来た配信先を古い順に返す。送ってから 7 日以内・status が published・external_post_id がある・SNS_COMMENTS の SNS・コメントの権限つきのアカウント
- 読む間隔: 送ってから 2 日までは 3 時間ごと、3〜7 日目は 12 時間ごと、7 日を過ぎたら読まない（画面に「投稿から 7 日までのコメントを、3 時間ごとに読みます」と「?」で出す）
- 同時に読むのは 6 本まで。トークンは配信先のアカウントごとに 1 回だけ読む（いまの loadAccount）
- 読んだら upsert（post_target_id, external_id）。新しい行の fetched_at は今。自分のコメントは is_own
- 失敗の扱い:
  - 権限がない（Graph の 10・200〜299・403）: その配信先は止め、画面の「つなぎ直しが要ります」に出す
  - 回数の上限（Graph の 4・17・32・613、Threads の同じもの）: そのアカウントの残りを 6 時間あける。失敗には数えない
  - ほかの失敗: fails を足して、3 回で 12 時間あける
- コメントの本文は、ログ・エラーのメール・Sentry に出さない（件数と状態の番号だけ）

### 4.1 SNS の回数の上限と、利用者が増えたときの見込み

- Meta の上限【未確認。公式の式】: Instagram と Facebook ページは、アカウントごとに 24 時間で「4,800 × インプレッション数」ほど（Business Use Case の上限）。Threads もアカウントごと。どれも、利用者のアカウントごとに数える
- yabumi が 1 アカウントに使う回数（1 日。1 日 2 本送る人）: 2 日以内の投稿 4 本 × 8 回 ＋ 3〜7 日目の 10 本 × 2 回 ＝ 52 回。Instagram は数を見てから一覧を読むので、多くて約 100 回。上限よりずっと少ない
- 1 回のジョブで読む数: 1 人あたり、SNS 1 つで 5〜6 本。

| 利用者 | 1 回のジョブで読む数（SNS 2 つ） | 時間の目安（6 本同時・1 本 0.5 秒） |
|---|---|---|
| 10 人 | 約 120 | 約 10 秒 |
| 100 人 | 約 1,200 | 約 100 秒（25 分・35 分の回で読み終える） |
| 300 人 | 約 3,600 | 約 300 秒（3 回の呼び出しでは足りない） |

- 300 人を超える前に、D（webhook。Meta のアプリの Live とビジネス認証が要る）に切り替えるか、呼び出しを 10 分おきに増やす。roadmap.md に、この目安を書く
- 費用: Meta の API は無料。Vercel の関数の時間が増えるだけ（100 人で 1 日 8 回 × 約 2 分）

## 5. 通知（1 日 1 回のまとめ）

- 19:00（日本時間）のジョブ（`/api/jobs/comment-digest`、`'0 10 * * *'`）。comment_push が daily で、スマホの通知の宛先がある利用者だけ
- 中身は、notified_at が空で、自分のものでなく、まだ見ていない新しいコメントの件数。0 件なら送らない。送ったら notified_at を入れる（同じものを 2 度知らせない）
- 題: 「新しいコメント 3 件」。本文: 「こむぎ日和: Threads 2・Instagram 1」（プロジェクトが 2 つ以上なら「ほか 1 つのプロジェクト」）。押すとコメントの画面（いちばん多いプロジェクト）
- **コメントの本文と、書いた人の名前は通知に入れない**（push のサービスに他の人の文を送らない）
- メールは送らない（オーナーの決定 ②）。お知らせの設定に「コメントのまとめ（スマホ・1 日 1 回）　受け取る／受け取らない」の 1 行を足す（見本 4）

## 6. 画面

見本: スマホ 390 と PC 1280 で、本物の部品で組んだ仮のページを撮った（コミットしない）。並びと文言の案。

1. **概要**: いまやることの帯・要確認の下に、新しいコメントがあるときだけ 1 行の帯「● 新しいコメント 3　Threads 2・Instagram 1　［コメントを見る］」。印の色は要確認と同じ signal（「新しい」の印。ボタンは藍の secondary）。つなぎ直しが要るときは、帯の代わりに要確認の 1 行
2. **コメントの画面**（`/projects/[id]/comments`）: 見出し「コメント」＋「?」、添え書き「直近 30 日・新しい n 件」。SNS の絞り込みのチップ。投稿ごとのカード（SNS の印・投稿の見出し・送った日・いいね・コメントの数、コメントを古い順、返信への返信は字下げ、自分のものに「あなた」、新しいものに「● 新しい」、カードの下に「Threads で開いて返信する ↗」）。X の投稿は、数だけの 1 行のカード（「返信 5（+2）・いいね 18」と「X で開く ↗」。+2 は前に見たときからの増え）。並びは、新しいコメントのある投稿が上、あとは送った日の新しい順
3. **投稿の画面**: 数字の下に「コメント」のカード（その投稿の分。見本 3）
4. **入口**: 概要の帯（新しいものがあるとき）、通知、投稿の画面、投稿の一覧の見出しの右に「コメント」のリンク
5. 見たことにする: コメントの画面・投稿の画面を開いて表示したあと、画面から mark_sns_comments_seen を呼ぶ（表示した回は「● 新しい」が出て、次に開いたときに消える）
6. 本文は文字のまま出す（React がエスケープする。リンクにしない。3 行で切り、押すと全部出す）。書いた人の名前もリンクにしない（なりすましの URL に誘わないため）

## 7. AI に送るか

- **送らない**。コメントの本文・書いた人の名前は、AI と相談・振り返り・ネタ出し・AI っぽさチェックなど、どの AI の指示文にも入れない。sns_comments を読むのは、コメントの画面・投稿の画面・まとめの通知の件数だけにする
- 確かめ方: AI の指示文を組み立てるファイル（src/lib/ai/）から sns_comments を読んでいないことを、テストで確かめる（ファイルの中身に `sns_comments` がないこと）
- 後の段階で「返信の下書きを AI が書く」を作るときは、新しい送り先になるので、あらためて法務の ② にする

## 8. 法務（②。オーナー了承済み、noticeWaived）

- プライバシーポリシーに足す: 「つないだ SNS の、yabumi から送った投稿に付いたコメント（書いた人の名前・本文・日時）を、投稿から 7 日まで読み、30 日保存する。SNS を外したとき・投稿を取り消したとき・退会したときは、すぐ消す。AI には送らない。スマホの通知には件数だけを入れる」。預かる情報の表（architecture.md の 4.x の表）にも 1 行足す
- docs/legal.md に「SNS のコメントに気付く」の版を記録し、LEGAL_VERSIONS に版を足す（施行日は本番に出す日に PM が合わせる）
- SNS の規約の決まり:
  - Meta（Platform Terms 2026-02-03）: 目的がなくなったら消す（30 日・7 日の範囲）、利用者が求めたら消す（外す・データの削除の通知・退会）、売らない・人物像を作らない（書いた人の ID を持たない、AI に送らない）
  - SNS の側で消された・隠されたコメントは、次に読んだときに消す（3.4）
- 審査: 権限ごとの説明文と録画を docs/review/meta.md に足す（実装のとき）

## 9. テスト

- 結合テスト（tests/）: 他人の sns_comments・sns_comment_polls が読めない、authenticated から insert・update・delete できない、出していない列（social_account_id・notified_at・fetched_at）を select できない、mark_sns_comments_seen は自分の行だけを変え、anon は呼べない、SNS を外す・取り消す・投稿を消す・退会で消える、30 日で purge される、due の関数が authenticated から呼べない
- 単体テスト: SNS ごとの返事の読み方（自分のもの・返信への返信・隠したもの・字数の上限）、間隔の決め方、失敗の分け方、まとめの通知の中身（本文と名前を入れない）、AI のファイルが sns_comments を読まない
- 画面: 見本どおりに、スマホ 390 と PC で前後を撮る（コメントはテスト用の利用者に入れる。PM の了承を得てから）

## 9.5 作ってみて変えたこと（2026-11-14、実装のとき）

- 見たことにするのは、server action ではなく POST /api/comments/seen（JSON だけ）にした。action のあとに画面が読み直され、表示したその回の「● 新しい」が消えたため。さらに、投稿の画面ではほかの処理（X の確かめ）が画面を読み直すことがあるので、見てから 10 分は「● 新しい」を残す（概要の帯は、まだ見ていないものだけを数える）
- 投稿の一覧の画面はないので、入口は概要の帯と More の「Comments コメント」の 2 か所（PM の了承）
- X の「返信 5（+2）」の「+2」は出さない（X の返信の数は毎日の数字の取り込みの値で、「前に見たとき」の数を持っていないため。持つと表と書き込みが増える）
- 「新しいコメント」の帯は、朱は「●」だけにし、文字はふつうの色（PM の指示）
- 書いた人の名前がないとき（Facebook で from が返らないとき）は「（名前なし）」と出す
- 返信への返信は、親の真下に並べ替えず、古い順のまま字下げで見分ける（SNS のコメントの ID は画面に出さない列のため）

## 10. 作る順（1 つのブランチ、PM の確認ごとに区切ってもよい）

1. マイグレーション（表・関数・トリガー・purge・pg_cron）と結合テスト
2. 読み方（SNS ごと）とジョブ、単体テスト
3. 画面（概要の帯・コメントの画面・投稿の画面・お知らせの設定）
4. まとめの通知
5. 法務の書き足し・architecture.md の 4.x・deploy.md の段取り・review/meta.md
6. PM の了承を得て、オーナーの開発モードのアカウントで本物の API を 1 回ずつ呼び、【未確認】のところを確かめて直す
