# 矢書を本番に公開する手順

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
| CRON_SECRET | 0-4 で新しく作った値（ローカルとは別。5-2 の Vault にも同じ値） | **はい** |
| THREADS_APP_ID | Meta の Yabumi Dev の App ID（ローカルと同じ） | いいえ |
| THREADS_APP_SECRET | Meta の Yabumi Dev の App secret（ローカルと同じ） | **はい** |
| ANTHROPIC_API_KEY | 6-3 で本番用に作るキー | **はい** |
| GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_CLIENT_ID | 6-2 で作る本番用の App の値 | いいえ |
| GITHUB_APP_CLIENT_SECRET | 同上 | **はい** |
| GITHUB_APP_PRIVATE_KEY | 同上の .pem の中身。Vercel の入力欄には複数行のまま貼ってよい | **はい** |

- AI の上限（AI_USER_MONTHLY_BUDGET_USD など）は、入れなければ既定値（利用者ごとに月 $3、全体で月 $10）
- 後から入れる値（ANTHROPIC_API_KEY、GITHUB_APP_*）は、入れるまでその機能が「準備中」になるだけで、他は動く。入れたら Redeploy する
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
| 5-4 | オーナー | Authentication → Sign In / Providers（または Settings）→ **Allow new users to sign up** をオフにする。矢書の画面からも、Supabase の API を直接呼んでも、新しいアカウントは作れなくなる |

## 6. 外部サービスに本番の URL を登録する

| # | 誰が | やること |
|---|---|---|
| 6-1 | オーナー | **Threads**: Meta の Yabumi Dev → Use cases → Access the Threads API → Settings に、本番の URL を**ローカルの URL と並べて**足す。Redirect Callback URLs: `https://yabumi-xxxx.vercel.app/sns/threads/callback`、Uninstall Callback URL と Delete Callback URL は 1 つしか入らないので本番のもの（`.../sns/threads/uninstall`、`.../sns/threads/delete`）にする（ローカルでは通知を受けられないため、本番を優先する） |
| 6-2 | オーナー | **GitHub App（本番用）**: ローカル用（yabumi-dev）とは別に、もう 1 つ App を作る。手順は README の「GitHub App」と同じで、URL だけ変える: Homepage URL `https://yabumi-xxxx.vercel.app`、Callback URL `https://yabumi-xxxx.vercel.app/github/callback`。名前は例えば `Yabumi`（重複していれば `Yabumi masa` など）。権限は Contents: Read-only のみ、Webhook はオフ、「Request user authorization (OAuth) during installation」はオン、インストール先は **Only on this account**（いまはオーナー専用。他の人に使ってもらうときに Any account にする）。App ID・slug・Client ID・Client secret・秘密鍵を Vercel の環境変数に入れる |
| 6-3 | オーナー | **Claude API**: Claude Console で本番用のキーを別に作る（名前 `yabumi-prod` など。Workspace を分けるなら `yabumi-prod`）。Limits で月の上限（例: $15）を確かめる。Vercel の ANTHROPIC_API_KEY に入れる |
| 6-4 | オーナー | 入れ終わったら、Vercel で Redeploy |

## 7. 動作の確認

| # | 誰が | 確かめること |
|---|---|---|
| 7-1 | オーナー | `https://yabumi-xxxx.vercel.app` を開き、5-3 のアカウントでログインできる。新規登録の画面で別のメールを入れると「いまは招待した方だけが登録できます。」と出る |
| 7-2 | オーナー | プロジェクトを作る（本番の DB は空なので、ローカルのデータは入っていない） |
| 7-3 | オーナー | 概要の「つないだ SNS」→ Threads の「つなぐ」→ @masa_i82 で許可 →「✓ @masa_i82」になる |
| 7-4 | オーナー | 投稿をつくる → Threads だけを選んで「今すぐ送る」→ 送信の結果に「Threads で見る」が出る。テストの投稿は「Threads から取り消す」で消せる |
| 7-5 | オーナー | 6 分以上先に予約して、時刻を過ぎて 1〜2 分で「✓ 送信済み」になる（予約ジョブが動いている） |
| 7-6 | Claude | 予約ジョブの記録を確かめる: SQL Editor（または `supabase db` のコマンド）で `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` と `select status_code, content, created from net._http_response order by id desc limit 5;`。status_code が 200 なら届いている |
| 7-7 | オーナー | GitHub をつなぐ → リポジトリを選ぶ → 紹介文の下書き（約 $0.25）。アカウント設計の「AI と考える」（AI のキーを入れたあと） |

## 8. 困ったとき

| 症状 | 見るところ・やること |
|---|---|
| 概要の「要確認」に「予約時刻を過ぎても送られていない投稿があります」と出る | 予約ジョブが止まっている。① Supabase の SQL Editor で 7-6 を見る（ジョブが失敗していないか、status_code が 401 なら CRON_SECRET と Vault の cron_secret が違う）② Vault の app_url が本番の URL か ③ Vercel のデプロイが失敗していないか。動き出せば自動で送られる |
| Supabase から「プロジェクトを一時停止する」というメールが来た | 1 週間ほど使われていないとき。ダッシュボードを開くか、矢書にログインすれば止まらない。止まってしまったら、ダッシュボードの「Restore」で戻せる（1 年以内）。止まっている間は予約が送られないので、戻したあと「要確認」を見る |
| 画面にエラーが出る | Vercel → Project → Logs（Hobby では**直近 1 時間**しか残らないので、起きたらすぐ見る）。送信の失敗の理由は、投稿の画面の「送信の結果」にも残る |
| 「準備中」から変わらない | 環境変数が足りない。入れたあと Redeploy したか確かめる |
| Threads をつなぐと失敗する | Meta の Settings の Redirect Callback URLs に本番の URL があるか（6-1）。APP_URL が本番の URL か |

## 9. 費用

| サービス | プラン | 費用 |
|---|---|---|
| Supabase | Free | 0 円（DB 500MB、2 プロジェクトまで） |
| Vercel | Hobby | 0 円（個人・非商用のみ。他の人に提供するときは Pro $20/月が要る） |
| Claude API | 従量 | 使った分。矢書の上限で月 $10 まで、Console の上限が最後の歯止め |
| Threads API / GitHub API | - | 0 円 |
| 独自ドメイン（任意） | - | .com などで年 1,500〜2,500 円ほど。いまは使わず vercel.app で始める（オーナーの判断） |
