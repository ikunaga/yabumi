# 矢書（やぶみ）

個人開発者のための SNS 運用ツール。要求・設計・段取りは [docs/](docs/) を参照。

- [要求資料](docs/requirements.md)
- [アーキテクチャ案](docs/architecture.md)
- [開発の段取り](docs/roadmap.md)
- [デザイン（Claude Design からの引き渡し資料）](docs/design/design_handoff_yabumi_1b/README.md)

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
