# SNS 各社の審査の準備

- **作成日**: 2026-10-11
- **目的**: 他の人が自分の SNS をつないで使えるようにするための、各社の審査・認証の準備。申請はオーナーの作業で、ここにはそのまま渡せる手順と、申請に貼る文面を置く
- **調べた日**: 2026-10-11（各社の公式の資料。出典は各ファイル。【未確認】は公式の資料で裏が取れなかったもの）

| SNS | ファイル | 他の人がつなぐのに要るもの | 目安の期間 |
|---|---|---|---|
| Threads（後で Instagram・Facebook） | [meta.md](meta.md) | ビジネス認証 → 権限ごとの App Review（説明文と画面の録画）→ Tech Provider 認証（Access Verification）→ アプリを Live に | 認証は数日、審査は 1 週間ほど（公式）。却下と出し直しを見込んで 1〜2 か月 |
| X | [x.md](x.md) | 審査はない（従量課金でアプリを作れば、他の人も認可できる）。規約上の表示と同意の画面を整える | ― |
| TikTok | [tiktok.md](tiktok.md) | 監査（audit）。通るまでは「自分だけ」に見える投稿しかできず、1 日 5 人まで | 未確認 |
| YouTube | [youtube.md](youtube.md) | Google の OAuth の確認（yabumi.app で行う）と、YouTube API の監査 | 確認は 3〜5 営業日（公式） |

## 審査の前提（オーナーの決定と、残りの判断）

| # | 点 | 状態 | 中身 |
|---|---|---|---|
| R1 | **独自ドメイン** | 決定（2026-10-11）: **yabumi.app**（Cloudflare Registrar） | YouTube（Google）の確認は、自分が持っていると証明できるドメインが要る（`vercel.app` は Public Suffix List に載っていて証明できない）。TikTok の URL の所有確認も yabumi.app で行う。切り替えの手順は deploy.md の 11。**Meta の申請は、切り替え（11 の C）が済んでから出す**（申請に書いた URL を変えると出し直しになることがある） |
| R2 | **Meta のビジネス認証の名義** | 決定（2026-10-11）: 個人事業主「**YuXport Labs**」（開業届は提出済み） | 書類と手順は [meta.md](meta.md) の「ビジネス認証」 |
| R3 | **運営者の表示**（規約・ポリシー・各社の申請画面） | 決定（2026-10-12）: **YuXport Labs（代表 生長 真尚）**、問い合わせ先 contact@yuxport.com | 各社の申請と規約に同じ表記を書く（大文字・小文字もこのとおり）。src/lib/legal/info.ts、[legal.md](../legal.md) の L1 |
| R4 | **Vercel のプラン** | 未決定 | Vercel Hobby は個人の非商用だけ。他の人に提供する（とくに有料にする）なら Pro（$20/月 ≒ 3,000 円）が要り、予算をほぼ使い切る。[legal.md](../legal.md) の L6 |

## どの順に進めるか（おすすめ）

1. yabumi.app に切り替える（deploy.md の 11 の A〜D）。問い合わせ先は contact@yuxport.com（2026-10-12 決定。11 の G は不要になった）
2. 利用規約とプライバシーポリシーの施行日を、登録の受付を開く日に決めて入れる（ほかの値は 2026-10-12 に入れた。src/lib/legal/info.ts の effectiveDate。[legal.md](../legal.md) の L8）
3. Meta: ビジネス認証（YuXport Labs）→ Threads の App Review → Tech Provider 認証 → Live（[meta.md](meta.md)）
4. GitHub App を Any account にする（[deploy.md](../deploy.md) の 10）
5. 登録を開く（ALLOWED_SIGNUP_EMAILS と Supabase の「新規登録を許可」）
6. TikTok・YouTube は、つなぐ機能を作るときに申請する（先に作っておくと録画が撮れない。申請には動く画面が要る）

## 審査の担当者に渡すもの（共通）

- 審査の担当者用の矢書のアカウント（本番。登録を閉じている間は、オーナーが Supabase の画面で作る。deploy.md の 5-3 と同じ手順）。メールは審査用のもの、パスワードは申請の欄にだけ書き、他には残さない
- アカウントにはサンプルのプロジェクト（アプリ名、アカウント設計）を入れておき、すぐに「つなぐ」「投稿をつくる」へ進めるようにする
- 画面は日本語だけなので、録画には英語の字幕か注釈を付ける（Meta は英語の UI が望ましいとしている）
