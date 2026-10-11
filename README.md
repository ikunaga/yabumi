# 矢書（やぶみ）

個人開発者のための SNS 運用ツール。要求・設計・段取りは [docs/](docs/) を参照。

- [要求資料](docs/requirements.md)
- [アーキテクチャ案](docs/architecture.md)
- [開発の段取り](docs/roadmap.md)
- [デザイン（Claude Design からの引き渡し資料）](docs/design/design_handoff_yabumi_1b/README.md)
- [本番に公開する手順](docs/deploy.md)

## ローカル開発

必要なもの: Node.js 20.9 以上、pnpm、Docker、Supabase CLI

```bash
pnpm install
supabase start          # ローカルの Supabase を起動（ポートは 553xx 番台）
cp .env.example .env.local
# supabase status で表示される Publishable key と Secret key を .env.local に設定
# TOKEN_ENCRYPTION_KEY は openssl rand -base64 32 で作る
pnpm dev                # https://localhost:3100
```

| URL | 内容 |
|---|---|
| https://localhost:3100 | アプリ |
| http://127.0.0.1:55323 | Supabase Studio（DB の中身を見る） |
| http://127.0.0.1:55324 | Mailpit（ローカルで送られたメールを見る） |

### https で動かす理由

Threads のコールバック URL は https でないと登録できないため、`pnpm dev` は `next dev --experimental-https` で起動する。
初回は mkcert が証明書を作り、Mac の「キーチェーン」に登録するためにパスワードを聞かれることがある。証明書は certificates/ に置かれる（git には入れない）。

- 開くのは **https://localhost:3100**。SNS をつなぐ処理は localhost でしか完結しない（コールバック URL が localhost のため）
- ログイン状態の cookie はホスト名ごとに別なので、127.0.0.1 でログインしていても localhost では改めてログインが必要（アカウントやデータは同じ DB なので消えない）
- 127.0.0.1 で「つなぐ」を押すと、自動で localhost の同じ画面に移る
- https が要らない作業なら `pnpm dev:http`（http://127.0.0.1:3100）でもよい

ローカル専用のテストアカウント（ローカル DB にだけ存在する）:

- メール: `dev@yabumi.test`
- パスワード: `yabumi-dev-1234`

- 登録すると確認メールが届く（本番と同じ）。ローカルのメールは Mailpit（http://127.0.0.1:55324）で開く。パスワードの再設定のメールも同じ
- `supabase start` で DB が立ち上がらず「configuration file "/etc/postgresql/postgresql.conf" contains errors」と出るときは、本番に `supabase link` したときに書かれる supabase/.temp/postgres-version（本番の Postgres の版）が原因。ローカルのデータは別の版で作ってあるので、このファイルを消してから `supabase start` し直す（データは消えない。db reset はしない）

このアカウントとサンプルのプロジェクトは supabase/seed.sql から入る。`supabase db reset` で DB を作り直しても自動で戻る（自分で登録したアカウントは消える）。

## GitHub App（リポジトリからアプリの説明を下書きする）

登録のしかたと、設定の意味は docs/architecture.md の 4.10。登録したら、.env.local に次を足す。

```bash
GITHUB_APP_ID=        # App の General の「App ID」
GITHUB_APP_SLUG=      # 「Public link」の https://github.com/apps/ のあとの部分
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
```

秘密鍵（.pem）は改行を含むので、改行を `\n` にして 1 行で足す。zsh の `echo` は `\n` を本物の改行に変えてしまうので、`printf` を使う。先頭の `\n` は、.env.local の最後の行に改行がなくても前の行につながらないようにするため。

```bash
printf '\nGITHUB_APP_PRIVATE_KEY=%s\n' "$(awk '{printf "%s\\n", $0}' ~/Downloads/鍵のファイル名.pem)" >> .env.local
```

足したら `pnpm dev` を起動し直す。設定が足りないと画面に「準備中」と出て、開発サーバーのログに足りない変数の名前が出る（値は出ない）。.pem はリポジトリの外に置くか消す。

## X（自動で投稿する）

X の API は使った分だけ払う方式（投稿 1 本 $0.015、本文に URL があると $0.20）。矢書は月 $3 を上限にしていて、超えたら X は自動では送らず、手で投稿してもらう（決定 D16、docs/architecture.md の 4.13）。

1. https://console.x.com に、投稿に使う X のアカウントでログインする（開発者の登録がまだなら、画面の案内に沿って登録する）
2. **クレジットを買う**: Billing（支払い）でカードを登録し、クレジットを買う（最初にカードを登録すると $20 分がもらえる）。**Spending limit**（請求期間ごとの上限）を **$5** にする。矢書の上限 $3 を何かの理由ですり抜けても、X 側で止まる
3. **アプリを作る**: Create App。名前は `yabumi` など（ほかの人と重なれば `yabumi-masa` など）
4. アプリの **User authentication settings**（または Authentication settings）を開き、次のように設定する

| 項目 | 値 |
|---|---|
| App permissions | **Read and write**（投稿に要る。Read だけだと投稿で断られる） |
| Type of App | **Web App, Automated App or Bot** |
| Callback URI / Redirect URL | `https://localhost:3100/sns/x/callback` と `https://yabumi.app/sns/x/callback` の 2 つ（yabumi.app に切り替える前なら `https://yabumi.vercel.app/sns/x/callback` も） |
| Website URL | `https://yabumi.app` |

5. **Keys and tokens** の **OAuth 2.0 Client ID and Client Secret** を表示し（Client Secret は一度しか出ないので、出たらすぐに使う）、.env.local に足す。チャットなどには貼らない

```bash
X_CLIENT_ID=
X_CLIENT_SECRET=
```

6. `pnpm dev` を起動し直し、プロジェクトの概要の「つないだ SNS」で X の「つなぐ」を押す。本番は Vercel に同じ 2 つを入れて Redeploy（docs/deploy.md の 6-4）

- Callback URI に localhost を入れられないと言われたら、`https://127.0.0.1:3100/sns/x/callback` を登録し、.env.local に `X_REDIRECT_ORIGIN=https://127.0.0.1:3100` を足す。この場合、X をつなぐときは https://127.0.0.1:3100 でログインし直してから「つなぐ」を押す（ログインはホストごとに別のため）
- 月の上限を変えるときは `X_MONTHLY_BUDGET_USD`（米ドル）を入れる。今月いくら使ったかは、概要の「つないだ SNS」の X の行に出る

## 予約投稿のジョブ

予約時刻が来た投稿は、ローカルの Supabase の pg_cron が毎分ジョブ API（/api/jobs/publish）を呼んで送る。仕組みは docs/architecture.md の 4.7。
開発サーバーが https のため、ローカルでは中継を起動しておく必要がある。

```bash
pnpm dev          # ターミナル 1
pnpm jobs:bridge  # ターミナル 2（予約投稿を試すときだけ）
```

中継を起動していないときは、予約時刻が来ても送られない。起動すると、時刻を過ぎた予約がまとめて送られる。「今すぐ送る」は中継がなくても送れる。

初回だけ、ジョブの呼び先と合言葉をローカルの Supabase の Vault に入れる（`supabase db reset` をしたときもやり直す）。合言葉は .env.local の CRON_SECRET と同じ値にする。

```sql
-- Supabase Studio（http://127.0.0.1:55323）の SQL Editor で実行する
select vault.create_secret('http://host.docker.internal:3101', 'app_url');
select vault.create_secret('<.env.local の CRON_SECRET>', 'cron_secret');
```

ジョブが動いたかは、Studio で `select * from cron.job_run_details order by start_time desc limit 5;` と `select * from net._http_response order by id desc limit 5;` を見る。

## テスト

`pnpm test` で、単体テストと結合テスト（ローカルの Supabase を使う。RLS などを確かめる）をまとめて動かす。

結合テストは、ローカルの Supabase の URL とキーを .env.local から読む（`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`）。値は `supabase status` の API URL、Publishable key、Secret key。テストだけ別の値にしたいときは、.env.test.local に `SUPABASE_TEST_URL`、`SUPABASE_TEST_PUBLISHABLE_KEY`、`SUPABASE_TEST_SECRET_KEY` を入れる（どちらも git には入らない）。

### 並列の数と時間の上限（vitest.config.mts）

- 並列の数（maxWorkers）は既定で 3。環境変数 `YABUMI_TEST_WORKERS` で変えられる。何人かが同時にテストを流しているときや、マシンが重いときは 2 にする（`YABUMI_TEST_WORKERS=2 pnpm test`）
  - 2026-10-11 に測った: 既定の並列（CPU の数）だと、認証サーバーが詰まって、テスト用の利用者を作るところで 5〜10 秒の時間切れが毎回ちがう場所で起きた。3 なら、3 人が同時に全体を流しても 9 回中 8 回通った（残りの 1 回は API の入り口の一時的な 502）。1 人で流すと 6〜9 秒で終わる
- 時間の上限: テスト 1 つは 15 秒、beforeAll などの準備は 30 秒（既定の 5 秒と 10 秒では、共有の DB が混んでいるときに落ちる）。それでも長いテストは、テストごとに上限を延ばす
- テスト用の利用者は、パスワードなしで作り、マジックリンク（メールは送らない）でログインする（tests/helpers/supabase.ts の signUpNewUser）。パスワードの登録とログインは認証サーバーでハッシュを 2 回計算する重い処理で、並列で流すと詰まる原因だったため。テストでパスワードが要るときは、そのテストの中で作る
- 利用者はテストのファイルごとに作り、ファイルの中で使い回す（beforeAll で作り、afterAll で deleteUser）。テストごとに作らない
- 時間切れや「An invalid response was received from the upstream server」（502）で落ちたら、まず `YABUMI_TEST_WORKERS=2` で、落ちたファイルだけを流し直す（`pnpm vitest run tests/〜.test.ts`）。それで通るなら環境の混み具合のせいで、コードの問題ではない

結合テストが使うローカルの Supabase は、同じマシンの他の作業（別のセッションのテスト、開発サーバー）と共有で、オーナーが登録した本物のデータ（SNS の接続など）も入っている。そのため:

- テストの利用者は、テストのファイルごとに新しく作る（tests/helpers/supabase.ts の signUpNewUser）。他のファイルと使い回さない
- DB 全体を対象にする処理（日次のトークン延長、予約の取り出し、費用の上限の合計など）は、必ずテストの利用者に絞って呼ぶ（refreshDueTokens の onlyOwner、publishDueTargets の postId、費用の上限の budgetScopeOwner）。偽のアダプターで全体を処理すると、他のテストのアカウントやオーナーの本物の接続を壊す
- 他のテストが同時に流れても結果が変わらないように書く（全体の合計や件数に頼らない。purge_expired_data のように DB 全体を対象にする処理の「消した件数」も、別のテストが先に消すことがあるので確かめない）
- テストで作った費用の記録（ai_usage、sns_api_usage）は後片付けで消す。利用者を消すと費用の記録は持ち主を空にして残る決まりなので、消さないと矢書全体の今月の合計が増え続け、ローカルで全体の上限に達して AI や X が使えなくなる（tests/helpers/supabase.ts の deleteUser は先に消す）

それでも全体の上限に達してしまったとき（「矢書全体の上限に達しました」と出る）は、ローカルの DB だけで次を流す。**本番では絶対に流さない**（本番の持ち主のない記録は、退会した利用者の本物の費用の記録）。共有の DB なので、流す前に一緒に作業している人に知らせる。

```sql
-- ローカル専用。Supabase Studio（http://127.0.0.1:55323）の SQL Editor で
begin;
delete from public.ai_usage where owner_id is null;
delete from public.sns_api_usage where owner_id is null;
commit;
```


キーなどの鍵はリポジトリに書かない。テストで鍵の形の文字列が要るときは、文字列をつなげて作る（GitHub の push protection で push が止められるため）。

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー（https://localhost:3100） |
| `pnpm dev:http` | https なしの開発サーバー（SNS の接続は使えない） |
| `pnpm jobs:bridge` | ローカルで予約投稿のジョブを動かすための中継 |
| `pnpm test` | テスト（RLS の結合テストはローカルの Supabase が必要） |
| `pnpm typecheck` | 型チェック |
| `pnpm lint` | lint |
| `supabase migration new <名前>` | マイグレーション作成 |
| `supabase migration up` | 新しいマイグレーションを適用する（データは残る） |
| `supabase db reset` | DB を作り直す（データはすべて消え、seed.sql の内容だけが入る） |
| `pnpm db:types` | DB の型を再生成 |
