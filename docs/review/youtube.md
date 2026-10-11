# YouTube（Google）の審査の準備

- **作成日**: 2026-10-11
- **いまの状態**: 未接続（フェーズ 5 の動画と一緒に作る）。ここは「つなぐ機能を作るときに慌てないため」の整理
- 2 つの別の手続きがある: ① Google の OAuth の確認（同意の画面で「確認されていないアプリ」と出さない・人数の上限を外す）② YouTube API の監査（割り当ての引き上げと、規約に合っているかの確認）

## ① Google の OAuth の確認

出典: [機密性の高いスコープの確認](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)、[確認の要件](https://support.google.com/cloud/answer/13464321)、[ドメインの確認](https://developers.google.com/identity/verification/authentication-verification)、[Google API サービスのユーザーデータに関するポリシー](https://developers.google.com/terms/api-services-user-data-policy)

| 要るもの | 中身 | 矢書の状態 |
|---|---|---|
| **独自ドメイン** | ホームページ・プライバシーポリシーは、自分が持っていると Search Console で証明したドメインに置く。`vercel.app` は Public Suffix List に載っているので、`yabumi.vercel.app` は自分のドメインとして証明できない | yabumi.app を使う（README の R1）。Search Console で「ドメイン」として足し、Cloudflare の DNS に TXT を入れて確かめる |
| ホームページ | 外から開け、アプリの機能を説明している（ログインの画面だけは不可） | トップ（/）。済み |
| プライバシーポリシー | ホームページと同じドメイン。ホームページと同意の画面からリンク。中身は下の「YouTube のための追記」 | /privacy に追記が要る |
| スコープの理由 | スコープごとに、なぜ要るか、もっと狭いスコープでは足りない理由 | 作るときに書く。投稿だけなら youtube.upload |
| デモ動画 | YouTube に限定公開で上げる。同意の画面を英語で出し、アプリ名とアドレスバーの client_id が見えるように | 作ってから |

- youtube.upload が「機密性の高い（sensitive）」に当たるかは【未確認】（当たる見込みが高い）。Cloud Console の同意の画面で確かめる
- 確認の目安は 3〜5 営業日。確認されるまでは、利用者に警告の画面が出て、人数の上限がある
- データは、画面で利用者に見える機能のためだけに使う。広告に使わない、売らない

## ② YouTube API の監査と割り当て

出典: [監査と割り当ての引き上げ](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)、[割り当ての計算](https://developers.google.com/youtube/v3/determine_quota_cost)（2026-10-08 更新）、[videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)、[改訂履歴](https://developers.google.com/youtube/v3/revision_history)

- 割り当て（2026-06-01 から）: 動画のアップロード（videos.insert）は専用の枠で **1 日 100 回**まで、それ以外は合計で 1 日 10,000 ユニット。古い資料の「アップロード 1 回 1,600 ユニット」は使わない
- 監査の申請: [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form)。割り当てを増やすには先に監査が要る
- **未監査のアプリで上げた動画が非公開に固定されるか**は、公式の資料どうしで食い違う（2020 年の改訂履歴では固定される、今の videos.insert の説明では固定されない）。つなぐ機能を作ったら、まずテストで確かめる

## YouTube のための追記（プライバシーポリシー・利用規約）

出典: [YouTube API サービスの開発者ポリシー](https://developers.google.com/youtube/terms/developer-policies)、[必須の最低限の機能](https://developers.google.com/youtube/terms/required-minimum-functionality)

つなぐ機能を出す前に、次を /privacy と /terms に足す（プライバシーポリシーの「このポリシーの変更」に、新しい SNS は書き足してから始めると書いてある）。

- 利用規約: [YouTube 利用規約](https://www.youtube.com/t/terms)へのリンクと、「YouTube をつなぐ利用者は、YouTube 利用規約に従う」の一文
- プライバシーポリシー:
  - YouTube API サービスを使っていること
  - [Google のプライバシーポリシー](https://policies.google.com/privacy)へのリンク
  - YouTube から読む・保存するデータと、その使い道・渡す先
  - Google のセキュリティの設定（https://myaccount.google.com/permissions）から、矢書へのアクセスを取り消せること
  - 連絡先
- 削除の期限: 矢書の中で外したら 7 日以内、Google の設定で取り消されたら 30 日以内に消す。保存した YouTube のデータは 30 日ごとに消すか読み直す

## 投稿の画面の決まり

- タイトル（100 字まで）、説明（5,000 バイトまで）、公開範囲（公開・非公開・限定公開）を利用者が決める。矢書は利用者の入れた値を書き換えず、説明に文を足さない
- 書き込みの前に、はっきり同意をもらう。公開範囲を勝手に変えない
- 複数の SNS に送れる画面では、送り先を利用者が選べる（矢書は済み）

## オーナーの作業（つなぐ機能を作るとき）

1. yabumi.app を Search Console で確認する（Cloudflare の DNS に TXT）
2. Google Cloud でプロジェクトを作り、YouTube Data API v3 を有効にし、同意の画面（アプリ名 Yabumi、ホームページ、プライバシーポリシー、承認済みドメイン）を設定する
3. テストのユーザーで動かしたあと、OAuth の確認と、YouTube API の監査を申請する
