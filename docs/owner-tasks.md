# オーナーの作業リスト（環境変数・外部サービスの設定）

- **作成日**: 2026-11-21（オーナーの依頼「環境変数の更新などは、後でまとめてやるので、タスクリストとして整理しておいて」）
- **使い方**: 本番にデプロイするときに、オーナーがまとめて進める。済んだら「状態」を「済」にして日付を書く。細かい手順は docs/deploy.md の番号の行にある
- **状態**: 「まだ」は PM の知るかぎり済んでいないもの。「要確認」は、済んでいるかを PM が本番の画面や値から確かめられないもの（オーナーが Vercel・各サービスの画面で確かめる）
- 値はパスワード管理アプリに控え、チャット・リポジトリ・メモに貼らない。Vercel の Environment は、ことわりがなければ **Production と Preview**、鍵は **Sensitive**。入れたら Redeploy する

## 1. いちばん先にやるもの

| # | やること | 元の手順 | 状態 |
|---|---|---|---|
| 1-1 | Vercel の **Preview** の環境変数に、本番の Supabase の鍵（SUPABASE_SECRET_KEY など）が入っていないかを見る。入っていれば Preview からは外す（Preview は本番の DB を触れないようにする） | — | 要確認 |
| 1-2 | yabumi を開いて、規約の同意の帯で同意する（版 2026-11-21） | — | まだ |

## 2. 自動投稿を動かす

| # | やること | 元の手順 | 状態 |
|---|---|---|---|
| 2-1 | Anthropic の Console で、使いすぎの上限（Limits）を **$25 ほど**に上げる（自動投稿の文 $3・画像の場面・ほかの AI を合わせた目安） | 6-3 | まだ |
| 2-2 | Vercel の **Production だけ**に `AUTO_POST_ENABLED=true` を足して Redeploy（Preview には入れない）。止めるときは値を消すか false にして Redeploy | 31-4 | まだ |
| 2-3 | X の費用の上限: `X_POST_USER_MONTHLY_USD=8`・`X_MONTHLY_BUDGET_USD=10` が入っているか | — | 要確認 |

## 3. ストアと課金をつなぐ（App Store・RevenueCat・Google Play）

| # | やること | 元の手順 | 状態 |
|---|---|---|---|
| 3-1 | `openssl rand -base64 32` で新しい値を作り、`CREDENTIAL_ENCRYPTION_KEY` として入れる（TOKEN_ENCRYPTION_KEY とは別の値）。入れると「ストアと課金をつなぐ」に入力の欄が出る | 13-1〜13-3 | まだ |
| 3-2 | App Store Connect で、役割が **Sales and Reports** の Team キーを作り、yabumi の「ストアと課金をつなぐ」に入れる | 13-8〜13-9 | まだ |
| 3-3 | RevenueCat を使うなら、Charts & metrics だけを読めるキーを作って入れる | 13-10 | まだ |
| 3-4 | Google Cloud で yabumi 用のサービスアカウント（yabumi-manager）を作り、キーの JSON を `GOOGLE_PLAY_MANAGER_KEY` として入れる。手順が長いので、やるときは PM と一緒に進める | 15-1〜15-6 | まだ |

## 4. SNS の数字・コメント

| # | やること | 元の手順 | 状態 |
|---|---|---|---|
| 4-1 | Meta の画面で、数字を読む権限（threads_manage_insights・instagram_business_manage_insights・read_insights）を足す | 14-1〜14-2 | 要確認 |
| 4-2 | `SNS_INSIGHTS`（例 `threads,instagram,facebook`）を入れて、SNS をつなぎ直す。**X を入れるかは、X の規約の見直し（launch-checklist の 1.3）が済むまで保留**（docs/review/x.md） | 14-3〜14-4 | 要確認 |
| 4-3 | Meta の画面で、コメントを読む権限（threads_read_replies・instagram_business_manage_comments・pages_read_user_content）を足す | 28-2〜28-3 | 要確認 |
| 4-4 | `SNS_COMMENTS`（例 `threads,instagram,facebook`）を入れて、SNS をつなぎ直す | 28-4〜28-5 | 要確認 |

## 5. AI の画像（Gemini）

| # | やること | 元の手順 | 状態 |
|---|---|---|---|
| 5-1 | 画像用の Google Cloud のプロジェクト・請求先・予算（月 1,500 円）・割り当て（1 日 200 回）を用意し、`GEMINI_API_KEY` を入れる。いま本番で AI の画像が作れているなら済 | 24-1〜24-6 | 要確認 |
| 5-2 | 予算は、自動投稿の画像の分（全体で月 $3）が足されたので、月 2,000 円ほどに上げるかを決める | — | まだ |

## 6. SNS を足す

| # | やること | 元の手順 | 状態 |
|---|---|---|---|
| 6-1 | Facebook・Instagram のアプリの設定と、`META_APP_ID`・`META_APP_SECRET`・`FACEBOOK_LOGIN_CONFIG_ID`・`INSTAGRAM_APP_ID`・`INSTAGRAM_APP_SECRET`（Instagram は済んでいるので、Facebook ページの分） | 12-1〜12-6 | 要確認 |
| 6-2 | TikTok のアプリの設定と環境変数 | deploy.md の TikTok の節 | まだ |
| 6-3 | YouTube: Search Console・Google Cloud・OAuth クライアントを用意し、`YOUTUBE_CLIENT_ID`・`YOUTUBE_CLIENT_SECRET` を入れて、YouTube をつなぐ | 30-2〜30-7 | まだ |
| 6-4 | X の人気の投稿を探す: `X_BEARER_TOKEN` を入れる | 26-2〜26-3 | 要確認 |

## 7. 本番で試すもの

| # | やること | 元の手順 | 状態 |
|---|---|---|---|
| 7-1 | Supabase → Storage の「Upload file size limit」が 50MB 以上で、post-videos のバケットが Public オフであることを見る | 29-2 | まだ |
| 7-2 | X の動画の試し（~/Desktop/yabumi-sns-trial の 3 本で、Threads・Instagram・X に送る）。終わったら PM に伝える。PM が X に動画を送れない状態（trial/x-video-off）に戻して出す | 29-5 | まだ |

## 8. 決めること（PM から聞いているもの）

| # | 決めること | 状態 |
|---|---|---|
| 8-1 | 画面に出している AI・X の料金を、誰が払うか（月額のプランに含めて回数で見せる／使った分を別に請求して円で見せる） | まだ |
