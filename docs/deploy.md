# yabumi を本番に公開する手順

- **作成日**: 2026-10-04
- **目的**: オーナーが自分で毎日使うための公開（他の人への提供はフェーズ 7）
- **構成**: Supabase Free（DB・ログイン）+ Vercel Hobby（画面と API）。どちらも無料。仕組みと判断の理由は [architecture.md の 4.11](architecture.md)
- **表の見方**: 「オーナー」はブラウザで行う作業、「Claude」は Claude Code がコマンドで行える作業（オーナーがログインや指示をしたあと）

本番の URL は、ここでは `https://yabumi-xxxx.vercel.app` と書く。Vercel のプロジェクトを作ると決まるので、決まったら置き換える。

## 0. 先に用意するもの

| # | 誰が | やること |
|---|---|---|
| 0-1 | オーナー | GitHub に**非公開**のリポジトリを作る（例: `ikunaga/yabumi`）。README などは作らず、空のまま |
| 0-2 | オーナー | [Supabase](https://supabase.com) のアカウントを作る（GitHub でログインできる） |
| 0-3 | オーナー | [Vercel](https://vercel.com) のアカウントを作る（GitHub でログインする。プランは Hobby） |
| 0-4 | オーナー | 次の値を新しく作って、パスワード管理アプリなどに控える（ローカルとは**別の値**にする）。ターミナルで `openssl rand -base64 32`（TOKEN_ENCRYPTION_KEY）と `openssl rand -hex 32`（CRON_SECRET）。Supabase の DB のパスワードもここで決める |

## 1. コードを GitHub に上げる

| # | 誰が | やること |
|---|---|---|
| 1-1 | Claude | オーナーの指示があったら、`git remote add origin git@github.com:ikunaga/yabumi.git` と `git push -u origin main` を行う。上げる前に、.env.local・証明書（certificates/）・.pem が入っていないことを確かめる |

## 2. Supabase（本番の DB）

| # | 誰が | やること |
|---|---|---|
| 2-1 | オーナー | Supabase で「New project」。名前 `yabumi`、Region は **Northeast Asia (Tokyo)**、DB のパスワードは 0-4 で決めたもの。プランは Free |
| 2-2 | オーナー | できたら、Project Settings → General の **Project ID**（project ref）と、Project Settings → API Keys の **Publishable key** と **Secret key**、Data API の **Project URL** を控える |
| 2-3 | オーナー | ターミナルで `! supabase login` を実行する（ブラウザでログインする。Claude Code の入力欄で `!` を付けて打つ） |
| 2-4 | Claude | `supabase link --project-ref <Project ID>`（DB のパスワードを聞かれたらオーナーが入れる） |
| 2-5 | Claude | `supabase db push --dry-run` で当てるマイグレーションの一覧を確かめ、問題がなければ `supabase db push`。**`supabase db reset` は本番では絶対に使わない**（全データが消える）。seed.sql（テスト用アカウント）は本番には入れない（`--include-seed` を付けない） |
| 2-6 | Claude | 当たったことを確かめる: `supabase migration list` で、ローカルと本番の列がそろっていること |

## 3. Vercel（画面と API）

| # | 誰が | やること |
|---|---|---|
| 3-1 | オーナー | Vercel で「Add New → Project」→ GitHub の `ikunaga/yabumi` を Import。Framework は Next.js（自動）、Root Directory はそのまま、Build Command もそのまま（`pnpm build`） |
| 3-2 | オーナー | Import の画面の Environment Variables に、下の「4. 環境変数」のうち **APP_URL 以外**を入れて Deploy（APP_URL は URL が決まってから入れる） |
| 3-3 | オーナー | デプロイが終わったら、Project → Settings → Domains に出る `yabumi-xxxx.vercel.app`（Production の URL）を控える。以後、この URL を本番の URL とする |
| 3-4 | オーナー | Settings → Environment Variables に `APP_URL=https://yabumi-xxxx.vercel.app` を足し、Deployments → 最新の … → Redeploy |
| 3-5 | オーナー | Settings → Deployment Protection は既定（Standard Protection）のままにする。本番の URL には保護がかからない（Supabase からの予約ジョブと、Threads・GitHub からの戻り先が届くため）。「All Deployments」に変えないこと |
| 3-6 | 確認 | Settings → Functions の Region が **Tokyo (hnd1)** になっている（リポジトリの vercel.json で指定済み。Supabase と同じ東京にして、待ち時間を減らす） |

## 4. 環境変数

### Vercel に入れるもの（Settings → Environment Variables。Environment は Production と Preview）

「Sensitive」にすると、あとから画面で値が見えなくなる。秘密の値は Sensitive にする。

| 変数 | 値 | Sensitive |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | 2-2 の Project URL | いいえ（画面にも出る値） |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 2-2 の Publishable key | いいえ（画面にも出る値） |
| SUPABASE_SECRET_KEY | 2-2 の Secret key | **はい** |
| APP_URL | `https://yabumi-xxxx.vercel.app`（3-3 のあと） | いいえ |
| ALLOWED_SIGNUP_EMAILS | 空（値なし）。新規登録を閉じる | いいえ |
| TOKEN_ENCRYPTION_KEY | 0-4 で新しく作った値（ローカルとは別） | **はい** |
| NEXT_SERVER_ACTIONS_ENCRYPTION_KEY | 23 で新しく作った値（出し直しても、開いたままの画面の保存や送信を止めないため） | **はい** |
| CRON_SECRET | 0-4 で新しく作った値（ローカルとは別。5-2 の Vault にも同じ値） | **はい** |
| THREADS_APP_ID | Meta の Yabumi Dev の App ID（ローカルと同じ） | いいえ |
| THREADS_APP_SECRET | Meta の Yabumi Dev の App secret（ローカルと同じ） | **はい** |
| ANTHROPIC_API_KEY | 6-3 で本番用に作るキー | **はい** |
| X_CLIENT_ID | 6-4 の X のアプリの OAuth 2.0 Client ID（ローカルと同じ） | いいえ |
| X_CLIENT_SECRET | 同じく Client Secret | **はい** |
| X_MONTHLY_BUDGET_USD | 入れなければ $3（決定 D16）。変えるときだけ入れる。80% に達すると運営者にメールで知らせる（15-11 の RESEND_API_KEY・OPERATOR_EMAIL） | いいえ |
| X_POST_USER_MONTHLY_USD | 入れなければ $1（利用者 1 人の、X の投稿まわりの月の上限。docs/architecture.md の 4.13）。料金プランが決まったら変える | いいえ |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY | 5-8 の Turnstile の Site Key（登録の受付を開く前に入れる） | いいえ（画面にも出る値） |
| META_APP_ID / FACEBOOK_LOGIN_CONFIG_ID / INSTAGRAM_APP_ID | 12 の Instagram・Facebook 用の Meta アプリの値 | いいえ |
| VERCEL_API_TOKEN | 17 の Vercel のトークン（利用者のドメインで短縮リンクを作るとき。なければ画面は「準備中」） | **はい** |
| VERCEL_PROJECT_ID / VERCEL_TEAM_ID | 17 の yabumi の Vercel のプロジェクトとチームの ID | いいえ |
| LINK_DOMAIN_LIMIT | 入れなければ 40（利用者のドメインの、yabumi 全体の上限。Vercel Hobby の 50 から yabumi の分を除いた数）。Pro にしたら上げる | いいえ |
| META_APP_SECRET / INSTAGRAM_APP_SECRET | 同上 | **はい** |
| GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_CLIENT_ID | 6-2 で作る本番用の App の値 | いいえ |
| GITHUB_APP_CLIENT_SECRET | 同上 | **はい** |
| GITHUB_APP_PRIVATE_KEY | 同上の .pem の中身。Vercel の入力欄には複数行のまま貼ってよい | **はい** |

- AI の上限（AI_USER_MONTHLY_BUDGET_USD など）は、入れなければ既定値（利用者ごとに月 $3、全体で月 $10）
- 後から入れる値（ANTHROPIC_API_KEY、GITHUB_APP_*、X_CLIENT_*）は、入れるまでその機能が「準備中」になるだけで、他は動く。入れたら Redeploy する
- **TOKEN_ENCRYPTION_KEY は、一度使い始めたら変えない**（変えると、保存した SNS のトークンが読めなくなり、つなぎ直しが要る）

### Supabase に入れるもの

| 場所 | 値 |
|---|---|
| Vault の `app_url` | `https://yabumi-xxxx.vercel.app`（5-2） |
| Vault の `cron_secret` | Vercel の CRON_SECRET と同じ値（5-2） |
| Authentication → URL Configuration | 5-1 |

## 5. 本番の Supabase の設定

| # | 誰が | やること |
|---|---|---|
| 5-1 | オーナー | Authentication → URL Configuration: **Site URL** を `https://yabumi-xxxx.vercel.app`、**Redirect URLs** に `https://yabumi-xxxx.vercel.app/**` を足す |
| 5-2 | オーナー | SQL Editor で次を実行する（予約ジョブの呼び先と合言葉。値は置き換える）<br>`select vault.create_secret('https://yabumi-xxxx.vercel.app', 'app_url');`<br>`select vault.create_secret('<CRON_SECRET の値>', 'cron_secret');` |
| 5-3 | オーナー | Authentication → Users → Add user → Create new user。オーナーのメールアドレスとパスワードを入れ、**Auto Confirm User** にチェックして作る（確認メールなしで使える） |
| 5-4 | オーナー | Authentication → Sign In / Providers（または Settings）→ **Allow new users to sign up** をオフにする。yabumi の画面からも、Supabase の API を直接呼んでも、新しいアカウントは作れなくなる |
| 5-5 | オーナー | Authentication → Sign In / Providers → Email: **Confirm email** をオン（確認メールが済むまでログインできない）。**Minimum password length** を 8 にする（yabumi の画面と同じ） |
| 5-6 | オーナー | Authentication → Emails → Templates: Confirm signup・Reset password・Change email address・Magic link・Invite user の 5 つに、リポジトリの supabase/templates/ の本文（confirmation.html・recovery.html・email_change.html・magic_link.html・invite.html）を貼り、件名を supabase/config.toml の subject と同じにする（「【yabumi】メールアドレスの確認」など） |
| 5-7 | オーナー | **独自の SMTP（登録の受付を開く前に必須）**: Supabase の既定のメールは、プロジェクトのメンバーにしか届かず 1 時間に 2 通まで。ドメインは yabumi.app に決まったので、**11 の F の手順で進める**（以下は一般の流れ）。① 独自ドメインを取る（年 1,500〜2,500 円。お名前.com、Cloudflare Registrar など）② https://resend.com に登録し、Domains でドメインを足して、表示された DNS のレコード（SPF・DKIM）をドメインの管理画面に入れ、Verified になるのを待つ ③ Resend の API Keys で「Sending access」のキーを作る ④ Supabase の Authentication → Emails → SMTP Settings: Enable custom SMTP をオン、Host `smtp.resend.com`、Port `465`、Username `resend`、Password に ③ のキー、Sender email `noreply@<ドメイン>`、Sender name `yabumi` ⑤ Authentication → Rate Limits の「emails sent per hour」が 30 になっていることを確かめる |
| 5-8 | オーナー | **ロボットの確認（登録の受付を開く前に必須）**: ① https://dash.cloudflare.com に登録し、Turnstile → Add widget。Widget name `yabumi`、Hostname に `yabumi.vercel.app`（ローカルで試すなら `localhost` も）、Widget Mode は **Managed** ② 表示された Site Key を Vercel の NEXT_PUBLIC_TURNSTILE_SITE_KEY に入れて Redeploy ③ Secret Key を Supabase の Authentication → Attack Protection（Bot and Abuse Protection）→ Enable Captcha protection をオン、Provider は Turnstile、Secret に貼る。**②の Redeploy が済んでから③をする**（逆だと、確認の欄がないままログインが断られる） |

## 6. 外部サービスに本番の URL を登録する

| # | 誰が | やること |
|---|---|---|
| 6-1 | オーナー | **Threads**: Meta の Yabumi Dev → Use cases → Access the Threads API → Settings に、本番の URL を**ローカルの URL と並べて**足す。Redirect Callback URLs: `https://yabumi-xxxx.vercel.app/sns/threads/callback`、Uninstall Callback URL と Delete Callback URL は 1 つしか入らないので本番のもの（`.../sns/threads/uninstall`、`.../sns/threads/delete`）にする（ローカルでは通知を受けられないため、本番を優先する） |
| 6-2 | オーナー | **GitHub App（本番用）**: ローカル用（yabumi-dev）とは別に、もう 1 つ App を作る。手順は README の「GitHub App」と同じで、URL だけ変える: Homepage URL `https://yabumi-xxxx.vercel.app`、Callback URL `https://yabumi-xxxx.vercel.app/github/callback`。名前は例えば `Yabumi`（重複していれば `Yabumi masa` など）。権限は Contents: Read-only のみ、Webhook はオフ、「Request user authorization (OAuth) during installation」はオン、インストール先は **Only on this account**（いまはオーナー専用。他の人に使ってもらうときに Any account にする）。App ID・slug・Client ID・Client secret・秘密鍵を Vercel の環境変数に入れる |
| 6-3 | オーナー | **Claude API**: Claude Console で本番用のキーを別に作る（名前 `yabumi-prod` など。Workspace を分けるなら `yabumi-prod`）。Limits で月の上限（例: $15）を確かめる。Vercel の ANTHROPIC_API_KEY に入れる |
| 6-4 | オーナー | **X**: README の「X」の手順で作ったアプリの Callback URI に、本番の `https://yabumi-xxxx.vercel.app/sns/x/callback` を**ローカルの URL と並べて**足す。X_CLIENT_ID・X_CLIENT_SECRET を Vercel に入れる |
| 6-5 | オーナー | 入れ終わったら、Vercel で Redeploy |

## 7. 動作の確認

| # | 誰が | 確かめること |
|---|---|---|
| 7-1 | オーナー | `https://yabumi-xxxx.vercel.app` を開き、5-3 のアカウントでログインできる。新規登録の画面で別のメールを入れると「いまは招待した方だけが登録できます。」と出る |
| 7-2 | オーナー | プロジェクトを作る（本番の DB は空なので、ローカルのデータは入っていない） |
| 7-3 | オーナー | プロジェクトの設定の「つないだ SNS」→ Threads の「つなぐ」→ @masa_i82 で許可 →「✓ @masa_i82」になる |
| 7-4 | オーナー | 投稿をつくる → Threads だけを選んで「今すぐ送る」→ 送信の結果に「Threads で見る」が出る。テストの投稿は「Threads から取り消す」で消せる |
| 7-5 | オーナー | 6 分以上先に予約して、時刻を過ぎて 1〜2 分で「✓ 送信済み」になる（予約ジョブが動いている） |
| 7-6 | Claude | 予約ジョブの記録を確かめる: SQL Editor（または `supabase db` のコマンド）で `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` と `select status_code, content, created from net._http_response order by id desc limit 5;`。status_code が 200 なら届いている |
| 7-7 | オーナー | GitHub をつなぐ → リポジトリを選ぶ → 紹介文の下書き（約 $0.25）。アカウント設計の「AI と考える」（AI のキーを入れたあと） |

## 8. 困ったとき

| 症状 | 見るところ・やること |
|---|---|
| 概要の「要確認」に「予約時刻を過ぎても送られていない投稿があります」と出る | 予約ジョブが止まっている。① Supabase の SQL Editor で 7-6 を見る（ジョブが失敗していないか、status_code が 401 なら CRON_SECRET と Vault の cron_secret が違う）② Vault の app_url が本番の URL か ③ Vercel のデプロイが失敗していないか。動き出せば自動で送られる |
| Supabase から「プロジェクトを一時停止する」というメールが来た | 1 週間ほど使われていないとき。ダッシュボードを開くか、yabumi にログインすれば止まらない。止まってしまったら、ダッシュボードの「Restore」で戻せる（1 年以内）。止まっている間は予約が送られないので、戻したあと「要確認」を見る |
| 画面にエラーが出る | Vercel → Project → Logs（Hobby では**直近 1 時間**しか残らないので、起きたらすぐ見る）。送信の失敗の理由は、投稿の画面の「送信の結果」にも残る |
| 「準備中」から変わらない | 環境変数が足りない。入れたあと Redeploy したか確かめる |
| Threads をつなぐと失敗する | Meta の Settings の Redirect Callback URLs に本番の URL があるか（6-1）。APP_URL が本番の URL か |

## 9. 費用

| サービス | プラン | 費用 |
|---|---|---|
| Supabase | Free | 0 円（DB 500MB、2 プロジェクトまで） |
| Vercel | Hobby | 0 円（個人・非商用のみ。他の人に提供するときは Pro $20/月が要る） |
| Claude API | 従量 | 使った分。yabumi の上限で月 $10 まで、Console の上限が最後の歯止め |
| Threads API / GitHub API | - | 0 円 |
| 独自ドメイン（yabumi.app） | - | 年 2,000 円前後（Cloudflare Registrar）。2026-10-11 に取ると決めた（11） |
| スマホの通知（Web Push） | - | 0 円（Apple・Google・Mozilla・Microsoft の push サービスは無料。18） |
| 招待の申し込み（LP） | - | 0 円（確認のメールは Resend の無料枠、Turnstile は無料。19） |

## 10. GitHub App を他の人も入れられるようにする（Any account）

6-2 で作った本番用の App（いまの名前は Yabumi-masa、Only on this account）を、他の人も入れられる App にする手順。調べた内容と yabumi の側の対応は [architecture.md の 4.10](architecture.md) の「他の人が入れるとき」。

### 先に済ませること

| # | 誰が | やること |
|---|---|---|
| 10-1 | Claude | マイグレーション 20261011210000_github_repo_access.sql（本人が読めるリポジトリの記録）を本番に当てる（2-5 と同じく `supabase db push`）。**これを当てる前に Any account にしない**（当てる前のコードは、組織や共同作業者のインストールで、本人が読めないリポジトリまで読めてしまう） |
| 10-2 | オーナー | 利用規約とプライバシーポリシーの「確認中」を埋める（[legal.md](legal.md)）。App の紹介ページから yabumi に来た人が読めるように |

### 名前を変える（任意）

| # | 誰が | やること |
|---|---|---|
| 10-3 | オーナー | GitHub → Settings → Developer settings → GitHub Apps → Yabumi-masa → General → **GitHub App name** を変える（例: `Yabumi`。34 文字まで、ほかの App と重ならない名前）。説明（Description）は「yabumi: アプリのリポジトリを読んで、紹介文と SNS の投稿のネタを作ります。読み取りだけで、書き込みはしません。」など。インストールのときに相手に見える |
| 10-4 | オーナー | 名前を変えると、App の URL の名前（slug。名前を小文字にし、空白を `-` にしたもの）も変わる。変えたあと、App の画面の **Public link**（`https://github.com/apps/<slug>`）を開いて、新しい slug を確かめる |
| 10-5 | オーナー | Vercel → Settings → Environment Variables の **GITHUB_APP_SLUG** を新しい slug に変えて、Redeploy する。yabumi の「GitHub をつなぐ」は slug から URL を作るので、変えないとインストールの画面が開かない（古い URL が新しい URL に転送されるかは、GitHub の資料に書かれていない） |
| 10-6 | オーナー | 確かめる: yabumi の GitHub の画面の「読ませるリポジトリを追加・変更する」で、新しい名前の App の画面が開く。App ID と Client ID は変わらない（変わっていたら Vercel の値も直す）。すでに入れているインストールはそのまま使える |

### ロゴ

| # | 誰が | やること |
|---|---|---|
| 10-7 | オーナー | 同じ App の General → **Display information** → 「Upload a logo」で、`src/app/icon.png`（矢のマーク。512×512。2026-10-30 のロゴ、D33）を選ぶ。形式は PNG・JPG・GIF で 1MB 未満、200×200 以上がおすすめ。切り抜きはそのまま（正方形）で「Set new avatar」 |
| 10-8 | オーナー | 出てくる **Badge background color** に `16233d`（ロゴの墨。アイコンの地と同じ）を入れて保存 |

### 公開する

| # | 誰が | やること |
|---|---|---|
| 10-9 | オーナー | 同じ App の **Advanced** → Danger zone → **Make public** を押す。インストール先の設定が「Any account」になり、`https://github.com/apps/<slug>` にインストールのボタンが出る |
| 10-10 | オーナー | 確かめる: 「Permissions & events」が Contents: Read-only と Metadata: Read-only だけ、Webhook がオフ、「Request user authorization (OAuth) during installation」がオン（yabumi が本人の権限を確かめるのに要る） |

- 戻すとき: 他の人がインストールしている間は「Make private」に戻せない（GitHub の決まり）。戻したいときは、先に他の人のインストールが外れている必要がある
- 他の人の組織に入れるには、その組織のオーナーの承認が要る。メンバーが入れようとすると「承認待ち」になり、yabumi の画面には「オーガニゼーションの管理者の承認待ちです」と出る
- 組織や、他の人の個人リポジトリ（共同作業者として）のインストールでは、yabumi は**その人が GitHub で読めるリポジトリだけ**を並べ、読む。読める範囲は 7 日ごとに確かめ直す（GitHub の画面の「連携を読み込み直す」）

出典: [GitHub App を公開・非公開にする](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private)、[GitHub App の登録を変える](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration)、[バッジ（ロゴ）](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/creating-a-custom-badge-for-your-github-app)、[サードパーティの App のインストール](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)（2026-10-11 に確認）

## 11. 独自ドメイン yabumi.app に切り替える（2026-10-11 決定）

yabumi.app は Cloudflare Registrar で取る（オーナー）。DNS も Cloudflare で管理する。切り替えのあいだも、予約の送信と SNS の接続が止まらない順に並べている。**A → B → C → D の順に進め、各段の確認が済んでから次へ**。

### 方針: 入口は yabumi.app の 1 つにし、yabumi.vercel.app からは転送する

- ログインの cookie はホストごとに別なので、入口が 2 つあると「片方でログインしたのに、もう片方ではログインしていない」や、OAuth の戻り先の食い違い（つなぐの途中で state が合わない）が起きる。SNS 各社や GitHub に登録する URL も 1 つに揃えられる
- 転送はアプリ（src/proxy.ts、src/lib/canonical-host.ts）で行う。本番（VERCEL_ENV=production）の `*.vercel.app` で開かれたら、APP_URL へ 308 で転送する。プレビューのデプロイは転送しない
- 外から POST で届くもの（予約ジョブ /api/jobs、Threads のアンインストール・削除の通知）は転送しない。転送に従わない相手があるため、呼び先を新しい URL に変え終わるまで古い URL でも動くようにしている
- 切り替えのあと、利用者は yabumi.app で一度ログインし直す（cookie がホストごとのため）。SNS のつなぎ直しは要らない（トークンは DB にあり、URL に関係しない）

### A. ドメインを Vercel につなぐ（APP_URL はまだ変えない）

| # | 誰が | やること |
|---|---|---|
| A-1 | オーナー | Vercel → Project → Settings → Domains → Add で `yabumi.app` を足す（Environment は Production）。続けて `www.yabumi.app` も足し、「Redirect to yabumi.app」（308）にする |
| A-2 | オーナー | Vercel の画面のカードに出た値を、Cloudflare → yabumi.app → DNS → Records に入れる。`yabumi.app` は **A レコード**（名前 `@`、値はカードの IP。よく見るのは `76.76.21.21` だが、**必ずカードの値**を使う）、`www` は **CNAME**（値はカードのもの）。どちらも **Proxy status を「DNS only」（灰色の雲）** にする（オレンジの雲だと Vercel の証明書の発行を邪魔する） |
| A-3 | オーナー | Vercel の Domains で、2 つとも「Valid Configuration」になり、証明書が出る（数分〜1 時間）。`https://yabumi.app` を開くと yabumi のトップが出る（この時点ではまだ APP_URL が古いので、ログインやつなぐは yabumi.vercel.app のまま使う） |

### B. 新しい URL を、古い URL と**並べて**登録する（止まらないように、先に足す）

| # | 誰が | やること |
|---|---|---|
| B-1 | オーナー | **Supabase**: Authentication → URL Configuration → Redirect URLs に `https://yabumi.app/**` を足す（古いものは残す） |
| B-2 | オーナー | **Threads**: Meta の Yabumi Dev → Use cases → Access the Threads API → Settings → Redirect Callback URLs に `https://yabumi.app/sns/threads/callback` を足す（古いもの・localhost は残す） |
| B-3 | オーナー | **X**: Developer Console → アプリ → User authentication settings → Callback URI に `https://yabumi.app/sns/x/callback` を足す（古いもの・localhost は残す） |
| B-4 | オーナー | **GitHub App（本番用）**: GitHub → Settings → Developer settings → GitHub Apps → 本番の App → General → Callback URL の「Add Callback URL」で `https://yabumi.app/github/callback` を足す（1 つの App に 10 個まで並べられる） |
| B-5 | オーナー | **Turnstile**（入れていれば）: Cloudflare → Turnstile → yabumi → Hostname Management に `yabumi.app` を足す |

### C. 切り替える（この順番で、続けて行う）

| # | 誰が | やること | 止まらない理由 |
|---|---|---|---|
| C-1 | オーナー | Vercel → Settings → Environment Variables の **APP_URL** を `https://yabumi.app` にし、Deployments → 最新の … → **Redeploy** | 新しいデプロイから、OAuth の戻り先・メールのリンク・OGP の URL が yabumi.app になる。B で両方登録してあるので、つなぐは止まらない。古い URL は yabumi.app へ転送される |
| C-2 | オーナー | **Supabase**: Authentication → URL Configuration → **Site URL** を `https://yabumi.app` に | 確認メールと再設定のメールのリンクが yabumi.app になる（テンプレートは {{ .SiteURL }} を使う） |
| C-3 | オーナー | **Supabase**: SQL Editor で、予約ジョブの呼び先を変える<br>`select vault.update_secret((select id from vault.secrets where name = 'app_url'), 'https://yabumi.app');` | 次の 1 分から、予約ジョブが yabumi.app を呼ぶ。古い URL の /api/jobs は転送しないので、変える前の呼び出しもそのまま動く |
| C-4 | オーナー | **Threads**: 同じ Settings の **Uninstall Callback URL** を `https://yabumi.app/sns/threads/uninstall`、**Delete Callback URL** を `https://yabumi.app/sns/threads/delete` に（1 つずつしか入らない） | 古い URL の通知の受け口も転送せずに動くので、切り替えの前後で取りこぼさない |
| C-5 | オーナー | **X**: Website URL を `https://yabumi.app` に。**GitHub App**: Homepage URL を `https://yabumi.app` に | 表示用。動きには関係しない |

### D. 確かめる

| # | 誰が | やること |
|---|---|---|
| D-1 | オーナー | `https://yabumi.vercel.app/projects` を開くと `https://yabumi.app/projects` に移る。yabumi.app でログインできる |
| D-2 | オーナー | プロジェクトの設定の「つないだ SNS」で Threads（と X）の「つなぎ直す」を押し、許可して戻ってくる（戻り先が yabumi.app になっている） |
| D-3 | オーナー | 予約ジョブ: Supabase の SQL Editor で `select status_code, created from net._http_response order by id desc limit 3;` が 200 で、数分おきに増えている |
| D-4 | オーナー | X や Slack に `https://yabumi.app` を貼ると、yabumi のカード（OGP）が出る |
| D-5 | オーナー | ログアウトして「パスワードを忘れた」→ 届いたメールのリンクが `https://yabumi.app/auth/confirm?…` になっている |

### E. 1 週間ほどたったら（任意）

- Threads・X・GitHub App の Callback と、Supabase の Redirect URLs から、古い `yabumi.vercel.app` のものを外す（localhost のものは残す）
- 転送のコードはそのまま残す（古いリンクやブックマークのため）

### F. メールを yabumi.app から送る（Resend。登録の受付を開く前に必須。5-7 の具体的な手順）

| # | 誰が | やること |
|---|---|---|
| F-1 | オーナー | https://resend.com に登録 → Domains → Add Domain で `yabumi.app`（Region は Tokyo（ap-northeast-1）があればそれ） |
| F-2 | オーナー | 「Sign in to Cloudflare」（Domain Connect）を押すと、DNS のレコードを自動で入れてくれる。手で入れるときは、Resend の画面に出る値で、`send` の MX（優先度 10）、`send` の TXT（SPF）、`resend._domainkey` の TXT（DKIM）の 3 つ。どれも **Proxy は DNS only** |
| F-3 | オーナー | Cloudflare の DNS に **DMARC** を足す: 種類 TXT、名前 `_dmarc`、値 `v=DMARC1; p=none; rua=mailto:contact@yuxport.com`（まずは p=none で様子を見る。届かない報告がなければ、数週間後に p=quarantine にしてよい）。報告の宛先が別のドメイン（yuxport.com）なので、yuxport.com の DNS に、種類 TXT、名前 `yabumi.app._report._dmarc`、値 `v=DMARC1` も足す（足さないと報告が届かない。報告が要らなければ `rua=…` を外してもよい） |
| F-4 | オーナー | Resend で Verified になるのを待つ（数分〜数時間）。API Keys → Create API Key（Permission は Sending access、Domain は yabumi.app） |
| F-5 | オーナー | Supabase → Authentication → Emails → SMTP Settings: Enable custom SMTP をオン。Sender email `noreply@yabumi.app`、Sender name `yabumi`、Host `smtp.resend.com`、Port `465`、Username `resend`、Password に F-4 のキー。保存 |
| F-6 | オーナー | Authentication → Rate Limits の「Rate limit for sending emails」が 30（1 時間）になっていることを確かめる |
| F-7 | オーナー | テスト: ログアウトして「パスワードを忘れた」に自分のアドレスを入れる。送信元が「yabumi <noreply@yabumi.app>」で、迷惑メールに入らずに届く |

- 費用: Resend の無料の範囲（月 3,000 通、1 日 100 通）。ドメインの費用は年 1 回（Cloudflare Registrar は卸値で、.app は年 2,000 円前後）

### G. ~~問い合わせ先 contact@yuxport.com を受け取る（Cloudflare Email Routing）~~ 不要になった

- 2026-10-11 オーナーの決定で、問い合わせ先は **contact@yuxport.com** にした。support@yabumi.app は作らず、Cloudflare の Email Routing も使わない（docs/legal.md の L2）
- 規約・ポリシーの問い合わせ先、Meta・X・GitHub などの申請の連絡先、運営者への知らせ（OPERATOR_EMAIL）は contact@yuxport.com を使う
- すでに Email Routing を有効にしていたら、Cloudflare → yabumi.app → Email → Email Routing で無効にし、足された受信用の MX と SPF のレコードを外す（F の `send` のレコードは残す）

### H. 短縮リンクの go.yabumi.app（F07、決定 D20。C のあとならいつでも）

短縮リンクは、go.yabumi.app を足すまでは `https://yabumi.app/go/<コード>` の形で動く（作ったリンクは、あとで go.yabumi.app に変えても、古い形のまま押せる）。

| # | 誰が | やること |
|---|---|---|
| H-1 | オーナー | Vercel → Project → Settings → Domains → Add で `go.yabumi.app`（Environment は Production。転送はしない） |
| H-2 | オーナー | Cloudflare → yabumi.app → DNS → Records に、Vercel のカードに出た値で **CNAME**（名前 `go`、値はカードのもの）。**Proxy status は DNS only**（灰色の雲） |
| H-3 | オーナー | Vercel の Domains で go.yabumi.app が「Valid Configuration」になり、証明書が出るのを待つ |
| H-4 | オーナー | Vercel → Settings → Environment Variables に `SHORT_LINK_BASE_URL=https://go.yabumi.app` を足し、Redeploy。これから作る短縮リンクが go.yabumi.app になる |
| H-5 | オーナー | 確かめる: yabumi の「短縮リンク」の画面で X 用のリンクを作り、スマホで開くと App Store が開く。数字が 1 増える（同じ端末で 10 分以内にもう一度押しても増えない） |

- go.yabumi.app/ だけを開くと、yabumi のトップに移る
- 悪用（yabumi の名前を借りて怪しいサイトへ誘導する）の知らせが contact@yuxport.com に来たら、Supabase の SQL Editor で `update public.short_links set disabled_at = now() where code = '<コード>';` でそのリンクを止める（押すと「使われていません」と出る）。続くようなら、その利用者のアカウントを止める（利用規約の「利用の停止」）

## 12. Instagram と Facebook ページをつなげるようにする（オーナーの作業）

設計は architecture.md の 4.21。Instagram は Instagram Login（Facebook ページがなくてもつなげる。そのかわり、yabumi から投稿を取り消せない）、Facebook はページだけ。Threads のアプリ（Yabumi Dev）とは**別のアプリ**を作る。URL は yabumi.app が前提（切り替える前なら yabumi.vercel.app で読みかえる。11 の B と同じく、両方並べて登録してよい）。

| # | 誰が | やること |
|---|---|---|
| 12-1 | オーナー | **アプリを作る**: https://developers.facebook.com/apps → Create app。名前 `Yabumi`。ユースケースは「Manage messaging & content on Instagram」（Instagram API with Instagram Login）と「Manage everything on your Page」（Facebook ページ）の 2 つを選ぶ。Business portfolio は Threads のアプリと同じもの（ビジネス認証が 1 回で済む） |
| 12-2 | オーナー | **Instagram の設定**: Use cases → Instagram → Customize（API setup with Instagram login）。① Permissions で instagram_business_basic と instagram_business_content_publish を足す（ほかは足さない）② 画面に出る「Instagram app ID」と「Instagram app secret」を控える ③ Set up Instagram business login → Business login settings に、OAuth redirect URIs `https://yabumi.app/sns/instagram/callback` と `https://localhost:3100/sns/instagram/callback`、Deauthorize callback URL `https://yabumi.app/sns/instagram/uninstall`、Data deletion request URL `https://yabumi.app/sns/instagram/delete` |
| 12-3 | オーナー | **Instagram テスター**: App roles → Roles → Add People → 「Instagram Tester」にオーナーの Instagram のユーザー名を入れる。Instagram のアプリ → 設定とアクティビティ → ウェブサイトのアクセス許可 → アプリとウェブサイト →「テスターへの招待」で承認する。オーナーの Instagram は**プロアカウント**（クリエイターかビジネス）にしておく |
| 12-4 | オーナー | **Facebook ページの設定**: Use cases → 「Manage everything on your Page」→ Customize で pages_show_list、pages_read_engagement、pages_manage_posts を足す。左のメニューの Facebook Login for Business → Configurations → Create configuration（名前 `yabumi-pages`、Login variation は General、Access token は **User access token**、Assets は Pages、Permissions は上の 3 つ）→ できた **Configuration ID** を控える。Facebook Login for Business → Settings の Valid OAuth Redirect URIs に `https://yabumi.app/sns/facebook/callback` と `https://localhost:3100/sns/facebook/callback`、Deauthorize callback URL に `https://yabumi.app/sns/facebook/uninstall` |
| 12-5 | オーナー | **基本設定**: App settings → Basic。App domains `yabumi.app`、Privacy policy URL `https://yabumi.app/privacy`、Terms of service URL `https://yabumi.app/terms`、User data deletion は「Data deletion callback URL」で `https://yabumi.app/sns/facebook/delete`、App icon（角印「文」。public/icons/icon-512.png を 1024×1024 にしたもの）、Category は Business and pages、Contact email `contact@yuxport.com`。App ID と App secret を控える。Advanced → **Require App Secret** はオンにしてよい（yabumi は呼び出しに appsecret_proof を付けている） |
| 12-6 | オーナー | **環境変数**: .env.local と Vercel（Production）に入れて、`pnpm dev` の起動し直し・Redeploy。`META_APP_ID`、`META_APP_SECRET`（Sensitive）、`FACEBOOK_LOGIN_CONFIG_ID`、`INSTAGRAM_APP_ID`、`INSTAGRAM_APP_SECRET`（Sensitive）。入れるまで、「つないだ SNS」の Instagram と Facebook は「準備中」 |
| 12-7 | オーナー | **他の人に使ってもらうとき**: docs/review/meta.md の流れで、権限ごとの App Review（説明文と画面の録画）を出し、アプリを Live にする（ビジネス認証は Threads と同じポートフォリオで済む）。開発モードのままでは、アプリの役割を持つ人と Instagram テスターしかつなげない |

### オーナーが確かめる手順（12-6 のあと。本物の投稿になるので、オーナーの操作で）

1. プロジェクトの設定の「つないだ SNS」→ Instagram の「つなぐ」→ 確かめの画面 →「プロアカウントにした・つなぐ」→ Instagram で許可 →「Instagram をつなぎました」と ✓ @ユーザー名
2. 投稿をつくる: 送り先に Instagram、画像を 1 枚（正方形など）添えて「今すぐ送る」→ 送信の結果の「Instagram で見る」で確かめる。取り消しのボタンは出ず、「Instagram のアプリで消す」の案内が出る
3. 縦長すぎる画像（スマホのスクリーンショット）を添えると、作成画面に「画像の縦横比が合いません」と出て送れない
4. Facebook の「つなぐ」→ 確かめの画面 → Facebook で許可（つなぐページにチェック）→ ページが 2 つ以上なら選ぶ画面 →「Facebook ページをつなぎました」
5. Facebook ページに文章だけ・画像つきで送る →「Facebook ページ で見る」→「Facebook ページ から取り消す」で消える
6. 概要の「外す」→ Instagram の側の連携は、Instagram のアプリの設定から外す（案内が出る）


## 13. ストアと課金の取り込み（F07 の段取り ③。App Store Connect と RevenueCat）

利用者が預ける鍵（App Store Connect の API キー、RevenueCat のシークレットキー）は、SNS のトークンとは別の鍵 CREDENTIAL_ENCRYPTION_KEY で暗号化して保存する（architecture.md の 4.22）。

### 鍵を足す（オーナー。最初の 1 回）

| # | 誰が | やること |
|---|---|---|
| 13-1 | オーナー | ターミナルで `openssl rand -base64 32` を実行し、出た値をパスワード管理アプリに控える。**TOKEN_ENCRYPTION_KEY とは別の、新しい値**にする |
| 13-2 | オーナー | Vercel → Settings → Environment Variables に `CREDENTIAL_ENCRYPTION_KEY`（値は 13-1、Environment は Production と Preview、**Sensitive**）を足し、Redeploy |
| 13-3 | 確認 | yabumi の「指標」→「ストアと課金をつなぐ」に、入力の欄が出る（鍵がないと「準備中」と出る） |

- ローカルは .env.local に `CREDENTIAL_ENCRYPTION_KEY=`（本番とは別の値）
- この鍵をなくすと、預かった鍵が読めなくなる。そのときは利用者に「ストアと課金をつなぐ」で入れ直してもらう（取り込んだ数字は残る）

### 鍵を入れ替える（漏れた疑いがあるとき、または定期的に）

| # | 誰が | やること |
|---|---|---|
| 13-4 | オーナー | `openssl rand -base64 32` で新しい鍵を作る |
| 13-5 | オーナー | Vercel で、今の CREDENTIAL_ENCRYPTION_KEY の値を `CREDENTIAL_ENCRYPTION_KEYS_OLD` に移し（すでに値があれば、カンマで後ろに足す）、CREDENTIAL_ENCRYPTION_KEY を新しい鍵にして Redeploy |
| 13-6 | Claude | 毎日の取り込み（3:00〜3:20）で、預かった鍵を使うたびに新しい鍵で暗号化し直す。2 日たったら、SQL Editor で `select count(*) from store_credentials where split_part(secret_sealed, '.', 2) <> '<新しい鍵の印>';` が 0 になったことを確かめる（鍵の印は、新しい鍵の sha256 の先頭 8 桁。`printf '%s' '<新しい鍵>' \| base64 -d \| shasum -a 256 \| cut -c1-8`） |
| 13-7 | オーナー | 0 になったら、Vercel から CREDENTIAL_ENCRYPTION_KEYS_OLD を消して Redeploy |

- 漏れた疑いがあるときは、あわせて利用者に App Store Connect と RevenueCat の側でキーを取り消し、作り直してもらうよう知らせる（yabumi の側の入れ替えだけでは、漏れたキーそのものは使えてしまうため）

### オーナーの ddy で確かめる（13-2 のあと）

| # | 誰が | やること |
|---|---|---|
| 13-8 | オーナー | yabumi で ddy のプロジェクトを開き、「指標」→「ストアと課金をつなぐ」の App Store の案内のとおりに、App Store Connect で**役割が Sales and Reports の Team キー**を作って入れる → 「確かめて保存する」で「使えました」と出る |
| 13-9 | オーナー | すぐに直近の数日分が取り込まれ、「指標」の「ダウンロード」に数字が出る（売上やダウンロードがない日は 0）。App Store Connect の「売上とトレンド」の同じ日の数と見比べる |
| 13-10 | オーナー | RevenueCat を使っていれば、同じように Charts & metrics だけを読めるキーを作って入れる。「課金（売上）」に直近 28 日の売上が出る。RevenueCat の Overview の Revenue と見比べる |
| 13-11 | Claude | 翌日、`select provider, status, last_error, last_imported_day from store_credentials;` で、毎日の取り込みが進んでいることを確かめる（鍵の中身は出さない） |

## 14. SNS の数字（閲覧数・フォロワー）を読めるようにする（F07 の段取り ④）

Threads・Instagram・Facebook の数字を読む権限は、Meta のアプリの側で先に足してから、yabumi で有効にする（yabumi が先に求めると、つなぐ画面がエラーになる）。審査の前は、開発モードの Tester（オーナー）だけで動く。

| # | 誰が | やること |
|---|---|---|
| 14-1 | オーナー | Threads: Meta の Yabumi Dev → Use cases → Access the Threads API → Permissions で **threads_manage_insights** を足す |
| 14-2 | オーナー | Instagram（つないでいれば）: Instagram・Facebook 用のアプリ → Instagram のユースケース → Permissions で **instagram_business_manage_insights** を足す。Facebook ページ: Facebook Login for Business → Configurations → yabumi の設定 → 権限に **read_insights** を足す |
| 14-3 | オーナー | Vercel → Settings → Environment Variables に `SNS_INSIGHTS`（値は 14-1・14-2 で足したものをカンマ区切りで。例 `threads,instagram,facebook`）を足して Redeploy |
| 14-4 | オーナー | yabumi のプロジェクトの設定の「つないだ SNS」で、それぞれ**つなぎ直す**（数字の権限が増えた認可画面が出る）。指標の画面の「● 要確認 … つなぎ直しが要ります」が消える |
| 14-5 | 確認 | 送った投稿があれば、翌日 5:00〜5:50 の取り込みのあと、指標の画面に「投稿の閲覧数」「フォロワーの増え方」「よく見られた投稿」が出る。Claude は `select status_code from net._http_response order by id desc limit 3;` と、`select count(*) from post_metrics;` で取り込みを確かめる |

- 権限を外すときは、先に SNS_INSIGHTS から外して Redeploy し、そのあと Meta のアプリから外す（逆にすると、つなぐ画面がエラーになる）
- **X の数字**（段取り ⑥）: 権限の追加もつなぎ直しも要らない。SNS_INSIGHTS に `x` を足して Redeploy すると、翌日から読む。読むたびに費用がかかる（投稿 1 件 $0.005、フォロワー $0.010）ので、利用者 1 人の月の上限 `X_METRICS_USER_MONTHLY_USD`（既定 1 = $1）と、投稿と共有の X_MONTHLY_BUDGET_USD（既定 $3）の中で読む。Claude は `select operation, count(*), sum(cost_usd) from sns_api_usage where sns = 'x' and created_at >= date_trunc('month', now()) group by 1;` で今月の費用を確かめる
- 他の人に使ってもらうには、その権限の App Review が要る（docs/review/meta.md）

## 15. Google Play の取り込み（F07 の段取り ⑤。オーナーの Google Cloud のプロジェクト）

yabumi は利用者ごとに「読み取り用のサービスアカウント」を作り、利用者がそれを自分の Play Console に招待する（鍵を預からない）。そのために、オーナーの Google アカウントで Google Cloud のプロジェクトを 1 つ作り、yabumi が使う「管理用」のサービスアカウントを置く（決定 D21）。費用はかからない（使うのは IAM と、利用者のバケットの読み取りだけ）。

| # | 誰が | やること |
|---|---|---|
| 15-1 | オーナー | https://console.cloud.google.com を開き、上の「プロジェクトを選択」→「新しいプロジェクト」。名前は `yabumi`、組織は「組織なし」のまま →「作成」。できたプロジェクトを選ぶ |
| 15-2 | オーナー | 左のメニュー →「API とサービス」→「ライブラリ」で、次の 2 つを検索して「有効にする」: **Identity and Access Management (IAM) API**、**IAM Service Account Credentials API**（Cloud Storage の API は最初から有効） |
| 15-3 | オーナー | 「IAM と管理」→「サービス アカウント」→「サービス アカウントを作成」。名前 `yabumi-manager`、説明「yabumi が利用者ごとの読み取り用アカウントを作る」→「作成して続行」 |
| 15-4 | オーナー | 同じ画面の「ロールを選択」で、**サービス アカウント管理者**（Service Account Admin）と、**サービス アカウント トークン作成者**（Service Account Token Creator）の 2 つを付ける →「完了」。ほかのロール（オーナー・編集者など）は付けない |
| 15-5 | オーナー | 作った `yabumi-manager` を開く →「鍵」→「鍵を追加」→「新しい鍵を作成」→ **JSON** →「作成」。JSON のファイルがダウンロードされる（1 回だけ。なくしたら鍵を消して作り直す） |
| 15-6 | オーナー | Vercel → Settings → Environment Variables に `GOOGLE_PLAY_MANAGER_KEY`（値は 15-5 の JSON のファイルの中身をそのまま、Environment は Production と Preview、**Sensitive**）を足して Redeploy。ダウンロードした JSON のファイルは、パスワード管理アプリに入れてからパソコンから消す |
| 15-7 | 確認 | yabumi の「指標」→「ストアと課金をつなぐ」の Google Play に「Google Play をつなぐ」のボタンが出る（鍵がないと「準備中」） |

- 「鍵の作成が無効になっています」（iam.disableServiceAccountKeyCreation）と出たら、組織のあるアカウントで作っている。個人の Google アカウント（組織なし）で 15-1 から作り直す
- 1 つのプロジェクトで作れるサービスアカウントは既定で 100 個（= Google Play をつなげる数）。80 を超えたら、Google Cloud の「IAM と管理」→「割り当て」で上限の引き上げを申請する。yabumi は直近 30 日に作るのを全員で 80 までにしていて、達すると利用者には「混み合っています」と出る。そうなったら、Supabase の play_account_creations で同じ時期に作った数の多い利用者がいないか（登録し直しを繰り返す悪用）を見て、悪用なら止め、そうでなければ Google Cloud の上限を引き上げてから migration で 80 を上げる
- **運営者へのメール（決定 D22）**: 直近 30 日の作成数が 60 と 80（上限）に達したとき、それぞれ 30 日に 1 回だけ、`OPERATOR_EMAIL` にメールが届く（件名は「【yabumi の運営】Google Play のつなぎが…」）。本文は作成数・上限・確かめること（下の「運営者の見方」）だけで、利用者の情報は入らない。しきい値は `PLAY_CAPACITY_NOTIFY_AT`（カンマ区切り、既定 `60,80`）で変えられる。上限の 80 そのものは DB のトリガー（20261011340200）なので、変えるときは migration
- **運営者の見方**（メールが届いたら）: Supabase の SQL Editor で `select owner_id, count(*) from play_account_creations where created_at > now() - interval '30 days' group by 1 order by 2 desc limit 10;` を流す。1 人が何度も作っている・登録し直しを繰り返している（同じ時期に新しい利用者がまとめて作っている）なら悪用として止める。普通に使う人が増えたのなら、Google Cloud の上限を引き上げてから migration で 80 を上げる

| # | 誰が | やること |
|---|---|---|
| 15-11 | オーナー | 11 の F で Resend の API キー（Sending access、yabumi.app）を作ったら、Vercel → Settings → Environment Variables に `RESEND_API_KEY`（**Sensitive**。Supabase の SMTP に入れたものとは別のキーを作ると、片方を消してももう片方が止まらない）と `OPERATOR_EMAIL`（オーナーが受け取るアドレス。規約の問い合わせ先とは別でよい）を足して Redeploy。送信元は `yabumi <noreply@yabumi.app>`（変えるときは `OPERATOR_EMAIL_FROM`） |
| 15-11b | 確かめ | 伴走のお知らせのメール（利用者あて、architecture.md の 4.27）も同じ `RESEND_API_KEY` で送る。送信元を分けたいときだけ `NOTIFY_EMAIL_FROM`（なければ `OPERATOR_EMAIL_FROM`、それもなければ `yabumi <noreply@yabumi.app>`）。毎日のジョブ（日本時間 7:00、`/api/jobs/coach`）は、マイグレーション 20261012130000 で pg_cron に入る（`APP_URL` と `CRON_SECRET` は 5 のとおり）。キーがない環境では送らず、ログに `[user-mail] RESEND_API_KEY がないので送りません` と件名だけ出る |
| 15-12 | 確かめ | キーがない環境（ローカルなど）では送らず、サーバーのログに `[operator] メールの設定がないので、ログにだけ残します` と出る。Vercel のログでこの文字が出ていたら、15-11 が済んでいない |

- **費用の上限の 80% の知らせ**（2026-10-11）: X（`X_MONTHLY_BUDGET_USD`）と AI（`AI_GLOBAL_MONTHLY_BUDGET_USD`）の、yabumi 全体の今月の費用が上限の 80% に達したとき、それぞれ月に 1 回、同じ `OPERATOR_EMAIL` にメールが届く（件名は「【yabumi の運営】X の API の今月の費用が…」「【yabumi の運営】AI（Claude API）の今月の費用が…」）。本文は額・上限・確かめ方（費用の多い利用者を見る SQL）だけ。1 人に偏っていれば利用者ごとの上限（`X_POST_USER_MONTHLY_USD`・`X_METRICS_USER_MONTHLY_USD`・`AI_USER_MONTHLY_BUDGET_USD`）を下げるか悪用として止め、普通に人が増えたのなら全体の上限を上げる（docs/cost-review.md を確かめてから）

- 管理用の鍵が漏れた疑いがあるときは、15-5 で新しい鍵を作って Vercel を入れ替え、古い鍵を「鍵」の画面で削除する（利用者ごとのアカウントは鍵を持たないので、そのまま使える）

### オーナーが確かめる（Android のアプリがあれば）

| # | 誰が | やること |
|---|---|---|
| 15-8 | オーナー | yabumi のプロジェクトの「ストアと課金をつなぐ」→「Google Play をつなぐ」→ 出たメールアドレスを、Play Console の「ユーザーと権限」→「新しいユーザーを招待」に貼り、「アプリ情報の表示と一括レポートのダウンロード（読み取り専用）」だけに印を付けて招待 |
| 15-9 | オーナー | Play Console の「レポートをダウンロード」→「統計情報」の「Cloud Storage の URI をコピー」を貼り、パッケージ名を確かめて「確かめて保存する」→「読めました」 |
| 15-10 | オーナー | 「指標」の「ダウンロード」と「ストアのページの閲覧」に Google Play の分が足される（Play のレポートは 3〜7 日遅れる）。Play Console の統計情報と見比べる |

## 16. App Store のストアのページの閲覧数（F07 の段取り ⑤）

13 で App Store の売上の鍵を入れたあと、「ストアと課金をつなぐ」の App Store の欄に「ストアのページの閲覧数（任意）」が出る。

| # | 誰が | やること |
|---|---|---|
| 16-1 | オーナー | App Store Connect の「統合」→「App Store Connect API」→「チームキー」で、名前 `yabumi-once`、アクセス **Admin** のキーを作り、.p8 をダウンロードする |
| 16-2 | オーナー | yabumi の「閲覧数のレポートを依頼する」に、Issuer ID・この Admin のキーの Key ID・.p8 を入れて押す →「レポートの依頼を作りました」。**yabumi はこのキーを保存しない** |
| 16-3 | オーナー | 16-1 の Admin のキーを App Store Connect で「取り消す」（もう要らない） |
| 16-4 | 確認 | 1〜2 日後から、毎日 3 時台の取り込みで「指標」の「ストアのページの閲覧」に App Store の分が出る。出ないとき（「要確認」と理由）は、Sales and Reports のキーでレポートを読めない可能性がある【未確認】。そのときは PM に知らせる |

## 17. 短縮リンクを利用者のドメインで作る（Vercel の API のトークン。D28）

利用者が「短縮リンク」の画面で自分のドメイン（例 go.example.com）を入れると、yabumi が Vercel の API でそのドメインを yabumi の Vercel のプロジェクトに足す（docs/architecture.md の 4.22）。そのためのトークンを運営者が用意する。入れるまでは、画面のボタンは「準備中」のまま。

| # | 誰が | やること |
|---|---|---|
| 17-1 | オーナー | Vercel → 右上のアイコン → Account Settings → **Tokens** → Create Token。名前 `yabumi-link-domains`、Scope は yabumi のプロジェクトがあるチーム（Hobby なら自分のチーム）、Expiration は 1 年（切れる前に作り直す。カレンダーに入れておく）。出た値を控える（あとから見られない） |
| 17-2 | オーナー | yabumi の Vercel のプロジェクト → Settings → General の **Project ID**（`prj_` で始まる）と、チームの Settings → General の **Team ID**（`team_` で始まる）を控える |
| 17-3 | オーナー | Vercel → yabumi のプロジェクト → Settings → Environment Variables に `VERCEL_API_TOKEN`（**Sensitive**）、`VERCEL_PROJECT_ID`、`VERCEL_TEAM_ID` を足し（Environment は Production だけ。プレビューから本番のドメインを触らないように）、Redeploy |
| 17-4 | 確かめ | 「短縮リンク」の画面の「自分のドメインで作る（任意）」の「設定する」が押せる。オーナーの持っているドメインで go.<ドメイン> を足し、DNS に出た CNAME と TXT（_yabumi.go）を入れて「確かめる」→「つながりました」。そのドメインの短縮リンクを押すとストアが開き、`https://go.<ドメイン>/login` は「このアドレスは短縮リンク用です。」になる。Vercel の Domains にそのドメインが並んでいる |
| 17-5 | 確かめ | 「このドメインを外す」で、Vercel の Domains からそのドメインが消える |

- **上限**: Vercel Hobby は 1 プロジェクトにドメイン 50 まで（yabumi の yabumi.app・www・go・vercel.app を含む）。利用者の分は `LINK_DOMAIN_LIMIT`（既定 40）まで。32 に達すると `OPERATOR_EMAIL` に「短縮リンクの利用者のドメインが上限に近づいています」が届く（7 日に 1 回）。そのときは Pro にして `LINK_DOMAIN_LIMIT` を上げるかを決める。なお Hobby は個人・非商用のみ（9 の費用の表）なので、他の人に提供する時点で Pro になる見込み
- **外せなかったドメイン**: 「利用者のドメインを Vercel から外せません」のメールが届いたら、Supabase の SQL Editor で `select * from link_domain_removals order by created_at;` を見て、Vercel → Project → Settings → Domains から手で外し、その行を消す
- **トークンが漏れた疑い**: 17-1 で作り直して入れ替え、古いトークンを Tokens の画面で消す

## 18. スマホの通知（Web Push。伴走の声かけ。docs/architecture.md の 4.28）

伴走の声かけを、利用者のスマホ・パソコンに通知で届ける。送るには、運営者の鍵（VAPID の鍵の組）が要る。入れるまでは、「お知らせの設定」の「この端末で通知を受け取る」は「準備中」のまま（メールと画面の声かけは届く）。

| # | 誰が | やること |
|---|---|---|
| 18-1 | オーナー | ターミナルで、yabumi のフォルダで `npx web-push generate-vapid-keys` を実行する。出た Public Key と Private Key を控える（ローカルとは**別の組**を作る。Private Key は人に見せない） |
| 18-2 | オーナー | Vercel → Settings → Environment Variables に `VAPID_PUBLIC_KEY`（公開してよい値）、`VAPID_PRIVATE_KEY`（**Sensitive**）、`VAPID_SUBJECT`（`mailto:` と運営者のメールアドレス。例 `mailto:ops@yabumi.app`。push サービスが問題のあるときに連絡してくる先）を足し（Environment は Production。Preview に入れるときは本番と別の組）、Redeploy |
| 18-3 | 確かめ | 下の「実機で確かめる」 |

- **鍵を作り直すと**（漏れた疑いがあるときなど）、登録済みの端末には届かなくなる（古い鍵で登録した宛先は、新しい鍵の署名を受け付けない）。利用者が「お知らせの設定」を開き、「この端末で通知を受け取る」を押し直すと、新しい鍵で登録し直す。作り直したら、お知らせで登録し直すよう案内する
- **費用**: 0 円。push サービス（Apple・Google・Mozilla・Microsoft）は無料で、送るのは Vercel の関数の中（伴走のジョブ）なので、追加の費用はない

### 実機で確かめる（オーナー。18-2 のあと）

本番（https://yabumi.app）で行う。ローカルの開発サーバーは自己署名の証明書なので、スマホからは確かめられない。

| # | 端末 | やること | 期待すること |
|---|---|---|---|
| 18-4 | iPhone（iOS 16.4 以降） | Safari で yabumi.app を開いてログインし、「お知らせの設定」を開く | 「iPhone・iPad では、ホーム画面に追加すると通知を受け取れます」と手順が出る（ボタンは出ない） |
| 18-5 | iPhone | 手順どおりに共有ボタン →「ホーム画面に追加」→「追加」。ホーム画面の yabumi から開き、ログインして「お知らせの設定」→「この端末で通知を受け取る」→「許可」 | 開いただけでは許可を聞かれず、ボタンを押したときに聞かれる。「この端末（iPhone）で受け取っています」になる |
| 18-6 | iPhone | 「試しに送る」を押してすぐにホーム画面に戻る（ロックしてもよい） | 数秒で「yabumi からのお知らせ」が届く。押すと yabumi が開く（プロジェクトの一覧） |
| 18-7 | Android（Chrome） | Chrome で開いてログインし、「お知らせの設定」→「この端末で通知を受け取る」→「許可」→「試しに送る」 | 通知が届き、押すと yabumi が開く（すでに開いているタブがあれば、そこに移る） |
| 18-8 | パソコン（Chrome か Safari） | 同じく登録して「試しに送る」 | 画面の右上（Mac は通知センター）に届く。スマホの画面の「ほかに登録している端末」に、このパソコンが並ぶ |
| 18-9 | どれか | 「この端末では受け取らないようにする」を押してから、別の端末で「ほかに登録している端末」を見る | その端末が一覧から消える |
| 18-10 | どれか | 登録した端末でログアウトし、もう一度ログインして「お知らせの設定」を開く | 「この端末で通知を受け取る」に戻っている（ログアウトで外れる） |
| 18-11 | iPhone | 伴走の声かけ（遅れそう・毎週の振り返り）の日に、通知が届くか | 題と本文が切れずに読め、押すとそのプロジェクトの画面（または投稿をつくる画面）が開く |

- 届かないときは: ① Vercel の Logs で `[push]` を探す（「送れませんでした」とホストと番号が出る。403 なら鍵の組が違う、413 は中身が大きすぎる）② `[env] スマホの通知（Web Push） は「準備中」` が出ていれば、18-2 の環境変数が足りない ③ 端末の集中モード・通知の設定

## 19. 招待の申し込みを受けて、招待する（LP。F19・D30。docs/architecture.md の 4.29）

トップ（/）の「招待を申し込む」で届いた申し込みを、運営者が見て招待する。新規登録は閉じたまま（D24 の ①・②）で、招待した人だけが始められる。

### 用意（最初の 1 回）

| # | 誰が | やること |
|---|---|---|
| 19-1 | オーナー | Vercel → Settings → Environment Variables に `OPERATOR_ADMIN_EMAILS`（オーナーが yabumi にログインするメールアドレス。複数ならカンマ区切り）を足して Redeploy。入れるまでは、運営者の画面（/admin。招待の申し込み /admin/waitlist と、規約の変更の知らせ /admin/legal-notice）はだれにも開けない |
| 19-2 | オーナー | （任意・おすすめ）5-8 の Turnstile の Secret Key を、Vercel の `TURNSTILE_SECRET_KEY`（**Sensitive**）にも入れて Redeploy。申し込みをサーバーでも確かめ、ロボットの申し込みを断る。入れないときは、人に見えない欄と 1 時間あたりの上限だけで守る |
| 19-3 | 確かめ | 15-11 の RESEND_API_KEY が入っていれば、申し込むと確認のメール（件名「yabumi の招待の申し込みを受け付けました」）が届く。入っていなければ、画面に「受け付けました」とだけ出る（申し込みは保存される） |
| 19-4 | オーナー | 招待のメールは Supabase の認証のメール（11 の F で Resend の SMTP にしたもの）で送る。Supabase → Authentication → Email Templates の **Invite user** を開き、Subject に「【yabumi】yabumi への招待」、本文に supabase/templates/invite.html の中身を貼って保存する（既定の英語のままだと、パスワードを決める画面に進まない。ローカルは supabase/config.toml で同じものを使っている） |

### 招待する（申し込みが届いたら）

1. yabumi に `OPERATOR_ADMIN_EMAILS` のアドレスでログインし、https://yabumi.app/admin/waitlist を開く（メニューにはない。ブックマークしておく）
2. 古い順に、メールアドレスと一言が並ぶ。招待する人は「招待する」→ 確かめの文が出たらもう一度「招待する」。Supabase が招待のメール（「パスワードを決めて始める」）を送り、申し込みは消える
3. 招待しない人は「お断りする」→ もう一度「お断りする」。メールは送らずに、申し込みを消す（断ったことを伝えたいときは、運営者のメールで別に送る）
4. 招待された人は、メールのボタンからパスワードを決めると始められる。**ALLOWED_SIGNUP_EMAILS に足す必要はない**（招待は登録の画面を通らない）

- 試用は 10 人ほど（D24 の ②）。② に進む前（Vercel・Supabase を Pro にする前）は、オーナーの判断で数人にとどめる
- 一覧は Supabase → Table Editor → `waitlist` でも見られる（書き換えない。消すときは画面から）
- Supabase の画面から招待するとき（Authentication → Users → Invite user）は、送ったあとで /admin/waitlist の「お断りする」で申し込みを消す（そうしないと 1 年残る）
- 申し込みは、招待・お断り・本人の取り消しのどれでもなければ 1 年で自動で消える（毎日 3:50）
- 申し込みが続けて断られる（「申し込みが混み合っています」）と問い合わせがあったら: 全員で 1 時間に 30 件の上限に達している。Supabase の SQL Editor で `select count(*) from waitlist where created_at > now() - interval '1 hour';` を見て、ロボットなら 19-2 の Turnstile を入れる

## 20. デザインを作り直したあとに、本番で貼り直すもの（D33、2026-10-30）

画面・アイコン・OGP 画像はデプロイで入れ替わる。次の 2 つは Supabase と GitHub の画面に貼ってあるので、デプロイだけでは変わらない。

| # | 誰が | やること |
|---|---|---|
| 20-1 | オーナー | Supabase → Authentication → Emails → **Templates**。5 つのテンプレートを、それぞれ下の表のファイルの本文に貼り替えて「Save」。件名も、下の表のとおりに直す（2026-11-02 に「【矢書】…」から「【yabumi】…」に変えた） |
| 20-2 | オーナー | 20-1 のあと、ログアウトして「パスワードを忘れた」に自分のアドレスを入れる。届いたメールの上に矢のマークと「yabumi」のロゴが出て、ボタンが黒になっている（ロゴは `https://yabumi.app/icons/email-logo.png` を読む。デプロイが済んでから確かめる） |
| 20-3 | オーナー | GitHub App のロゴを新しいアイコンにする（10-7・10-8 の手順。画像は `src/app/icon.png`、地の色は `16233d`） |

| Supabase のテンプレート | 貼るファイル | 件名（supabase/config.toml の subject と同じ） |
|---|---|---|
| Confirm signup | `supabase/templates/confirmation.html` | 【yabumi】メールアドレスの確認 |
| Invite user | `supabase/templates/invite.html` | 【yabumi】yabumi への招待 |
| Magic link | `supabase/templates/magic_link.html` | 【yabumi】ログインのリンク |
| Change email address | `supabase/templates/email_change.html` | 【yabumi】メールアドレスの変更の確認 |
| Reset password | `supabase/templates/recovery.html` | 【yabumi】パスワードの再設定 |

## 21. ログインの確かめを速くする（JWT の署名鍵を ES256 に。2026-11-02、perf/instant-feedback）

yabumi は、画面を開くたびに proxy.ts（とページ）で `supabase.auth.getClaims()` を使い、ログインしているかを確かめる。署名鍵が HS256（Supabase の既定。共有の秘密鍵）のままだと、getClaims は手元では確かめられず、毎回 Supabase に問い合わせる（getUser と同じ）。非対称の署名鍵（ES256）にすると、公開鍵（JWKS。一度取れば覚えておく）で手元で確かめるので、毎回の問い合わせがなくなる。署名を確かめることは変わらないので、安全さは落ちない。

### 本番（オーナー）

| # | 誰が | やること |
|---|---|---|
| 21-1 | オーナー | Supabase のダッシュボード → Project Settings → **JWT Keys** を開く。「JWT Signing Keys」の画面で **Migrate JWT secret** を押す（今の HS256 の秘密鍵が「前の鍵」として残り、すでに出ているトークンはそのまま通る） |
| 21-2 | オーナー | **Create standby key** で、種類に **ECC (P-256)** を選んで作る |
| 21-3 | オーナー | 数分おいてから、作った鍵の **Rotate keys**（standby の鍵を今の鍵にする）。これ以降に出るトークンは ES256 で署名される。前の HS256 の鍵は「前の鍵」として残るので、ログイン中の人がすぐにログインし直しになることはない（トークンの期限の 1 時間で入れ替わる） |
| 21-4 | オーナー | 1 時間以上たってから、前の HS256 の鍵を **Revoke** する（取り消すと、HS256 のトークンは通らなくなる。21-3 のあと急がなくてよい） |
| 21-5 | 確かめ | yabumi にログインし直して、画面を移る。Vercel のログで、proxy の時間が短くなっていること。ブラウザの開発ツールでトークン（cookie の sb-…-auth-token）の頭が `alg: ES256` になっていること |

- アプリのコードと環境変数は変えない（publishable key・secret key はそのまま。getClaims は JWKS を `/auth/v1/.well-known/jwks.json` から自分で取る）
- 戻したいときは、ダッシュボードで HS256 の鍵を今の鍵に戻す（Rotate）

### ローカル（開発する人）

- 共有のローカルの Supabase は、ES256 の鍵で動いている（2026-11-02 に切り替えた）
- 鍵のファイルは `supabase/signing_keys.json`（gitignore。コミットしない）。`supabase/config.toml` の `signing_keys_path` は、鍵がないとすべての supabase のコマンド（migration up・gen types など）が止まるので、リポジトリでは閉じたまま（HS256 で動く）にしている
- ローカルの Supabase を起動し直すときは、`supabase start` ではなく **`pnpm db:start`**（鍵がなければ作り、起動するあいだだけ signing_keys_path を開く）。`supabase start` で起動すると HS256 に戻る（動くが、ログインの確かめが毎回の問い合わせになる）
- 鍵だけ作るときは `pnpm db:keys`。切り替えたあとは、前の HS256 のトークンが通らないので、ログインし直す

## 22. D34（汎用化）と D33・速さの直しを本番に出す日の段取り（2026-11-02 に書いた）

### 出した記録（2026-11-02）

- **出した日時**: 2026-11-02 12 時台（日本時間）。main **f7d4ccb** を本番に出した（オーナーの git push）
- **DB**: マイグレーション 20261102100000_general_product・20261102210000_destinations_limit_lock を本番に当てた（PM）
- **規約・ポリシー**: D34 の版の施行日を 2026-11-02 にした（LEGAL_VERSIONS）。入れ替える前の本文（2026-10-30 の版）は、タグ **legal-2026-10-30**（23f12da）に残した
- **本番の確かめ（PM が curl で）**: LP の一言、/terms と /privacy の施行日、音声入力の文、ページに「矢書」が残っていないこと、ログイン、ジョブの入口。下の「本番で確かめること」の表のうち、ログインして画面を見る行は、オーナーの作業のあとに確かめる
- **オーナーの作業の残り**（2026-11-02 の時点で、まだ）:

| # | やること | 状態 |
|---|---|---|
| 22-9 | ログインして、同意の帯で規約とポリシー（施行日 2026-11-02）に同意する | まだ |
| 22-10 | 認証のメール 5 通の本文と件名（【yabumi】…）を貼り直し、「パスワードを忘れた」で 1 通送って確かめる | まだ |
| 22-11 | GitHub App のロゴと説明（Description）を変える | まだ |
| 22-12 | 署名鍵を ECC (P-256) に切り替える（21 の 21-1〜21-5。21-4 の Revoke は 1 時間以上たってから） | まだ |

済んだら、この表の状態と roadmap.md の D34 の表を直す。

- **そのあと出し直した（2026-11-02）**: main **fc40864** を出した（マイグレーションなし）。中身と確かめは 23 の「出した記録」。22-9〜22-12 はこの出し直しでは変わらない（まだ）


- **コード**: 本番（origin/main）は 23f12da（2026-10-31 の「上の帯を詰め、PC のメニューを英語にする」）。D33 の画面の作り直しと数字の段 1〜5 はもう本番に出ている。main はそこから 15 コミット先で、出すのは次のもの
  - D34 の汎用化（宣伝するものの種類・行き先の URL・手で入れる成果、文言・用語集・LP、AI への指示、アカウント設計の記入例、GitHub を開発しているものだけに）
  - 速さの直し（perf/instant-feedback: 押した瞬間の反応、画面ごとの読み込み中の表示、ログインの確かめを getClaims に）
  - 名前の表記を「矢書」から「yabumi」に（認証のメールの件名・本文も変わった）
  - プロジェクトの設定の「プロジェクトを削除する」を下に畳む、投稿をつくるの「?」の文
- **DB**: 本番に当たっていないのは **20261102100000_general_product.sql だけ**（`supabase migration list --linked` で、ローカルにあって本番の列が空なのはこの 1 つ）。そのあと、セキュリティ確認の直しで **20261102210000_destinations_limit_lock.sql** が増えた（行き先の 20 件の上限のトリガーを、数える前にプロジェクトの行を押さえる形に置き換えるだけ。[security/2026-11-02_D34_セキュリティ確認.md](security/2026-11-02_D34_セキュリティ確認.md) の L3）。20261102100000 の中身は足すだけ（projects.product_type を既定 app で足す、project_destinations と project_outcomes_daily を作る。どちらも RLS で本人だけ、authenticated に grant）。前のコード（23f12da）は新しい列と表を使わないので、**先に当てても本番は止まらない**。逆に、当てる前に新しいコードを出すと、プロジェクトの読み込みが product_type で失敗する
- **規約・ポリシー**: D34 は ② の変更（[legal.md](legal.md) の「案: 位置づけを広げ…（D34）」。2026-11-02 にオーナーが了承）。招待の前で利用者はオーナーだけなので、前もって知らせる期間は置かず（noticeWaived）、**出す日を施行日にする**。新しい本文と LEGAL_VERSIONS の 1 件は、ブランチ legal/d34（実装担当2）で用意して、同じ push で出す
- **環境変数**: 足すもの・変えるものはない（.env.example の差はコメントだけ）

### 出す日の順番

「D 日」は出す日（日本時間）。上から順に行い、前の行が済んでから次へ進む。

| # | 誰が | いつ | やること |
|---|---|---|---|
| 22-1 | PM | 前日まで | 出すブランチを main に取り込む: legal/d34（規約・ポリシーの本文の入れ替えと LEGAL_VERSIONS）。ほかの担当のブランチ（feat/voice-input・chore/lp-shots-d34）を一緒に出すかを決める。取り込んだあと、main で `pnpm test`・`pnpm exec tsc --noEmit`・`pnpm lint` が通ること |
| 22-2 | PM | 前日まで | セキュリティチェック（CLAUDE.md のスキル security-check）。範囲は前回の本番以降の変更（`git diff 23f12da main`）。とくに 20261102100000 の 2 つの表（他人の行が読めない・他人のプロジェクトに行を作れない）と、種類・行き先・成果を保存するサーバーアクション（src/lib/projects/actions.ts・src/lib/metrics/actions.ts） |
| 22-3 | PM | D 日 | **LEGAL_VERSIONS の施行日を D 日にそろえる**。legal/d34 で入れた行の version を D 日（"YYYY-MM-DD"）、noticeFrom は null、noticeWaived に理由（施行の時点で利用者は運営者だけ（招待の前）で、運営者が了承した（2026-11-02））、adverse は false。日付がずれたら（D 日に出せなかったら）、push の前に必ず直す。施行日より前に本文だけ出ると、ページの施行日と本文が合わなくなる。直したら `pnpm test`（tests の版の決まり historyProblems も通る）してコミット |
| 22-4 | PM | D 日 | 本番に当たるものを確かめる: `supabase db push --dry-run`。出るのが **20261102100000_general_product.sql と 20261102210000_destinations_limit_lock.sql の 2 つだけ**（この順）であること（ほかが出たら止めて、どこから来たかを確かめる） |
| 22-5 | PM | D 日（オーナーの了承のあと） | `supabase db push`。当たったら `supabase migration list --linked` で、20261102100000 と 20261102210000 の本番の列が埋まっていること。**`supabase db reset` は本番では使わない** |
| 22-6 | PM | D 日 | 当たった中身を数だけで確かめる（SQL Editor か `supabase db`。個人情報は見ない）: `select product_type, count(*) from projects group by 1;`（前のプロジェクトがすべて app）、`select count(*) from project_destinations;` と `select count(*) from project_outcomes_daily;`（どちらも 0） |
| 22-7 | オーナー | D 日（22-5 のすぐあと） | `git push origin main`。Vercel → Deployments で、いちばん上のデプロイが main の最新のコミットで **Ready** になるまで待つ（数分）。Error になったら Build Logs を PM に渡す（このときは本番は前のデプロイのまま動いている） |
| 22-8 | PM とオーナー | D 日（22-7 のあと） | 本番で確かめる（下の「本番で確かめること」）。問題があれば 22-13 で戻す |
| 22-9 | オーナー | D 日 | ログインすると、画面の上に**同意の帯**が出る（今の版が D 日の版に変わったため）。規約とポリシーを開いて、第 1 条などが新しい文になっていること・施行日が D 日になっていることを見てから、同意する。同意すると帯が消える |
| 22-10 | オーナー | D 日（22-9 のあと） | 認証のメール 5 通の**本文と件名**を貼り直す（20 の 20-1。件名も「【矢書】…」から「【yabumi】…」に変わったので、件名も 20 の表どおりに直す）。そのあと 20-2 のとおり「パスワードを忘れた」で 1 通送って、件名が【yabumi】で始まり、本文に「矢書」が残っていないこと |
| 22-11 | オーナー | D 日以降、いつでも | GitHub App のロゴ（20-3。10-7・10-8 の手順）。あわせて Description を「yabumi: 開発しているアプリや Web のサービスのリポジトリを読んで、紹介文と SNS の投稿のネタを作ります。読み取りだけで、書き込みはしません。」に（D34 で GitHub をアプリ以外の開発もの（Web のサービス）でも使うため。10-3 の例文はアプリだけの書き方） |
| 22-12 | オーナー | 22-8 が済んでから（別の日でもよい） | Supabase の JWT の署名鍵を ECC (P-256) に切り替える（21 の 21-1〜21-5）。コードは HS256 のままでも動く（ログインの確かめが毎回の問い合わせになって遅いだけ）ので、push と同じ時間にしない（問題が起きたときに、どちらのせいかを分けるため）。21-4 の Revoke は 1 時間以上たってから |

### 戻すとき

| # | 誰が | やること |
|---|---|---|
| 22-13 | オーナー | 画面が壊れたら、Vercel → Deployments → 前のデプロイ（23f12da）→ **Instant Rollback**。DB は戻さない（20261102100000 は足すだけ、20261102210000 は新しい表のトリガーを置き換えるだけで、前のコードはそのまま動く）。直したら、もう一度 push する |
| 22-14 | PM | 戻した間は、前のコードの規約・ポリシー（2026-10-30 の版）が出る。直して出し直す日が D 日と違えば、22-3 で施行日を出し直す日に変える（同意の記録は版の名前で持つので、出し直したあとにもう一度同意の帯が出る） |
| 22-15 | オーナー | 鍵の切り替え（22-12）で問題が出たら、21 の「戻したいとき」（HS256 の鍵を今の鍵に戻す） |

### 本番で確かめること（22-8）

本物の SNS への送信と、本物の AI は、ここでは呼ばない（AI を試すなら、費用（1 回 数円〜数十円）を承知のうえでオーナーが 1 回だけ）。アプリ以外のプロジェクトは、確かめるために本番でオーナーが 1 つ作り（例: 名前「テストのお店」、種類「お店（実店舗）」）、終わったら設定の「プロジェクトを削除する」で消す。SNS はつながない。

| 画面 | アプリのプロジェクト（ddy） | アプリ以外のプロジェクト（テストのお店） |
|---|---|---|
| LP（`/`、ログアウトして） | 一言「ひとりで売る人のための SNS 運用ツール」、見出し「いいものはある。／でも発信は苦手。」。ページの題とタブの名前が「yabumi」。招待の申し込みの欄の名前が「宣伝したいもの」 | — |
| 規約・ポリシー（`/terms`・`/privacy`） | 施行日が D 日。利用規約の第 1 条とポリシーの第 1 条・送り先・保存期間・利用目的が legal.md の表の「後」の文。改定の履歴に D 日の版 | — |
| 認証のメール（22-10） | 件名が【yabumi】で始まり、本文の上にロゴ | — |
| プロジェクト一覧 | ddy の添え書きがストアの名前（App Store / Google Play） | テストのお店の添え書きが種類の名前（お店（実店舗）など） |
| プロジェクトをつくる | — | いちばん上で「宣伝するもの」の種類を選べる。お店を選ぶと、名前・説明・届けたい相手の欄の例がお店のものになり、ストアの URL の欄が**出ない**。行き先の URL を 1 つ足して（例: 種類「サイト」、`https://example.com`）保存できる |
| 設定（edit） | 種類が「アプリ」のまま、ストアの URL が前のまま残っている。「プロジェクトを削除する」がいちばん下に畳まれている | 種類・行き先の URL が保存したとおり。ストアの URL の欄がない |
| 概要（Overview） | 数字のカード（ダウンロード・ストアへのクリックなど）が前と同じに出る。GitHub の 1 行が出る | 「ダウンロード」「ストア」「アプリ」の言葉が出ない。クリックは「行き先へのクリック」。GitHub の 1 行が出ない。いまやることの帯が「アカウントを設計する」 |
| 投稿をつくる（Compose） | 画面が開き、ボタンを押すとすぐ反応する（押した感じがある）。「ロードマップのやることから」の「?」が新しい文 | 同じ。画像のテンプレートの名前が「写真に見出し」「いつもの色」 |
| カレンダー | 月の表示・空き枠・時間帯の傾向が前と同じ | 開ける。アプリの言葉が出ない |
| 分析（Analytics） | 「ストアと課金をつなぐ」、ストアへのクリック、DL（Google Play・App Store）の列が前と同じ。7 日 ／ 30 日の切り替え | 「ストアと課金をつなぐ」が**出ない**。「行き先へのクリック」。手で記録する成果の箱が出る。1 日分（例: 来店 3）を入れて保存し、日ごとの棒の「成果（手で記録）」に出る。確かめたら 0 に戻すか、プロジェクトごと消す |
| AI と相談（Ask AI） | 開ける。会話の一覧が前のまま | 開ける（送らない） |
| アカウント設計（More） | 目標の選択肢の先頭がダウンロード。記入例がアプリのもの。前に決めた目標（downloads・paid）が「ダウンロード」「買う」として出る | 目標の選択肢が「見た人にいちばんしてほしいこと」で、お店のおすすめ（来店・予約など）が先。記入例がお店のもの（投稿の柱・プロフィール） |
| ネタを出す・ネタ帳 | 「最近の開発から（GitHub）」が出る | 「最近の開発から（GitHub）」が**出ない**。最近のできごとの質問がお店のもの |
| 短縮リンク | 行き先の候補の先頭がストアの URL | 行き先の候補に、保存した行き先の URL が出る |
| GitHub（設定から開く） | 前のまま、つないだリポジトリが出る | URL の /github を直に開くと、お店では使わない理由と、プロジェクトの設定への入口が出る |
| ストアと課金（分析から開く） | 前のまま | 分析に入口が出ない。URL の /stores を直に開くと「宣伝するものが『アプリ』のときに使えます」と出る |
| 用語集 | コンバージョンなどの例に、ダウンロードのほかに買う・申し込む・予約する | 同じ |
| 速さ（全体） | 上の帯のメニューを押すと、すぐに読み込み中の表示（灰色の枠）が出てから画面が出る。保存のボタンを押すと、すぐに押せなくなり「〜しています…」に変わる | 同じ |
| 予約ジョブ | 7-6 のとおり、D 日のあとも status_code が 200 | — |

確かめ終わったら、PM が結果（どの行を誰が見たか、問題があればスクショ）を roadmap.md の「D34 の本番への反映」に書く。

## 23. 本番に出し直しても、開いたままの画面の保存や送信が止まらないようにする（2026-11-02、fix/stale-deploy。architecture.md の 4.35）

Next.js の server action の ID は、ビルドごとの暗号の鍵から作られる。鍵を決めておかないと、本番に出し直すたびに ID が変わり、出し直す前から開いていた画面（スマホのホーム画面の yabumi など）で、保存・送信・AI の呼び出しがすべて失敗する。鍵を決めて、出し直しても ID が変わらないようにする。

| 段 | 誰が | すること | 状態 |
|---|---|---|---|
| 23-1 | オーナー | ターミナルで `openssl rand -base64 32` を実行し、出た値をパスワード管理アプリに控える（TOKEN_ENCRYPTION_KEY・CREDENTIAL_ENCRYPTION_KEY とは別の、新しい値） | 済（2026-11-02） |
| 23-2 | オーナー | Vercel → Settings → Environment Variables に `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`（値は 23-1、Environment は Production と Preview、**Sensitive**）を足し、Redeploy | 済（2026-11-02。fc40864 を出す前） |
| 23-3 | PM | 本番で、画面を開いたままにしてから main をもう一度出し、その画面で保存できることを確かめる。開いた画面に戻ると、上に「yabumi の新しい版があります」の帯が出ることも確かめる | まだ（次に出し直すときに確かめる） |

- この鍵は、server action に渡す値の暗号にも使うので、秘密にする（Sensitive）。**変えると、その時点で開いていた画面の保存や送信が 1 回失敗する**（画面は「yabumi が新しくなりました・読み込み直す」を出し、投稿の本文・設計・メモは読み込み直しても戻る）。漏れたときだけ変える
- 「新しい版があります」の帯は、ビルドの前に scripts/write-version.mjs が書く public/version.json と、画面の版（VERCEL_DEPLOYMENT_ID）を比べて出す。Vercel が入れる値なので、設定は要らない。費用もかからない（静的なファイル）

### 出した記録（2026-11-02）

- **出したもの**: main **fc40864**（オーナーの git push。前は f7d4ccb）。**マイグレーションなし**、環境変数は 23-2 の `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` を足した
- **中身**: 見ればわかる「?」の説明を外す・短くする（ced394b・86b17ae）、用語の点線（Term）の字の色をまわりに合わせる（f31e520）、ネタ帳のメモを黙って失わない（bd2e274）と書きかけの控えを本人にだけ戻す・持ち主のない控えは 1 時間だけ（28ea4c0・26a9592）、投稿をつくるの「AI で投稿に整える」（1052c00。architecture.md 4.34）、開いたままの画面の対策（fc40864。architecture.md 4.35）
- **規約・ポリシー**: /privacy の Anthropic の行に「AI で投稿に整える」で送る本文を書き足した（4bafa02）。① の書き足しなので、施行日と LEGAL_VERSIONS は変えていない（[legal.md](legal.md) の「AI で投稿に整える本文を、Anthropic に送るものに書き足す」）
- **本番の確かめ（PM）**: /version.json と画面の data-app-version が同じ（dpl_5MZYJEG5…）。LP・ログイン・/terms・/privacy が 200 で、/privacy に「AI で投稿に整える」の文がある
- **残り**: 23-3（開いたままの画面で保存できるか）は、次に出し直すときに PM が確かめる

## 24. AI で写真・絵をつくる（Gemini API の鍵。2026-11-02、feat/ai-photo。D35、architecture.md の 4.25 の ②）

「画像をつくる」の「AI で写真・絵をつくる」は、Google の Gemini API（Nano Banana 2.1）で画像を作る。鍵（GEMINI_API_KEY）を入れるまでは「つくる」が「準備中」のままで、ほかの機能には影響しない。yabumi の上限（1 人 月 20 枚、全体で月 1,000 円）は DB で固定してあるが、鍵が漏れたときに備えて、Google の側でも支払いと回数に上限を置く。

| 段 | 誰が | すること | 状態 |
|---|---|---|---|
| 24-1 | オーナー | Google Cloud のコンソール（console.cloud.google.com）で、**新しいプロジェクト**（例 `yabumi-image`）を作る。Google Play の取り込み（15）・YouTube とは別にする（鍵が漏れたときに、ほかの連携を止めずに済むように。D25 の I4） | まだ |
| 24-2 | オーナー | 24-1 のプロジェクトに請求先アカウントをつなぐ（「お支払い」）。**無料の枠では画像は作れず、無料の枠で送ったものは Google の学習に使われる**ので、必ず有料（請求先をつないだ状態）で使う | まだ |
| 24-3 | オーナー | 「お支払い」→「予算とアラート」で、このプロジェクトだけの予算を **月 1,500 円**（yabumi の上限 1,000 円 ＋ 余裕）にし、50%・90%・100% でメールが届くようにする。予算は知らせるだけで止まらないので、次の 24-4 も置く | まだ |
| 24-4 | オーナー | 「API とサービス」で **Generative Language API** を有効にし、「割り当て」で、画像のモデルのリクエスト数を **1 日 200 回** に下げる（1 回 1 枚。yabumi の上限なら 1 日にこれを超えない。割り当ての項目の名前は画面で確かめる【未確認】） | まだ |
| 24-5 | オーナー | Google AI Studio（aistudio.google.com）の「API キー」で、24-1 のプロジェクトを選んでキーを作る。キーの制限は「API の制限: Generative Language API だけ」。キーはパスワード管理アプリに控える（リポジトリやチャットに貼らない） | まだ |
| 24-6 | オーナー | Vercel → Settings → Environment Variables に `GEMINI_API_KEY`（値は 24-5、Production と Preview、**Sensitive**）を足して、Redeploy。モデルを変えるときだけ `IMAGE_GEN_MODEL`（空なら gemini-nano-banana-2.1） | まだ |
| 24-7 | オーナー | 規約・ポリシーの ② の変更（[legal.md](legal.md) の「AI で写真・絵をつくる」の案）を了承し、施行日を決める。**施行日より前に、本番で 24-6 の鍵を入れない**（鍵がなければ「準備中」で、Google には何も送られない） | まだ |
| 24-8 | PM | マイグレーション 20261102230000_ai_photo と 20261102230100_ai_photo_retention を時刻の順に本番に当てる（足すだけ。既存の行は変えない） | まだ |
| 24-9 | PM | 本番で、オーナーのアカウントで 1 枚だけ作り（約 5 円）、候補に「AI で作った画像」の札が出ること、添えた画像をダウンロードして IPTC の印（Iptc4xmpExt:DigitalSourceType）が入っていること、「今月はあと 19 枚」になることを確かめる | まだ |

- 費用: 1 枚 $0.0336（約 5 円）。yabumi の上限の中なら、全体で月 1,000 円まで（1 人の最大は月 20 枚で約 100 円）。全体の上限の 80% で運営者にメールが届く（「AI の画像（Gemini API）」）
- 「AI の画像（Gemini API）が 402（403・401）を返して使えません」のメールが届いたら（1 時間に 1 回まで）: 402 は 24-2 の請求先と支払いの状態（前払いなら残高）、403 は 24-4 の API の有効化と 24-5 の鍵の制限、401 は 24-6 の鍵の値を確かめる。直れば、利用者はそのまま作れる（使えなかった分は数えていない）。「AI（Claude API）が…」のメールは、Claude Console の Billing（402・残高）・鍵の権限（403）・Vercel の ANTHROPIC_API_KEY（401）を確かめる
- 鍵が漏れたとき: 24-5 でキーを消して作り直し、24-6 を入れ替える。24-3・24-4 の上限があるので、漏れても 1 日 200 枚・月の予算で止まる
- モデルが終わるとき（Google はモデルの入れ替えが速い）: 新しいモデルの名前を `IMAGE_GEN_MODEL` に入れ、src/lib/ai/pricing.ts の IMAGE_PRICES に値段を足す（表にないモデルは高めに見積もるので、足すまでは上限に早く届く）

## 25. 次に本番に出したあとに確かめること（2026-11-02 に書いた）

次に main を本番に出したら、PM が次の 3 つを確かめる。済んだら、状態を直し、元の段（23-3・24-9）の表と roadmap.md の「5. 次の作業」も直す。

| # | すること | 元の段 | 状態 |
|---|---|---|---|
| 25-1 | 出し直す前から開いていた画面で保存できること、その画面に戻ると上に「yabumi の新しい版があります」の帯が出ることを確かめる | 23-3 | まだ |
| 25-2 | 投稿をつくるで「AI で投稿に整える」を 1 回押し、案が出るまでの秒数を測る。src/components/posts/tidy-draft-panel.tsx の `TIDY_WAIT`（いまは見込みの「20〜40 秒ほど」）を、測った秒数に合わせて直す（実装担当3 の依頼。直すのは次のブランチで） | — | まだ |
| 25-3 | AI の画像を 1 枚だけ作り（約 5 円）、「AI で作った画像」の札・IPTC の印・「今月はあと 19 枚」を確かめる。24-1〜24-8（鍵・規約の施行日・マイグレーション）が済んでからにする | 24-9 | まだ |

- 25-2 と 25-3 は本物の AI を呼ぶ（費用がかかる）ので、オーナーのアカウントで 1 回ずつにする
